import type { Db } from '../../data/db/client';
import type { SqlRunner } from '../../data/db/sqlRunner';
import {
  CATEGORY_LABELS,
  MAX_ACTIVE_RENEWABLE,
  MAX_RECOMMENDED_OFFERS,
  RENEWABLE_BY_ID,
  RENEWABLE_GOLD_DAILY_CAP,
  RENEWABLE_TEMPLATES,
  isDailyEvidenceProof,
  type RenewableQuestCategory,
  type RenewableQuestTemplate,
} from '../../data/content/renewableQuestTemplates';
import * as renewableQuestRepo from '../../data/db/repositories/renewableQuestRepo';
import * as goalRepo from '../../data/db/repositories/goalRepo';
import * as kingdomRepo from '../../data/db/repositories/kingdomRepo';
import * as rpgRepo from '../../data/db/repositories/rpgRepo';
import { createId } from '../../utils/id';
import { findDailyEvidence, explainMissingEvidence, type DailyEvidence } from './dailyQuestEvidence';
import { insertEvidenceClaim } from './questEvidenceClaims';
import { getSharedGoldEarnedToday, utcDayStart } from './goldDailyCap';
import {
  evaluateRenewableProof,
  parseProgressJson,
  pickFreeBreathingCopeSessionId,
  pickFreeCombatVictoryId,
  renewableProofSatisfied,
  type InlineTimerProgress,
} from './renewableQuestEvidence';
import type { QuestProgress } from './questEvidence';
import {
  closeChallengeSessionOnConn,
  completeScreenChallengeOnConn,
  completeSportChallengeOnConn,
  displayElapsedSec,
  startChallengeSessionOnConn,
} from './challengeService';
import { recordBreathingSessionOnConn } from './vapeBreathingSession';
import * as challengeSessionRepo from '../../data/db/repositories/challengeSessionRepo';

type Conn = Db | SqlRunner;

export type RenewableBoardState = 'offered' | 'active' | 'ready' | 'claimed' | 'failed';

export interface RenewableBoardEntry {
  instanceId: string;
  template: RenewableQuestTemplate;
  state: RenewableBoardState;
  progress: QuestProgress;
  acceptedAt: string | null;
  claimedAt: string | null;
  challengeSessionId: string | null;
  timerRunning: boolean;
  inlineTimer: { startedUtc: string; targetSec: number } | null;
}

export interface RenewableQuestBoard {
  entries: RenewableBoardEntry[];
  recommended: RenewableBoardEntry[];
  acceptedCount: number;
  maxAccepted: number;
  goldBalance: number;
  dailyGoldRemaining: number;
}

export const renewableRewardKey = (instanceId: string) => `renewable:${instanceId}:reward`;

async function templateEligible(db: Conn, template: RenewableQuestTemplate): Promise<boolean> {
  if (template.sensitive && template.requiresGoalTemplateId) {
    const goals = await goalRepo.listGoals(db);
    const match = goals.find(
      (g) => g.templateId === template.requiresGoalTemplateId && g.status === 'active',
    );
    if (!match) return false;
  }
  if (template.requiresForgeLevelAtLeast != null) {
    const forge = await kingdomRepo.getForgeLevel(db);
    if (forge.level < template.requiresForgeLevelAtLeast) return false;
  }
  return true;
}

async function pickTemplateForCategory(
  db: Conn,
  category: RenewableQuestTemplate['category'],
  excludeTemplateId?: string,
): Promise<RenewableQuestTemplate | null> {
  const recent = await renewableQuestRepo.lastCompletedTemplateIds(db, category, 2);
  const pool = RENEWABLE_TEMPLATES.filter((t) => t.category === category);
  const eligible: RenewableQuestTemplate[] = [];
  for (const t of pool) {
    if (excludeTemplateId && t.id === excludeTemplateId) continue;
    if (recent.includes(t.id) && pool.some((p) => p.id !== t.id && !recent.includes(p.id))) continue;
    if (await templateEligible(db, t)) eligible.push(t);
  }
  if (eligible.length === 0) {
    for (const t of pool) {
      if (excludeTemplateId && t.id === excludeTemplateId) continue;
      if (await templateEligible(db, t)) eligible.push(t);
    }
  }
  return eligible[0] ?? null;
}

