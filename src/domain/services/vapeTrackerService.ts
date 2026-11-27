import type { Db } from '../../data/db/client';
import * as adaptiveRepo from '../../data/db/repositories/adaptiveChallengeRepo';
import * as challengeSessionRepo from '../../data/db/repositories/challengeSessionRepo';
import * as goalRepo from '../../data/db/repositories/goalRepo';
import * as rpgRepo from '../../data/db/repositories/rpgRepo';
import * as vapeMainRepo from '../../data/db/repositories/vapeMainRepo';
import type { VapeMainSession, VapeRewardLedgerRow } from '../../data/db/repositories/vapeMainRepo';
import { createId } from '../../utils/id';
import { VAPE_HABIT_CATEGORY } from '../models/adaptiveChallenge';
import type { AdaptiveChallengeAttempt, VapeChallengeFormat } from '../models/adaptiveChallenge';
import {
  MAX_STEPS_PER_CLAIM,
  VAPE_RECORD_BONUS,
  VAPE_STEP_GOLD,
  allocateClaim,
  formatDuration,
  nextStepInfo,
  recordLedgerKey,
  recordThresholdsCrossed,
  safeElapsedSec,
  stepLabel,
  stepLedgerKey,
  stepsReached,
  type NextStep,
} from '../rules/vapeMain';
import { displayElapsedSec } from './challengeService';
import { sharedGoldRemainingToday, SHARED_DAILY_GOLD_CAP } from './goldDailyCap';
import { closeVapeAdaptiveChallengeOnConn, startVapeAdaptiveChallenge } from './adaptiveChallengeService';

export type CravingFormat = Extract<VapeChallengeFormat, 'delay_craving' | 'breathing'>;
const CRAVING_FORMATS: readonly VapeChallengeFormat[] = ['delay_craving', 'breathing'];

export interface ClaimPreview {
  sessionId: string;
  sessionActive: boolean;
  startedAt: string;
  /** Fin de l'intervalle clôturé ; null pour le chrono en cours. */
  endedAt: string | null;
  confirmedSec: number;
  /** Paliers encore à valider pour cette période (tous, même au-delà du lot traité par confirmation). */
  stepsPending: number;
  /** Bonus de record réellement payables maintenant (plafond du jour déduit). */
  recordsPending: Array<{ minutes: number; gold: number }>;
  /** Or réellement créditable maintenant, plafond journalier partagé déduit. */
  creditableGold: number;
  /** Paliers qui seraient validés à 0 or (plafond atteint). */
  stepsWithoutGold: number;
  capReached: boolean;
}

export interface VapeHistoryRow {
  id: string;
  startedAt: string;
  endedAt: string | null;
  durationSec: number;
  voided: boolean;
  amended: boolean;
}

export interface CravingState {
  attemptId: string;
  format: CravingFormat;
  startedAt: string;
  targetSec: number;
  elapsedSec: number;
}

export interface VapeTrackerDashboard {
  nowIso: string;
  vapeGoalActive: boolean;
  active: { id: string; startedAt: string; elapsedSec: number; clockAnomaly: boolean } | null;
  lastClosed: {
    id: string;
    startedAt: string;
    endedAt: string;
    durationSec: number;
    canUndo: boolean;
  } | null;
  recordSec: number;
  /** Meilleur intervalle déjà clôturé (hors chrono en cours). */
  bestClosedSec: number;
  /** Intervalle en cours ≥ record précédent (et record > 0). */
  currentIsRecord: boolean;
  next: NextStep | null;
  /** Périodes à confirmer : chrono en cours puis intervalles clôturés non réclamés (plus récents d'abord). */
  claims: ClaimPreview[];
  history: VapeHistoryRow[];
  recentRewards: VapeRewardLedgerRow[];
  recentCravings: AdaptiveChallengeAttempt[];
  craving: CravingState | null;
  legacyTimerRunning: boolean;
  dailyGoldRemaining: number;
  dailyGoldCap: number;
  goldBalance: number;
}

function sessionDurationSec(s: VapeMainSession, nowMs: number): { sec: number; anomaly: boolean } {
  if (s.status === 'active') return safeElapsedSec(s.startedAt, nowMs);
  if (s.status === 'closed' && s.endedAt) return safeElapsedSec(s.startedAt, Date.parse(s.endedAt));
  return { sec: 0, anomaly: false };
}

