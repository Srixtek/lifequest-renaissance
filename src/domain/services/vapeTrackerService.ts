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
  VAPE_STEP_GOLD,
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
import { closeVapeAdaptiveChallenge, startVapeAdaptiveChallenge } from './adaptiveChallengeService';

export type CravingFormat = Extract<VapeChallengeFormat, 'delay_craving' | 'breathing'>;
const CRAVING_FORMATS: readonly VapeChallengeFormat[] = ['delay_craving', 'breathing'];

export interface ClaimPlanLine {
  kind: 'step' | 'record';
  step: number;
  requestedGold: number;
  label: string;
}

export interface ClaimPreview {
  sessionId: string;
  sessionActive: boolean;
  confirmedSec: number;
  stepsPending: number;
  recordsPending: Array<{ minutes: number; gold: number }>;
  /** Or réellement créditable maintenant, plafond journalier partagé déduit. */
  creditableGold: number;
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
  claim: ClaimPreview | null;
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

async function computeClaimPlan(
  db: Db,
  session: VapeMainSession,
  durationSec: number,
): Promise<{ steps: ClaimPlanLine[]; records: ClaimPlanLine[] }> {
  const claimedSteps = await vapeMainRepo.listClaimedSteps(db, session.id);
  const reached = stepsReached(durationSec);
  const steps: ClaimPlanLine[] = [];
  for (let n = 1; n <= reached; n += 1) {
    if (claimedSteps.has(n)) continue;
    steps.push({ kind: 'step', step: n, requestedGold: VAPE_STEP_GOLD, label: `Palier ${stepLabel(n)}` });
  }
  const priorBest = await vapeMainRepo.bestClosedDurationSec(db, session.id);
  const claimedRecords = await vapeMainRepo.listClaimedRecordThresholds(db);
  const records = recordThresholdsCrossed(durationSec, priorBest)
    .filter((t) => !claimedRecords.has(t.minutes))
    .map((t) => ({
      kind: 'record' as const,
      step: t.minutes,
      requestedGold: t.gold,
      label: `Record ${formatDuration(t.minutes * 60)}`,
    }));
  return { steps, records };
}

/** Intervalle réclamable : le chrono en cours, sinon le dernier intervalle clôturé. */
async function claimableSession(db: Db): Promise<VapeMainSession | null> {
  return (await vapeMainRepo.getActiveSession(db)) ?? (await vapeMainRepo.getLastClosedSession(db));
}

function applyCapToPlan(
  plan: { steps: ClaimPlanLine[]; records: ClaimPlanLine[] },
  remaining: number,
): { creditable: number } {
  let left = remaining;
  let creditable = 0;
  for (const line of [...plan.records, ...plan.steps]) {
    const g = Math.min(line.requestedGold, left);
    creditable += g;
    left -= g;
  }
  return { creditable };
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

  let claim: ClaimPreview | null = null;
  const claimSession = activeRow ?? lastClosedRow;
  if (claimSession) {
    const d = sessionDurationSec(claimSession, nowMs);
    if (!d.anomaly) {
      const plan = await computeClaimPlan(db, claimSession, d.sec);
      const remaining = await sharedGoldRemainingToday(db, now);
      if (plan.steps.length + plan.records.length > 0) {
        claim = {
          sessionId: claimSession.id,
          sessionActive: claimSession.status === 'active',
          confirmedSec: d.sec,
          stepsPending: plan.steps.length,
          recordsPending: plan.records.map((r) => ({ minutes: r.step, gold: r.requestedGold })),
          creditableGold: applyCapToPlan(plan, remaining).creditable,
          capReached: remaining <= 0,
        };
      }
    }
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
    claim,
    history,
    recentRewards: await vapeMainRepo.listRecentVapeRewards(db, 5),
    recentCravings,
    craving,
    legacyTimerRunning: await vapeMainRepo.hasLegacyVapeTimerRunning(db),
    dailyGoldRemaining: await sharedGoldRemainingToday(db, now),
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
    }
  | { ok: false; code: 'no_active' | 'invalid_time' | 'clock_anomaly' };

/**
 * « J'ai vapoté » : clôture l'intervalle actif (une seule fois, même en cas de double appui).
 * `endedAt` permet de déclarer une heure passée ; jamais avant le début ni dans le futur.
 */
export async function declareVape(
  db: Db,
  opts: { endedAt?: Date; now?: Date } = {},
): Promise<DeclareVapeResult> {
  const now = opts.now ?? new Date();
  let result: DeclareVapeResult = { ok: false, code: 'no_active' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const session = await vapeMainRepo.getActiveSession(tx);
    if (!session) {
      result = { ok: false, code: 'no_active' };
      return;
    }
    const endMs = (opts.endedAt ?? now).getTime();
    if (!Number.isFinite(endMs) || endMs > now.getTime()) {
      result = { ok: false, code: 'invalid_time' };
      return;
    }
    const e = safeElapsedSec(session.startedAt, endMs);
    if (e.anomaly) {
      result = { ok: false, code: Date.parse(session.startedAt) > now.getTime() ? 'clock_anomaly' : 'invalid_time' };
      return;
    }
    const endedAt = new Date(endMs).toISOString();
    const closed = await vapeMainRepo.closeSession(tx, session.id, endedAt, e.sec, now.toISOString());
    if (!closed) {
      result = { ok: false, code: 'no_active' };
      return;
    }
    await vapeMainRepo.insertEvent(tx, {
      id: createId('vev'),
      kind: 'main_close',
      sessionId: session.id,
      occurredAt: now.toISOString(),
      payload: { durationSec: e.sec, endedAt },
    });
    const priorBest = await vapeMainRepo.bestClosedDurationSec(tx, session.id);
    const plan = await computeClaimPlan(tx, { ...session, status: 'closed', endedAt, durationSec: e.sec }, e.sec);
    result = {
      ok: true,
      sessionId: session.id,
      durationSec: e.sec,
      newRecord: e.sec >= 60 && e.sec > priorBest,
      unclaimedSteps: plan.steps.length,
      endedAt,
    };
  });

  if (result.ok) {
    const attempt = await adaptiveRepo.getRunningAttempt(db, VAPE_HABIT_CATEGORY);
    if (attempt && CRAVING_FORMATS.includes(attempt.format)) {
      try {
        await closeVapeAdaptiveChallenge(db, attempt.id, 'vaped');
      } catch {
        /* le chrono principal est déjà clôturé ; l'envie restera clôturable à la main */
      }
    }
  }
  return result;
}

export type UndoResult = { ok: true; sessionId: string } | { ok: false; code: 'nothing_to_undo' | 'active_exists' };

/** Annule la dernière déclaration (erreur de manipulation) : l'intervalle reprend, rien n'est supprimé. */
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
  | { ok: false; code: 'nothing_to_amend' | 'invalid_time' };

/** Corrige l'heure de la dernière déclaration vers un instant plus tôt. L'ancienne heure est conservée. */
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

export type VoidResult = { ok: true } | { ok: false; code: 'not_found' };

/** Marque un intervalle comme erroné : exclu des records, conservé dans l'historique. */
export async function voidVapeSession(
  db: Db,
  sessionId: string,
  now: Date = new Date(),
): Promise<VoidResult> {
  let result: VoidResult = { ok: false, code: 'not_found' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const at = now.toISOString();
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
      grantedGold: number;
      lines: ClaimedLine[];
      stepsValidated: number;
      stepsWithoutGold: number;
      recordBonuses: Array<{ minutes: number; gold: number }>;
      balance: number;
      capReached: boolean;
      message: string;
    }
  | { ok: false; code: 'not_confirmed' | 'nothing_to_claim' | 'clock_anomaly' };

/**
 * Confirmation explicite de la période sans vape, puis crédit atomique des paliers et bonus de record.
 * Un palier est toujours « consommé » une fois validé (même à 0 or après plafond) : relancer le chrono
 * ou rouvrir l'app ne redonne rien. Un bonus de record n'est consommé que s'il verse effectivement de l'or.
 */
export async function claimVapeRewards(
  db: Db,
  opts: { confirmed: boolean; now?: Date },
): Promise<ClaimResult> {
  if (opts.confirmed !== true) return { ok: false, code: 'not_confirmed' };
  const now = opts.now ?? new Date();
  const at = now.toISOString();
  let result: ClaimResult = { ok: false, code: 'nothing_to_claim' };

  await db.withExclusiveTransactionAsync(async (tx) => {
    const session = await claimableSession(tx);
    if (!session) return;
    const d = sessionDurationSec(session, now.getTime());
    if (d.anomaly) {
      result = { ok: false, code: 'clock_anomaly' };
      return;
    }
    const plan = await computeClaimPlan(tx, session, d.sec);
    if (plan.steps.length + plan.records.length === 0) return;

    let remaining = await sharedGoldRemainingToday(tx, now);
    const lines: ClaimedLine[] = [];
    let granted = 0;
    const recordBonuses: Array<{ minutes: number; gold: number }> = [];
    let stepsWithoutGold = 0;

    for (const line of [...plan.records, ...plan.steps]) {
      const gold = Math.min(line.requestedGold, remaining);
      const key = line.kind === 'step' ? stepLedgerKey(session.id, line.step) : recordLedgerKey(line.step);
      if (line.kind === 'record' && gold <= 0) continue;
      if (gold > 0) {
        const r = await rpgRepo.addGold(
          tx,
          gold,
          line.kind === 'step'
            ? `Vape — palier ${stepLabel(line.step)} confirmé`
            : `Vape — nouveau record ${formatDuration(line.step * 60)}`,
          key,
          at,
        );
        if (r === 'duplicate') continue;
        remaining -= gold;
        granted += gold;
      }
      await vapeMainRepo.insertClaim(tx, {
        id: createId('vcl'),
        kind: line.kind,
        sessionId: session.id,
        step: line.step,
        requestedGold: line.requestedGold,
        grantedGold: gold,
        ledgerKey: key,
        claimedAt: at,
      });
      lines.push({ kind: line.kind, step: line.step, grantedGold: gold });
      if (line.kind === 'record') recordBonuses.push({ minutes: line.step, gold });
      if (line.kind === 'step' && gold === 0) stepsWithoutGold += 1;
    }

    if (lines.length === 0) return;
    await vapeMainRepo.insertEvent(tx, {
      id: createId('vev'),
      kind: 'claim',
      sessionId: session.id,
      occurredAt: at,
      payload: { confirmedSec: d.sec, grantedGold: granted, lines },
    });
    const balance = await rpgRepo.getGoldBalance(tx);
    const stepsValidated = lines.filter((l) => l.kind === 'step').length;
    const capReached = remaining <= 0;
    const parts: string[] = [];
    if (granted > 0) parts.push(`+${granted} or reçus`);
    else parts.push('0 or reçu');
    if (stepsValidated > 0) parts.push(`${stepsValidated} palier${stepsValidated > 1 ? 's' : ''} validé${stepsValidated > 1 ? 's' : ''}`);
    if (recordBonuses.length > 0) parts.push(`bonus record ${recordBonuses.map((r) => formatDuration(r.minutes * 60)).join(', ')}`);
    let message = `${parts.join(' · ')}. Solde : ${balance} or.`;
    if (capReached && (stepsWithoutGold > 0 || granted === 0)) {
      message += ' Plafond journalier d\'or atteint : progression conservée, sans or de plus aujourd\'hui.';
    } else if (capReached) {
      message += ' Plafond journalier d\'or atteint.';
    }
    result = {
      ok: true,
      grantedGold: granted,
      lines,
      stepsValidated,
      stepsWithoutGold,
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
  | { ok: true; outcome: 'success' | 'failure' | 'unknown'; goldGranted: boolean; mainClosed: boolean; tierMessage: string | null }
  | { ok: false; code: 'not_found' | 'too_early' | 'close_failed' };

/**
 * held = tenu jusqu'à la cible (impossible avant) ; gave_in = cédé (clôture aussi le chrono principal,
 * car vapoter est vapoter) ; skip = ne pas renseigner (aucun résultat, aucun or).
 */
export async function resolveCraving(
  db: Db,
  attemptId: string,
  outcome: 'held' | 'gave_in' | 'skip',
  now: Date = new Date(),
): Promise<ResolveCravingResult> {
  const attempt = await adaptiveRepo.getAttemptById(db, attemptId);
  if (!attempt || attempt.outcome !== 'running') return { ok: false, code: 'not_found' };

  if (outcome === 'held') {
    const cs = attempt.challengeSessionId ? await challengeSessionRepo.getById(db, attempt.challengeSessionId) : null;
    const elapsed = cs ? displayElapsedSec(cs, now.getTime()) : 0;
    if (attempt.targetDurationSec == null || elapsed < attempt.targetDurationSec) {
      return { ok: false, code: 'too_early' };
    }
  }

  const mode = outcome === 'held' ? 'completed' : outcome === 'gave_in' ? 'vaped' : 'unknown';
  const closed = await closeVapeAdaptiveChallenge(db, attemptId, mode);
  if (!closed.ok) return { ok: false, code: 'close_failed' };

  let mainClosed = false;
  if (outcome === 'gave_in') {
    const d = await declareVape(db, { now });
    mainClosed = d.ok;
  }
  const o = closed.attempt.outcome;
  return {
    ok: true,
    outcome: o === 'success' ? 'success' : o === 'unknown' ? 'unknown' : 'failure',
    goldGranted: closed.goldGranted,
    mainClosed,
    tierMessage: closed.tierMessage,
  };
}