function occupiedTemplateIds(rows: renewableQuestRepo.RenewableQuestRow[]): Set<string> {
  return new Set(
    rows.filter((r) => r.status === 'offered' || r.status === 'active' || r.status === 'ready').map((r) => r.templateId),
  );
}

async function dedupeOfferedInstances(db: Conn): Promise<void> {
  const rows = await renewableQuestRepo.listInstances(db);
  const seen = new Set<string>();
  for (const r of rows.filter((row) => row.status === 'offered')) {
    if (seen.has(r.templateId)) {
      await db.runAsync(`DELETE FROM renewable_quest_instances WHERE id = ? AND status = 'offered'`, r.id);
    } else {
      seen.add(r.templateId);
    }
  }
}

async function ensureOffers(db: Conn): Promise<void> {
  await dedupeOfferedInstances(db);
  const rows = await renewableQuestRepo.listInstances(db);
  const occupied = occupiedTemplateIds(rows);
  const openOffers = rows.filter((r) => r.status === 'offered');
  const byCategory = new Map<string, number>();
  for (const r of openOffers) {
    byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + 1);
  }
  const categories: RenewableQuestTemplate['category'][] = ['habitudes', 'royaume', 'exploits'];
  const now = new Date().toISOString();
  for (const cat of categories) {
    if ((byCategory.get(cat) ?? 0) >= 1) continue;
    const tmpl = await pickTemplateForCategory(db, cat);
    if (!tmpl || occupied.has(tmpl.id)) continue;
    await renewableQuestRepo.insertOffered(db, createId('rnw'), tmpl.id, cat, tmpl.rewardGold, now);
    occupied.add(tmpl.id);
  }
}

export async function getRenewableGoldEarnedToday(db: Conn, dayStartIso: string): Promise<number> {
  return getSharedGoldEarnedToday(db, dayStartIso);
}

export async function getRenewableQuestBoard(db: Conn): Promise<RenewableQuestBoard> {
  await ensureOffers(db);
  const rows = await renewableQuestRepo.listInstances(db);
  const dayStart = utcDayStart();
  const earnedToday = await getRenewableGoldEarnedToday(db, dayStart);
  const entries: RenewableBoardEntry[] = [];
  let acceptedCount = 0;
  for (const row of rows) {
    if (row.status === 'claimed') continue;
    const template = RENEWABLE_BY_ID[row.templateId];
    if (!template) continue;
    if (row.status === 'active' || row.status === 'ready') acceptedCount += 1;
    const acceptedAt = row.acceptedAt ?? '';
    const progress = row.acceptedAt
      ? await evaluateRenewableProof(db, template, acceptedAt, row.progressJson, row.challengeSessionId)
      : { current: 0, target: 1, label: 'Pas commencée' };
    const meta = parseProgressJson(row.progressJson);
    if (meta.dailyOfferId && row.status === 'failed') continue;
    let state: RenewableBoardState = row.status;
    if (isDailyEvidenceProof(template.proof) && (row.status === 'active' || row.status === 'ready')) {
      state = progress.current >= progress.target && progress.target > 0 ? 'ready' : 'active';
    } else if (row.status === 'active' && renewableProofSatisfied(template, progress, row.status)) {
      state = 'ready';
    }
    const timerRunning = meta.timer?.state === 'running';
    const inlineTimer =
      timerRunning && meta.timer
        ? { startedUtc: meta.timer.startedUtc, targetSec: meta.timer.targetSec }
        : null;
    entries.push({
      instanceId: row.id,
      template,
      state,
      progress,
      acceptedAt: row.acceptedAt,
      claimedAt: row.claimedAt,
      challengeSessionId: row.challengeSessionId,
      timerRunning,
      inlineTimer,
    });
  }

  const priority = (e: RenewableBoardEntry) => {
    if (e.state === 'ready') return 0;
    if (e.state === 'offered') return 1;
    return 2;
  };
  const recommended = [...entries]
    .filter((e) => e.state === 'offered' || e.state === 'ready')
    .sort((a, b) => priority(a) - priority(b))
    .slice(0, MAX_RECOMMENDED_OFFERS);

  return {
    entries,
    recommended,
    acceptedCount,
    maxAccepted: MAX_ACTIVE_RENEWABLE,
    goldBalance: await rpgRepo.getGoldBalance(db),
    dailyGoldRemaining: Math.max(0, RENEWABLE_GOLD_DAILY_CAP - earnedToday),
  };
}