interface ClaimPlan {
  /** Paliers à traiter dans cette confirmation (au plus MAX_STEPS_PER_CLAIM, dans l'ordre). */
  steps: number[];
  stepsPendingTotal: number;
  records: Array<{ minutes: number; gold: number }>;
}

async function computeClaimPlan(db: Db, session: VapeMainSession, durationSec: number): Promise<ClaimPlan> {
  const claimedSteps = await vapeMainRepo.listClaimedSteps(db, session.id);
  const reached = stepsReached(durationSec);
  let claimedWithin = 0;
  for (const c of claimedSteps) if (c <= reached) claimedWithin += 1;
  const steps: number[] = [];
  for (let n = 1; n <= reached && steps.length < MAX_STEPS_PER_CLAIM; n += 1) {
    if (!claimedSteps.has(n)) steps.push(n);
  }
  const priorBest = await vapeMainRepo.bestClosedDurationBefore(db, session.startedAt, session.id);
  const claimedRecords = await vapeMainRepo.listClaimedRecordThresholds(db);
  const records = recordThresholdsCrossed(durationSec, priorBest).filter((t) => !claimedRecords.has(t.minutes));
  return { steps, stepsPendingTotal: Math.max(0, reached - claimedWithin), records };
}

async function minUnclaimedRecordSec(db: Db): Promise<number> {
  const claimed = await vapeMainRepo.listClaimedRecordThresholds(db);
  const free = VAPE_RECORD_BONUS.find((t) => !claimed.has(t.minutes));
  return free ? free.minutes * 60 : Number.MAX_SAFE_INTEGER;
}

const MAX_CLAIM_PERIODS_SHOWN = 5;

async function buildClaimPreview(
  db: Db,
  session: VapeMainSession,
  nowMs: number,
  remaining: number,
): Promise<ClaimPreview | null> {
  const d = sessionDurationSec(session, nowMs);
  if (d.anomaly) return null;
  const plan = await computeClaimPlan(db, session, d.sec);
  const alloc = allocateClaim(plan.records, plan.steps, remaining);
  if (plan.stepsPendingTotal + alloc.records.length === 0) return null;
  return {
    sessionId: session.id,
    sessionActive: session.status === 'active',
    startedAt: session.startedAt,
    endedAt: session.status === 'active' ? null : session.endedAt,
    confirmedSec: d.sec,
    stepsPending: plan.stepsPendingTotal,
    recordsPending: alloc.records,
    creditableGold: alloc.granted,
    stepsWithoutGold: alloc.zeroGoldSteps.length,
    capReached: remaining - alloc.granted <= 0,
  };
}

export async function getVapeTrackerDashboard(db: Db, now: Date = new Date()): Promise<VapeTrackerDashboard> {
  const nowMs = now.getTime();
  const goal = await goalRepo.findActiveByTemplateId(db, 'vape_sessions');
  const vapeGoalActive = goal != null && goal.status !== 'archived' && goal.status !== 'paused';

  const activeRow = await vapeMainRepo.getActiveSession(db);
  const lastClosedRow = await vapeMainRepo.getLastClosedSession(db);
  const priorBestForActive = await vapeMainRepo.bestClosedDurationSec(db, activeRow?.id ?? null);

  let active: VapeTrackerDashboard['active'] = null;
  let activeSec = 0;
  if (activeRow) {
    const e = safeElapsedSec(activeRow.startedAt, nowMs);
    activeSec = e.sec;
    active = { id: activeRow.id, startedAt: activeRow.startedAt, elapsedSec: e.sec, clockAnomaly: e.anomaly };
  }

  const bestClosed = await vapeMainRepo.bestClosedDurationSec(db, null);
  const recordSec = Math.max(bestClosed, activeSec);
  const currentIsRecord = active != null && !active.clockAnomaly && activeSec > 0 && activeSec > priorBestForActive;

  const claims: ClaimPreview[] = [];
  const remaining = await sharedGoldRemainingToday(db, now);
  const claimSessions: VapeMainSession[] = [];
  if (activeRow) claimSessions.push(activeRow);
  claimSessions.push(...(await vapeMainRepo.listClaimCandidateSessions(db, await minUnclaimedRecordSec(db), 20)));
  for (const cs of claimSessions) {
    if (claims.length >= MAX_CLAIM_PERIODS_SHOWN) break;
    const preview = await buildClaimPreview(db, cs, nowMs, remaining);
    if (preview) claims.push(preview);
  }

  const history = (await vapeMainRepo.listRecentSessions(db, 8)).map((s) => ({
    id: s.id,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    durationSec: s.status === 'voided' ? 0 : sessionDurationSec(s, nowMs).sec,
    voided: s.status === 'voided',
    amended: s.originalEndedAt != null,
  }));

  const attempt = await adaptiveRepo.getRunningAttempt(db, VAPE_HABIT_CATEGORY);
  let craving: CravingState | null = null;
  if (attempt && CRAVING_FORMATS.includes(attempt.format) && attempt.challengeSessionId) {
    const cs = await challengeSessionRepo.getById(db, attempt.challengeSessionId);
    craving = {
      attemptId: attempt.id,
      format: attempt.format as CravingFormat,
      startedAt: attempt.startedAt,
      targetSec: attempt.targetDurationSec ?? 0,
      elapsedSec: cs ? displayElapsedSec(cs, nowMs) : 0,
    };
  }
  const recentCravings = (await adaptiveRepo.listRecentAttempts(db, VAPE_HABIT_CATEGORY, 20))
    .filter((a) => CRAVING_FORMATS.includes(a.format) && a.outcome !== 'running')
    .slice(0, 5);

  return {
    nowIso: now.toISOString(),
    vapeGoalActive,
    active,
    lastClosed:
      !activeRow && lastClosedRow && lastClosedRow.endedAt
        ? {
            id: lastClosedRow.id,
            startedAt: lastClosedRow.startedAt,
            endedAt: lastClosedRow.endedAt,
            durationSec: lastClosedRow.durationSec ?? 0,
            canUndo: lastClosedRow.endReason === 'vaped',
          }
        : null,
    recordSec,
    bestClosedSec: bestClosed,
    currentIsRecord,
    next: active && !active.clockAnomaly ? nextStepInfo(activeSec) : null,
    claims,
    history,
    recentRewards: await vapeMainRepo.listRecentVapeRewards(db, 5),
    recentCravings,
    craving,
    legacyTimerRunning: await vapeMainRepo.hasLegacyVapeTimerRunning(db),
    dailyGoldRemaining: remaining,
    dailyGoldCap: SHARED_DAILY_GOLD_CAP,
    goldBalance: await rpgRepo.getGoldBalance(db),
  };
}

export type StartMainResult =
  | { ok: true; session: VapeMainSession; alreadyActive: false }
  | { ok: true; session: VapeMainSession; alreadyActive: true }
  | { ok: false; code: 'legacy_timer_running' };

/** Démarrage explicite. Idempotent : un second appel renvoie la session déjà active. */
export async function startVapeMainSession(db: Db, now: Date = new Date()): Promise<StartMainResult> {
  let result: StartMainResult = { ok: false, code: 'legacy_timer_running' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const existing = await vapeMainRepo.getActiveSession(tx);
    if (existing) {
      result = { ok: true, session: existing, alreadyActive: true };
      return;
    }
    if (await vapeMainRepo.hasLegacyVapeTimerRunning(tx)) {
      result = { ok: false, code: 'legacy_timer_running' };
      return;
    }
    const id = createId('vms');
    const at = now.toISOString();
    await vapeMainRepo.insertActiveSession(tx, id, at);
    await vapeMainRepo.insertEvent(tx, { id: createId('vev'), kind: 'main_start', sessionId: id, occurredAt: at });
    const session = (await vapeMainRepo.getSessionById(tx, id))!;
    result = { ok: true, session, alreadyActive: false };
  });
  return result;
}

export type DeclareVapeResult =
  | {
      ok: true;
      sessionId: string;
      durationSec: number;
      newRecord: boolean;
      unclaimedSteps: number;
      endedAt: string;
      cravingClosed: boolean;
    }
  | { ok: false; code: 'no_active' | 'invalid_time' | 'clock_anomaly' | 'rewards_claimed' };

/**
 * Un intervalle dont des paliers/bonus sont déjà validés (même à 0 or) ne peut pas être raccourci ni annulé si cela
 * invaliderait ces validations : l'or est append-only et peut déjà être dépensé, on refuse plutôt que de corriger en silence.
 * `newDurationSec = null` : annulation complète (refusée dès qu'une validation existe).
 */