export async function acceptRenewableQuest(db: Db, instanceId: string, now = new Date()): Promise<{ ok: boolean; message: string }> {
  let result = { ok: false, message: 'Quête introuvable.' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const row = await renewableQuestRepo.getInstance(tx, instanceId);
    if (!row || row.status !== 'offered') {
      result = { ok: false, message: 'Cette quête n\'est plus disponible.' };
      return;
    }
    if ((await renewableQuestRepo.countActive(tx)) >= MAX_ACTIVE_RENEWABLE) {
      result = { ok: false, message: `Carnet plein (${MAX_ACTIVE_RENEWABLE}). Termine ou abandonne une quête renouvelable.` };
      return;
    }
    const template = RENEWABLE_BY_ID[row.templateId];
    if (!template || !(await templateEligible(tx, template))) {
      result = { ok: false, message: 'Quête non adaptée à ton état actuel.' };
      return;
    }
    const at = now.toISOString();
    const forge = await kingdomRepo.getForgeLevel(tx);
    const progressJson = JSON.stringify({ forgeLevelAtAccept: forge.level });
    if (!(await renewableQuestRepo.markActive(tx, instanceId, at, progressJson, null))) {
      result = { ok: false, message: 'Impossible d\'accepter cette quête.' };
      return;
    }
    result = { ok: true, message: `« ${template.title} » ajoutée au carnet.` };
  });
  return result;
}

export async function refreshRenewableState(db: Db, instanceId: string, now = new Date()): Promise<void> {
  await db.withExclusiveTransactionAsync(async (tx) => {
    const row = await renewableQuestRepo.getInstance(tx, instanceId);
    if (!row || !row.acceptedAt || row.status !== 'active') return;
    const template = RENEWABLE_BY_ID[row.templateId];
    if (!template) return;
    const progress = await evaluateRenewableProof(tx, template, row.acceptedAt, row.progressJson, row.challengeSessionId);
    if (!renewableProofSatisfied(template, progress, row.status)) return;
    let progressJson = row.progressJson;
    const meta = parseProgressJson(row.progressJson);
    if (template.proof === 'combat_victory' && progress.current >= 1) {
      if (!meta.proofCombatVictoryId) {
        const pick = await pickFreeCombatVictoryId(tx, template, row.acceptedAt, instanceId);
        if (!pick) return;
        meta.proofCombatVictoryId = pick;
        progressJson = JSON.stringify(meta);
      }
    }
    if (template.proof === 'breathing_timer' && progress.current >= 1) {
      if (!meta.proofBreathingCopeSessionId) {
        const pick = await pickFreeBreathingCopeSessionId(tx, template, row.acceptedAt, instanceId);
        if (!pick) return;
        meta.proofBreathingCopeSessionId = pick;
        progressJson = JSON.stringify(meta);
      }
    }
    await renewableQuestRepo.markReady(tx, instanceId, progressJson, now.toISOString());
  });
}