async function correctionConflictsWithClaims(
  tx: Db,
  sessionId: string,
  newDurationSec: number | null,
): Promise<boolean> {
  const b = await vapeMainRepo.getSessionClaimBounds(tx, sessionId);
  if (b.claimCount === 0) return false;
  if (newDurationSec == null) return true;
  return b.maxStep > stepsReached(newDurationSec) || b.maxRecordMinutes * 60 > newDurationSec;
}

/**
 * Cœur de « J'ai vapoté », À EXÉCUTER dans une transaction exclusive déjà ouverte : clôture le chrono principal ET
 * l'envie en cours dans la même unité atomique (rollback commun), sans transaction imbriquée.
 * Seule exception : une vape déclarée dans le passé (`endedAt`) ne clôt pas une envie démarrée après cette heure.
 */
async function declareVapeOnConn(tx: Db, now: Date, endedAtOpt?: Date): Promise<DeclareVapeResult> {
  const session = await vapeMainRepo.getActiveSession(tx);
  if (!session) return { ok: false, code: 'no_active' };
  const endMs = (endedAtOpt ?? now).getTime();
  if (!Number.isFinite(endMs) || endMs > now.getTime()) return { ok: false, code: 'invalid_time' };
  const e = safeElapsedSec(session.startedAt, endMs);
  if (e.anomaly) {
    return { ok: false, code: Date.parse(session.startedAt) > now.getTime() ? 'clock_anomaly' : 'invalid_time' };
  }
  if (endedAtOpt && (await correctionConflictsWithClaims(tx, session.id, e.sec))) {
    return { ok: false, code: 'rewards_claimed' };
  }
  const endedAt = new Date(endMs).toISOString();
  if (!(await vapeMainRepo.closeSession(tx, session.id, endedAt, e.sec, now.toISOString()))) {
    return { ok: false, code: 'no_active' };
  }

  let cravingClosed = false;
  let cravingAttemptId: string | null = null;
  const attempt = await adaptiveRepo.getRunningAttempt(tx, VAPE_HABIT_CATEGORY);
  if (
    attempt &&
    CRAVING_FORMATS.includes(attempt.format) &&
    (endedAtOpt == null || Date.parse(attempt.startedAt) <= endMs)
  ) {
    const c = await closeVapeAdaptiveChallengeOnConn(tx, attempt.id, 'vaped');
    cravingClosed = c.ok;
    cravingAttemptId = c.ok ? attempt.id : null;
  }

  await vapeMainRepo.insertEvent(tx, {
    id: createId('vev'),
    kind: 'main_close',
    sessionId: session.id,
    attemptId: cravingAttemptId,
    occurredAt: now.toISOString(),
    payload: { durationSec: e.sec, endedAt, cravingClosed },
  });
  const priorBest = await vapeMainRepo.bestClosedDurationBefore(tx, session.startedAt, session.id);
  const plan = await computeClaimPlan(tx, { ...session, status: 'closed', endedAt, durationSec: e.sec }, e.sec);
  return {
    ok: true,
    sessionId: session.id,
    durationSec: e.sec,
    newRecord: e.sec >= 60 && e.sec > priorBest,
    unclaimedSteps: plan.stepsPendingTotal,
    endedAt,
    cravingClosed,
  };
}

/**
 * « J'ai vapoté » : clôture l'intervalle actif (une seule fois, même en cas de double appui) et l'envie en cours,
 * atomiquement. `endedAt` permet de déclarer une heure passée ; jamais avant le début ni dans le futur.
 */
export async function declareVape(
  db: Db,
  opts: { endedAt?: Date; now?: Date } = {},
): Promise<DeclareVapeResult> {
  const now = opts.now ?? new Date();
  let result: DeclareVapeResult = { ok: false, code: 'no_active' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    result = await declareVapeOnConn(tx, now, opts.endedAt);
  });
  return result;
}

export type UndoResult = { ok: true; sessionId: string } | { ok: false; code: 'nothing_to_undo' | 'active_exists' };

/**
 * Annule la dernière déclaration (erreur de manipulation) : l'intervalle reprend, rien n'est supprimé.
 * Toujours compatible avec des récompenses déjà validées : l'intervalle ne peut que s'allonger.
 */