export async function startRenewableTimer(
  db: Db,
  instanceId: string,
  now = new Date(),
): Promise<{ ok: boolean; message: string }> {
  const at = now.toISOString();
  let result = { ok: false, message: 'Action impossible.' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const row = await renewableQuestRepo.getInstance(tx, instanceId);
    if (row?.status !== 'active') {
      result = { ok: false, message: 'Accepte la quête avant de lancer le chrono.' };
      return;
    }
    if (!row.acceptedAt) {
      result = { ok: false, message: 'Accepte la quête avant de lancer le chrono.' };
      return;
    }
    const template = RENEWABLE_BY_ID[row.templateId];
    if (!template) return;
    const existingMeta = parseProgressJson(row.progressJson);
    if (existingMeta.timer?.state === 'running') {
      result = { ok: false, message: 'Un chrono est déjà en cours sur cette carte.' };
      return;
    }
    if (row.challengeSessionId) {
      const linked = await challengeSessionRepo.getById(tx, row.challengeSessionId);
      if (linked?.state === 'running') {
        result = { ok: false, message: 'Un chrono est déjà en cours sur cette carte.' };
        return;
      }
    }

    if (template.proof === 'breathing_timer') {
      const target = template.targetDurationSec ?? 180;
      const timer: InlineTimerProgress = { kind: 'breathing', startedUtc: at, targetSec: target, state: 'running' };
      const progressJson = JSON.stringify({ ...existingMeta, timer });
      await renewableQuestRepo.updateProgress(tx, instanceId, progressJson, null, at);
      result = { ok: true, message: 'Chrono respiration démarré.' };
      return;
    }

    if (template.proof === 'inline_challenge' && template.challengeType) {
      const started = await startChallengeSessionOnConn(tx, template.challengeType, template.targetDurationSec ?? null);
      if (!started.ok) {
        result = { ok: false, message: 'Un autre chrono du même type est déjà en cours ailleurs.' };
        return;
      }
      const timer: InlineTimerProgress = {
        kind: 'challenge',
        startedUtc: started.session.startedUtc,
        targetSec: template.targetDurationSec ?? 600,
        state: 'running',
      };
      const progressJson = JSON.stringify({ ...existingMeta, timer });
      await renewableQuestRepo.updateProgress(tx, instanceId, progressJson, started.session.id, at);
      result = { ok: true, message: 'Chrono démarré sur la carte.' };
    }
  });
  return result;
}

export async function failRenewableTimer(db: Db, instanceId: string, now = new Date()): Promise<{ ok: boolean; message: string }> {
  const at = now.toISOString();
  let result = { ok: false, message: 'Rien à abandonner.' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const row = await renewableQuestRepo.getInstance(tx, instanceId);
    if (!row || row.status !== 'active') return;
    if (row.challengeSessionId) {
      const session = await challengeSessionRepo.getById(tx, row.challengeSessionId);
      if (session?.state === 'running') {
        await closeChallengeSessionOnConn(tx, row.challengeSessionId, 'interrupted', { requireSportConfirm: false });
      }
    }
    const meta = parseProgressJson(row.progressJson);
    if (meta.timer) meta.timer.state = 'stopped';
    await renewableQuestRepo.updateProgress(tx, instanceId, JSON.stringify(meta), null, at);
    await tx.runAsync(`UPDATE renewable_quest_instances SET challenge_session_id = NULL WHERE id = ?`, instanceId);
    await renewableQuestRepo.markFailed(tx, instanceId, at);
    const tmpl = RENEWABLE_BY_ID[row.templateId];
    const replacement =
      tmpl && !parseProgressJson(row.progressJson).dailyOfferId
        ? await pickTemplateForCategory(tx, tmpl.category, row.templateId)
        : null;
    if (replacement) {
      const rows = await renewableQuestRepo.listInstances(tx);
      if (!occupiedTemplateIds(rows).has(replacement.id)) {
        await renewableQuestRepo.insertOffered(tx, createId('rnw'), replacement.id, replacement.category, replacement.rewardGold, at);
      }
    }
    result = { ok: true, message: 'Tentative enregistrée — pas de récompense. Une nouvelle quête peut apparaître.' };
  });
  return result;
}