export async function undoLastDeclaration(db: Db, now: Date = new Date()): Promise<UndoResult> {
  let result: UndoResult = { ok: false, code: 'nothing_to_undo' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    if (await vapeMainRepo.getActiveSession(tx)) {
      result = { ok: false, code: 'active_exists' };
      return;
    }
    const last = await vapeMainRepo.getLastClosedSession(tx);
    if (!last || last.endReason !== 'vaped') return;
    if (!(await vapeMainRepo.reopenSession(tx, last.id, now.toISOString()))) return;
    await vapeMainRepo.insertEvent(tx, {
      id: createId('vev'),
      kind: 'main_reopen',
      sessionId: last.id,
      occurredAt: now.toISOString(),
    });
    result = { ok: true, sessionId: last.id };
  });
  return result;
}

export type AmendResult =
  | { ok: true; durationSec: number }
  | { ok: false; code: 'nothing_to_amend' | 'invalid_time' | 'rewards_claimed' };

/**
 * Corrige l'heure de la dernière déclaration vers un instant plus tôt. L'ancienne heure est conservée.
 * Refusée (`rewards_claimed`) si la nouvelle durée invaliderait des paliers/bonus déjà validés.
 */
export async function amendLastDeclarationTime(
  db: Db,
  newEndedAt: Date,
  now: Date = new Date(),
): Promise<AmendResult> {
  let result: AmendResult = { ok: false, code: 'nothing_to_amend' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const last = await vapeMainRepo.getLastClosedSession(tx);
    if (!last || !last.endedAt) return;
    const newMs = newEndedAt.getTime();
    const e = safeElapsedSec(last.startedAt, newMs);
    if (e.anomaly || newMs >= Date.parse(last.endedAt) || newMs > now.getTime()) {
      result = { ok: false, code: 'invalid_time' };
      return;
    }
    if (await correctionConflictsWithClaims(tx, last.id, e.sec)) {
      result = { ok: false, code: 'rewards_claimed' };
      return;
    }
    const iso = new Date(newMs).toISOString();
    await vapeMainRepo.amendSessionEnd(tx, last.id, iso, e.sec, now.toISOString());
    await vapeMainRepo.insertEvent(tx, {
      id: createId('vev'),
      kind: 'main_amend',
      sessionId: last.id,
      occurredAt: now.toISOString(),
      payload: { from: last.endedAt, to: iso, durationSec: e.sec },
    });
    result = { ok: true, durationSec: e.sec };
  });
  return result;
}

export type VoidResult = { ok: true } | { ok: false; code: 'not_found' | 'rewards_claimed' };

/**
 * Marque un intervalle comme erroné : exclu des records, conservé dans l'historique.
 * Refusé (`rewards_claimed`) dès qu'un palier ou bonus de cet intervalle a été validé.
 */
export async function voidVapeSession(
  db: Db,
  sessionId: string,
  now: Date = new Date(),
): Promise<VoidResult> {
  let result: VoidResult = { ok: false, code: 'not_found' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const at = now.toISOString();
    if (await correctionConflictsWithClaims(tx, sessionId, null)) {
      result = { ok: false, code: 'rewards_claimed' };
      return;
    }
    if (!(await vapeMainRepo.voidSession(tx, sessionId, 'user_correction', at, at))) return;
    await vapeMainRepo.insertEvent(tx, {
      id: createId('vev'),
      kind: 'main_void',
      sessionId,
      occurredAt: at,
    });
    result = { ok: true };
  });
  return result;
}

export interface ClaimedLine {
  kind: 'step' | 'record';
  step: number;
  grantedGold: number;
}

export type ClaimResult =
  | {
      ok: true;
      sessionId: string;
      grantedGold: number;
      /** Lignes payées (or > 0) ; les paliers à 0 or ne sont comptés que dans `stepsWithoutGold`. */
      lines: ClaimedLine[];
      stepsValidated: number;
      stepsWithoutGold: number;
      /** Paliers de cette période encore à valider (très long intervalle traité par lots). */
      stepsRemaining: number;
      recordBonuses: Array<{ minutes: number; gold: number }>;
      balance: number;
      capReached: boolean;
      message: string;
    }
  | { ok: false; code: 'not_confirmed' | 'nothing_to_claim' | 'clock_anomaly' | 'session_unavailable' };

/**
 * Confirmation explicite d'UNE période précise (`sessionId`, vérifié dans la transaction), puis crédit atomique de ses
 * paliers et bonus de record. Un palier est toujours « consommé » une fois validé (même à 0 or après plafond) :
 * relancer le chrono ou rouvrir l'app ne redonne rien. Un bonus de record n'est consommé que s'il verse de l'or.
 * Le plafond est un jour UTC (limite connue, identique aux quêtes renouvelables).
 */
export async function claimVapeRewards(
  db: Db,
  opts: { confirmed: boolean; sessionId: string; now?: Date },
): Promise<ClaimResult> {
  if (opts.confirmed !== true) return { ok: false, code: 'not_confirmed' };
  const now = opts.now ?? new Date();
  const at = now.toISOString();
  let result: ClaimResult = { ok: false, code: 'nothing_to_claim' };

  await db.withExclusiveTransactionAsync(async (tx) => {
    const session = await vapeMainRepo.getSessionById(tx, opts.sessionId);
    if (!session || (session.status !== 'active' && session.status !== 'closed')) {
      result = { ok: false, code: 'session_unavailable' };
      return;
    }
    const d = sessionDurationSec(session, now.getTime());
    if (d.anomaly) {
      result = { ok: false, code: 'clock_anomaly' };
      return;
    }
    const plan = await computeClaimPlan(tx, session, d.sec);
    const remainingBefore = await sharedGoldRemainingToday(tx, now);
    const alloc = allocateClaim(plan.records, plan.steps, remainingBefore);
    if (plan.steps.length + alloc.records.length === 0) return;

    const requestedRecord = new Map(plan.records.map((r) => [r.minutes, r.gold]));
    const lines: ClaimedLine[] = [];
    const recordBonuses: Array<{ minutes: number; gold: number }> = [];
    let granted = 0;
    let stepsValidated = 0;

    for (const rec of alloc.records) {
      const key = recordLedgerKey(rec.minutes);
      const r = await rpgRepo.addGold(
        tx,
        rec.gold,
        `Vape — nouveau record ${formatDuration(rec.minutes * 60)}`,
        key,
        at,
      );
      if (r === 'duplicate') continue;
      await vapeMainRepo.insertClaim(tx, {
        id: createId('vcl'),
        kind: 'record',
        sessionId: session.id,
        step: rec.minutes,
        requestedGold: requestedRecord.get(rec.minutes) ?? rec.gold,
        grantedGold: rec.gold,
        ledgerKey: key,
        claimedAt: at,
      });
      granted += rec.gold;
      lines.push({ kind: 'record', step: rec.minutes, grantedGold: rec.gold });
      recordBonuses.push({ minutes: rec.minutes, gold: rec.gold });
    }

    for (const st of alloc.paidSteps) {
      const key = stepLedgerKey(session.id, st.step);
      const r = await rpgRepo.addGold(tx, st.gold, `Vape — palier ${stepLabel(st.step)} confirmé`, key, at);
      if (r === 'duplicate') continue;
      await vapeMainRepo.insertClaim(tx, {
        id: createId('vcl'),
        kind: 'step',
        sessionId: session.id,
        step: st.step,
        requestedGold: VAPE_STEP_GOLD,
        grantedGold: st.gold,
        ledgerKey: key,
        claimedAt: at,
      });
      granted += st.gold;
      stepsValidated += 1;
      lines.push({ kind: 'step', step: st.step, grantedGold: st.gold });
    }

    const zero = alloc.zeroGoldSteps;
    if (zero.length > 0) {
      await vapeMainRepo.insertZeroGoldStepClaims(tx, session.id, zero[0], zero[zero.length - 1], VAPE_STEP_GOLD, at);
      stepsValidated += zero.length;
    }

    if (lines.length === 0 && zero.length === 0) return;
    await vapeMainRepo.insertEvent(tx, {
      id: createId('vev'),
      kind: 'claim',
      sessionId: session.id,
      occurredAt: at,
      payload: {
        confirmedSec: d.sec,
        grantedGold: granted,
        stepsValidated,
        stepsWithoutGold: zero.length,
        lines,
      },
    });
    const balance = await rpgRepo.getGoldBalance(tx);
    const capReached = remainingBefore - granted <= 0;
    const stepsRemaining = Math.max(0, plan.stepsPendingTotal - stepsValidated);
    const parts: string[] = [granted > 0 ? `+${granted} or reçus` : '0 or reçu'];
    if (stepsValidated > 0) {
      parts.push(
        `${stepsValidated} palier${stepsValidated > 1 ? 's' : ''} validé${stepsValidated > 1 ? 's' : ''}` +
          (zero.length > 0 && granted > 0 ? ` (dont ${zero.length} à 0 or)` : ''),
      );
    }
    if (recordBonuses.length > 0) {
      parts.push(`bonus record ${recordBonuses.map((r) => formatDuration(r.minutes * 60)).join(', ')}`);
    }
    let message = `${parts.join(' · ')}. Solde : ${balance} or.`;
    if (capReached && granted === 0) {
      message += ' Palier validé, 0 or (plafond journalier atteint) : progression conservée, sans or de plus aujourd\'hui.';
    } else if (capReached) {
      message += ' Plafond journalier d\'or atteint.';
    }
    if (stepsRemaining > 0) {
      message += ` ${stepsRemaining} palier${stepsRemaining > 1 ? 's' : ''} restent à valider : confirme à nouveau.`;
    }
    result = {
      ok: true,
      sessionId: session.id,
      grantedGold: granted,
      lines,
      stepsValidated,
      stepsWithoutGold: zero.length,
      stepsRemaining,
      recordBonuses,
      balance,
      capReached,
      message,
    };
  });
  return result;
}