export async function succeedRenewableTimer(db: Db, instanceId: string, now = new Date()): Promise<{ ok: boolean; message: string }> {
  const at = now.toISOString();
  let result = { ok: false, message: 'Objectif pas encore atteint.' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const row = await renewableQuestRepo.getInstance(tx, instanceId);
    if (!row?.acceptedAt || row.status !== 'active') return;
    const template = RENEWABLE_BY_ID[row.templateId];
    if (!template) return;
    const target = template.targetDurationSec ?? 180;

    if (template.proof === 'breathing_timer') {
      const meta = parseProgressJson(row.progressJson);
      const timer = meta.timer;
      if (!timer || timer.state !== 'running') {
        result = { ok: false, message: 'Aucun chrono actif.' };
        return;
      }
      const elapsed = displayElapsedSec({
        id: '',
        type: 'sport',
        startedUtc: timer.startedUtc,
        endedUtc: null,
        targetDurationSec: target,
        state: 'running',
        durationSec: 0,
        userConfirmed: false,
        userConfirmedDurationSec: null,
        createdAt: timer.startedUtc,
        updatedAt: timer.startedUtc,
      });
      if (elapsed < target) {
        result = { ok: false, message: `Encore ${target - elapsed} s avant la cible.` };
        return;
      }
      const cope = await recordBreathingSessionOnConn(tx, target, true);
      if (timer) timer.state = 'stopped';
      meta.proofBreathingCopeSessionId = cope.copingSessionId;
      const readyJson = JSON.stringify({ ...meta, timer });
      await renewableQuestRepo.updateProgress(tx, instanceId, readyJson, null, at);
      await renewableQuestRepo.markReady(tx, instanceId, readyJson, at);
      result = { ok: true, message: 'Souffle validé — récompense prête !' };
      return;
    }

    if (template.proof === 'inline_challenge' && row.challengeSessionId) {
      const session = await challengeSessionRepo.getById(tx, row.challengeSessionId);
      if (!session || session.state !== 'running') {
        result = { ok: false, message: 'Chrono introuvable.' };
        return;
      }
      const elapsed = displayElapsedSec(session);
      if (elapsed < target) {
        result = { ok: false, message: `Encore ${target - elapsed} s.` };
        return;
      }
      const confirmedMinutes = target / 60;
      if (session.type === 'sport') {
        const done = await completeSportChallengeOnConn(tx, session.id, confirmedMinutes);
        if (!done.ok) {
          result = { ok: false, message: 'Impossible de valider le défi sport.' };
          return;
        }
      } else if (session.type === 'no_screen') {
        const done = await completeScreenChallengeOnConn(tx, session.id, true);
        if (!done.ok) {
          result = { ok: false, message: 'Impossible de valider le défi sans écran.' };
          return;
        }
      } else {
        const done = await closeChallengeSessionOnConn(tx, session.id, 'completed', { requireSportConfirm: false });
        if (!done.ok) {
          result = { ok: false, message: 'Impossible de clôturer le chrono.' };
          return;
        }
      }
      const meta = parseProgressJson(row.progressJson);
      if (meta.timer) meta.timer.state = 'stopped';
      meta.proofChallengeSessionId = session.id;
      const readyJson = JSON.stringify(meta);
      await renewableQuestRepo.updateProgress(tx, instanceId, readyJson, session.id, at);
      await renewableQuestRepo.markReady(tx, instanceId, readyJson, at);
      result = { ok: true, message: 'Défi validé — tu peux réclamer l\'or !' };
    }
  });
  return result;
}

export async function partialStopRenewableTimer(
  db: Db,
  instanceId: string,
  now = new Date(),
): Promise<{ ok: boolean; message: string }> {
  const at = now.toISOString();
  let result = { ok: false, message: 'Rien à arrêter.' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const row = await renewableQuestRepo.getInstance(tx, instanceId);
    if (!row?.acceptedAt || row.status !== 'active') return;
    const template = RENEWABLE_BY_ID[row.templateId];
    if (!template) return;
    const meta = parseProgressJson(row.progressJson);

    if (template.proof === 'breathing_timer' && meta.timer?.state === 'running') {
      const elapsed = displayElapsedSec({
        id: '',
        type: 'sport',
        startedUtc: meta.timer.startedUtc,
        endedUtc: null,
        targetDurationSec: meta.timer.targetSec,
        state: 'running',
        durationSec: 0,
        userConfirmed: false,
        userConfirmedDurationSec: null,
        createdAt: meta.timer.startedUtc,
        updatedAt: meta.timer.startedUtc,
      });
      meta.timer.state = 'stopped';
      meta.timer.partialBestSec = Math.max(meta.timer.partialBestSec ?? 0, elapsed);
      meta.partialNote = `Tu as tenu ${elapsed} s — bel effort personnel, pas la récompense complète.`;
      await renewableQuestRepo.updateProgress(tx, instanceId, JSON.stringify(meta), null, at);
      result = { ok: true, message: meta.partialNote };
      return;
    }

    if (template.proof === 'inline_challenge' && row.challengeSessionId) {
      const session = await challengeSessionRepo.getById(tx, row.challengeSessionId);
      if (session?.state === 'running') {
        const elapsed = displayElapsedSec(session);
        await closeChallengeSessionOnConn(tx, session.id, 'interrupted', { requireSportConfirm: false });
        if (!meta.timer) {
          meta.timer = {
            kind: 'challenge',
            startedUtc: session.startedUtc,
            targetSec: template.targetDurationSec ?? 600,
            state: 'stopped',
          };
        }
        meta.timer.state = 'stopped';
        meta.timer.partialBestSec = Math.max(meta.timer.partialBestSec ?? 0, elapsed);
        meta.partialNote = `${elapsed} s enregistrées — progrès perso, récompense seulement à la cible.`;
        await renewableQuestRepo.updateProgress(tx, instanceId, JSON.stringify(meta), null, at);
        result = { ok: true, message: meta.partialNote };
      }
    }
  });
  return result;
}