export type DeclareCravingResult =
  | { ok: true; attempt: AdaptiveChallengeAttempt }
  | { ok: false; code: 'category_inactive' | 'already_running' | 'session_busy' | 'main_chrono_active' };

/** « J'ai une envie » : événement + défi adapté existant (retarder / respirer), aucun or automatique. */
export async function declareCraving(
  db: Db,
  format: CravingFormat = 'delay_craving',
  now: Date = new Date(),
): Promise<DeclareCravingResult> {
  const r = await startVapeAdaptiveChallenge(db, format, {
    requireActiveGoal: false,
    onStarted: async (tx, attempt) => {
      const active = await vapeMainRepo.getActiveSession(tx);
      await vapeMainRepo.insertEvent(tx, {
        id: createId('vev'),
        kind: 'craving_declared',
        sessionId: active?.id ?? null,
        attemptId: attempt.id,
        occurredAt: now.toISOString(),
        payload: { format },
      });
    },
  });
  if (r.ok) return { ok: true, attempt: r.attempt };
  return { ok: false, code: r.code };
}

export type ResolveCravingResult =
  | {
      ok: true;
      outcome: 'success' | 'failure' | 'unknown';
      goldGranted: boolean;
      goldAmount: number;
      mainClosed: boolean;
      tierMessage: string | null;
    }
  | { ok: false; code: 'not_found' | 'too_early' | 'close_failed' };

/**
 * held = tenu jusqu'à la cible (impossible avant) ; gave_in = cédé (clôture aussi le chrono principal,
 * car vapoter est vapoter) ; skip = ne pas renseigner (aucun résultat, aucun or).
 * Tout se passe dans UNE transaction exclusive qui relit l'envie : si « J'ai vapoté » (ou un double appui) l'a déjà
 * clôturée en échec, la validation en réussite est refusée (`not_found`) et aucun or n'est versé.
 */
export async function resolveCraving(
  db: Db,
  attemptId: string,
  outcome: 'held' | 'gave_in' | 'skip',
  now: Date = new Date(),
): Promise<ResolveCravingResult> {
  let result: ResolveCravingResult = { ok: false, code: 'not_found' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const attempt = await adaptiveRepo.getAttemptById(tx, attemptId);
    if (!attempt || attempt.outcome !== 'running') return;

    if (outcome === 'held') {
      const cs = attempt.challengeSessionId ? await challengeSessionRepo.getById(tx, attempt.challengeSessionId) : null;
      const elapsed = cs ? displayElapsedSec(cs, now.getTime()) : 0;
      if (attempt.targetDurationSec == null || elapsed < attempt.targetDurationSec) {
        result = { ok: false, code: 'too_early' };
        return;
      }
    }

    const mode = outcome === 'held' ? 'completed' : outcome === 'gave_in' ? 'vaped' : 'unknown';
    const closed = await closeVapeAdaptiveChallengeOnConn(tx, attemptId, mode);
    if (!closed.ok) {
      result = { ok: false, code: 'close_failed' };
      return;
    }

    let mainClosed = false;
    if (outcome === 'gave_in') {
      const d = await declareVapeOnConn(tx, now);
      mainClosed = d.ok;
    }
    const o = closed.attempt.outcome;
    result = {
      ok: true,
      outcome: o === 'success' ? 'success' : o === 'unknown' ? 'unknown' : 'failure',
      goldGranted: closed.goldGranted,
      goldAmount: closed.goldAmount,
      mainClosed,
      tierMessage: closed.tierMessage,
    };
  });
  return result;
}