async function spawnRenewal(tx: Conn, category: string, excludeTemplateId: string, at: string): Promise<void> {
  const next = await pickTemplateForCategory(tx, category as RenewableQuestTemplate['category'], excludeTemplateId);
  if (!next) return;
  const rows = await renewableQuestRepo.listInstances(tx);
  if (occupiedTemplateIds(rows).has(next.id)) return;
  await renewableQuestRepo.insertOffered(tx, createId('rnw'), next.id, next.category, next.rewardGold, at);
}

export async function claimRenewableQuest(db: Db, instanceId: string, now = new Date()): Promise<{ ok: boolean; message: string; gold?: number; balance?: number }> {
  let result: { ok: boolean; message: string; gold?: number; balance?: number } = { ok: false, message: 'Réclamation impossible.' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const row = await renewableQuestRepo.getInstance(tx, instanceId);
    if (row?.status === 'claimed') {
      result = { ok: false, message: 'Récompense déjà réclamée.' };
      return;
    }
    if (row?.status === 'failed') {
      result = { ok: false, message: 'Quête échouée — aucune récompense.' };
      return;
    }
    if (!row?.acceptedAt) {
      result = { ok: false, message: 'Quête non acceptée.' };
      return;
    }
    const template = RENEWABLE_BY_ID[row.templateId];
    if (!template) return;
    const at = now.toISOString();
    let progressJson = row.progressJson;
    let status = row.status;
    const meta = parseProgressJson(progressJson);

    if (template.proof === 'combat_victory') {
      if (!meta.proofCombatVictoryId) {
        const pick = await pickFreeCombatVictoryId(tx, template, row.acceptedAt, instanceId);
        if (!pick) {
          result = { ok: false, message: 'Aucune victoire éligible pour cette quête.' };
          return;
        }
        meta.proofCombatVictoryId = pick;
        progressJson = JSON.stringify(meta);
        if (status === 'active') {
          await renewableQuestRepo.markReady(tx, instanceId, progressJson, at);
          status = 'ready';
        } else if (status === 'ready') {
          await renewableQuestRepo.updateProgress(tx, instanceId, progressJson, row.challengeSessionId, at);
        }
      }
    }

    if (template.proof === 'breathing_timer') {
      if (!meta.proofBreathingCopeSessionId) {
        const pick = await pickFreeBreathingCopeSessionId(tx, template, row.acceptedAt, instanceId);
        if (!pick) {
          result = { ok: false, message: 'Aucune séance de respiration éligible pour cette quête.' };
          return;
        }
        meta.proofBreathingCopeSessionId = pick;
        progressJson = JSON.stringify(meta);
        if (status === 'active') {
          await renewableQuestRepo.markReady(tx, instanceId, progressJson, at);
          status = 'ready';
        } else if (status === 'ready') {
          await renewableQuestRepo.updateProgress(tx, instanceId, progressJson, row.challengeSessionId, at);
        }
      }
    }

    let dailyEvidence: DailyEvidence | null = null;
    if (isDailyEvidenceProof(template.proof)) {
      dailyEvidence = await findDailyEvidence(tx, template, row.acceptedAt, meta.dailyParams);
      if (!dailyEvidence) {
        if (status === 'ready') await renewableQuestRepo.revertToActive(tx, instanceId, at);
        result = {
          ok: false,
          message: `Aucune action valide à récompenser. ${await explainMissingEvidence(tx, template, row.acceptedAt, meta.dailyParams)}`,
        };
        return;
      }
      meta.proofEvidenceKey = dailyEvidence.evidenceKey;
      progressJson = JSON.stringify(meta);
      if (status === 'active') {
        await renewableQuestRepo.markReady(tx, instanceId, progressJson, at);
        status = 'ready';
      }
    }

    const progress = await evaluateRenewableProof(tx, template, row.acceptedAt, progressJson, row.challengeSessionId);
    if (status !== 'ready' && !renewableProofSatisfied(template, progress, status)) {
      result = { ok: false, message: 'Objectif pas encore atteint.' };
      return;
    }
    if (status === 'active' && renewableProofSatisfied(template, progress, 'active')) {
      await renewableQuestRepo.markReady(tx, instanceId, progressJson, at);
      status = 'ready';
    }
    const dayStart = utcDayStart(now);
    const earnedToday = await getRenewableGoldEarnedToday(tx, dayStart);
    let payout = template.rewardGold;
    if (earnedToday + payout > RENEWABLE_GOLD_DAILY_CAP) {
      payout = Math.max(0, RENEWABLE_GOLD_DAILY_CAP - earnedToday);
    }
    if (dailyEvidence) {
      await insertEvidenceClaim(tx, {
        id: createId('qec'),
        evidenceKey: dailyEvidence.evidenceKey,
        evidenceGroup: dailyEvidence.evidenceGroup,
        instanceId,
        source: dailyEvidence.source,
        goldCredited: payout,
        claimedAt: at,
      });
    }
    if (payout > 0) {
      await rpgRepo.addGold(tx, payout, `Quête « ${template.title} »`, renewableRewardKey(instanceId), at);
    }
    const claimMeta = { ...parseProgressJson(progressJson), rewardGold: payout };
    await renewableQuestRepo.markClaimed(tx, instanceId, at, JSON.stringify(claimMeta));
    await renewableQuestRepo.insertHistory(tx, createId('rqh'), instanceId, template.id, template.category, at);
    if (!meta.dailyOfferId) await spawnRenewal(tx, template.category, template.id, at);
    const balance = await rpgRepo.getGoldBalance(tx);
    result = {
      ok: true,
      message: payout > 0 ? `+${payout} or — bravo !` : 'Quête terminée (plafond journalier atteint).',
      gold: payout,
      balance,
    };
  });
  return result;
}

export async function abandonRenewableQuest(db: Db, instanceId: string, now = new Date()): Promise<{ ok: boolean; message: string }> {
  let result = { ok: false, message: 'Impossible.' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const row = await renewableQuestRepo.getInstance(tx, instanceId);
    if (!row || (row.status !== 'active' && row.status !== 'ready')) {
      result = { ok: false, message: 'Quête non abandonnable.' };
      return;
    }
    if (row.challengeSessionId) {
      const session = await challengeSessionRepo.getById(tx, row.challengeSessionId);
      if (session?.state === 'running') {
        await closeChallengeSessionOnConn(tx, row.challengeSessionId, 'interrupted', { requireSportConfirm: false });
      }
    }
    const at = now.toISOString();
    await renewableQuestRepo.markFailed(tx, instanceId, at);
    const tmpl = RENEWABLE_BY_ID[row.templateId];
    if (tmpl && !parseProgressJson(row.progressJson).dailyOfferId) {
      await spawnRenewal(tx, tmpl.category, row.templateId, at);
    }
    result = { ok: true, message: 'Quête retirée du carnet.' };
  });
  return result;
}

export function categoryLabel(cat: RenewableQuestCategory): string {
  return CATEGORY_LABELS[cat];
}