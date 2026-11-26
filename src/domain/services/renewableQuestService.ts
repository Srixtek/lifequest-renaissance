import type { Db } from '../../data/db/client';
import type { SqlRunner } from '../../data/db/sqlRunner';
import {
  CATEGORY_LABELS,
  MAX_ACTIVE_RENEWABLE,
  MAX_RECOMMENDED_OFFERS,
  RENEWABLE_BY_ID,
  RENEWABLE_GOLD_DAILY_CAP,
  RENEWABLE_TEMPLATES,
  type RenewableQuestCategory,
  type RenewableQuestTemplate,
} from '../../data/content/renewableQuestTemplates';
import * as renewableQuestRepo from '../../data/db/repositories/renewableQuestRepo';
import * as goalRepo from '../../data/db/repositories/goalRepo';
import * as kingdomRepo from '../../data/db/repositories/kingdomRepo';
import * as rpgRepo from '../../data/db/repositories/rpgRepo';
import { createId } from '../../utils/id';
import {
  evaluateRenewableProof,
  parseProgressJson,
  type InlineTimerProgress,
} from './renewableQuestEvidence';
import type { QuestProgress } from './questEvidence';
import {
  closeChallengeSession,
  completeScreenChallenge,
  completeSportChallenge,
  displayElapsedSec,
  startChallengeSession,
} from './challengeService';
import { recordBreathingSession } from './toolsService';
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

async function ensureOffers(db: Conn): Promise<void> {
  const rows = await renewableQuestRepo.listInstances(db);
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
    if (!tmpl) continue;
    await renewableQuestRepo.insertOffered(db, createId('rnw'), tmpl.id, cat, tmpl.rewardGold, now);
  }
}

export async function getRenewableGoldEarnedToday(db: Conn, dayStartIso: string): Promise<number> {
  const r = await db.getFirstAsync<{ s: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS s FROM wallet_ledger
     WHERE resource = 'gold' AND idempotency_key LIKE 'renewable:%' AND created_at >= ?`,
    dayStartIso,
  );
  return Number(r?.s ?? 0);
}

function utcDayStart(now = new Date()): string {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
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
    let state: RenewableBoardState = row.status;
    if (row.status === 'active' && progress.current >= progress.target && progress.target > 0) {
      const meets =
        template.proof === 'breathing_timer' || template.proof === 'inline_challenge'
          ? progress.label.includes('1 / 1')
          : progress.current >= 1;
      if (meets) state = 'ready';
    }
    const meta = parseProgressJson(row.progressJson);
    entries.push({
      instanceId: row.id,
      template,
      state,
      progress,
      acceptedAt: row.acceptedAt,
      claimedAt: row.claimedAt,
      challengeSessionId: row.challengeSessionId,
      timerRunning: meta.timer?.state === 'running',
    });
  }

  const priority = (e: RenewableBoardEntry) => {
    if (e.state === 'ready') return 0;
    if (e.state === 'active') return 1;
    if (e.state === 'offered') return 2;
    return 3;
  };
  const recommended = [...entries]
    .filter((e) => e.state !== 'claimed' && e.state !== 'failed')
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
    const ready =
      template.proof === 'habit_declaration' ||
      template.proof === 'combat_victory' ||
      template.proof === 'forge_upgrade' ||
      template.proof === 'adaptive_vape_complete'
        ? progress.current >= 1
        : progress.label.includes('1 / 1');
    if (ready) {
      await renewableQuestRepo.markReady(tx, instanceId, row.progressJson, now.toISOString());
    }
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
    if (!row?.acceptedAt) {
      result = { ok: false, message: 'Accepte la quête avant de lancer le chrono.' };
      return;
    }
    const template = RENEWABLE_BY_ID[row.templateId];
    if (!template) return;

    if (template.proof === 'breathing_timer') {
      const target = template.targetDurationSec ?? 180;
      const timer: InlineTimerProgress = { kind: 'breathing', startedUtc: at, targetSec: target, state: 'running' };
      const progressJson = JSON.stringify({ ...parseProgressJson(row.progressJson), timer });
      await renewableQuestRepo.updateProgress(tx, instanceId, progressJson, null, at);
      if (row.status === 'offered') {
        await renewableQuestRepo.markActive(tx, instanceId, at, progressJson, null);
      }
      result = { ok: true, message: 'Chrono respiration démarré.' };
      return;
    }

    if (template.proof === 'inline_challenge' && template.challengeType) {
      const started = await startChallengeSession(tx, template.challengeType, template.targetDurationSec ?? null);
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
      const progressJson = JSON.stringify({ ...parseProgressJson(row.progressJson), timer });
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
        await closeChallengeSession(tx, row.challengeSessionId, 'interrupted', { requireSportConfirm: false });
      }
    }
    const meta = parseProgressJson(row.progressJson);
    if (meta.timer) meta.timer.state = 'stopped';
    await renewableQuestRepo.updateProgress(tx, instanceId, JSON.stringify(meta), null, at);
    await renewableQuestRepo.markFailed(tx, instanceId, at);
    const tmpl = RENEWABLE_BY_ID[row.templateId];
  const replacement = tmpl ? await pickTemplateForCategory(tx, tmpl.category, row.templateId) : null;
    if (replacement) {
      await renewableQuestRepo.insertOffered(tx, createId('rnw'), replacement.id, replacement.category, replacement.rewardGold, at);
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
      await recordBreathingSession(tx, target, true);
      if (timer) timer.state = 'stopped';
      await renewableQuestRepo.updateProgress(tx, instanceId, JSON.stringify({ ...meta, timer }), null, at);
      await renewableQuestRepo.markReady(tx, instanceId, row.progressJson, at);
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
      if (session.type === 'sport') {
        await completeSportChallenge(tx, session.id, target);
      } else if (session.type === 'no_screen') {
        await completeScreenChallenge(tx, session.id, true);
      } else {
        await closeChallengeSession(tx, session.id, 'completed', { requireSportConfirm: false });
      }
      await renewableQuestRepo.markReady(tx, instanceId, row.progressJson, at);
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
        await closeChallengeSession(tx, session.id, 'interrupted', { requireSportConfirm: false });
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
  if (next) {
    await renewableQuestRepo.insertOffered(tx, createId('rnw'), next.id, next.category, next.rewardGold, at);
  }
}

export async function claimRenewableQuest(db: Db, instanceId: string, now = new Date()): Promise<{ ok: boolean; message: string; gold?: number; balance?: number }> {
  let result: { ok: boolean; message: string; gold?: number; balance?: number } = { ok: false, message: 'Réclamation impossible.' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const row = await renewableQuestRepo.getInstance(tx, instanceId);
    if (row?.status === 'claimed') {
      result = { ok: false, message: 'Récompense déjà réclamée.' };
      return;
    }
    if (!row?.acceptedAt) {
      result = { ok: false, message: 'Quête non acceptée.' };
      return;
    }
    const template = RENEWABLE_BY_ID[row.templateId];
    if (!template) return;
    const progress = await evaluateRenewableProof(tx, template, row.acceptedAt, row.progressJson, row.challengeSessionId);
    const ready =
      template.proof === 'habit_declaration' ||
      template.proof === 'combat_victory' ||
      template.proof === 'forge_upgrade' ||
      template.proof === 'adaptive_vape_complete'
        ? progress.current >= 1
        : progress.label.includes('1 / 1');
    if (!ready && row.status !== 'ready') {
      result = { ok: false, message: 'Objectif pas encore atteint.' };
      return;
    }
    const dayStart = utcDayStart(now);
    const earnedToday = await getRenewableGoldEarnedToday(tx, dayStart);
    let payout = template.rewardGold;
    if (earnedToday + payout > RENEWABLE_GOLD_DAILY_CAP) {
      payout = Math.max(0, RENEWABLE_GOLD_DAILY_CAP - earnedToday);
    }
    const at = now.toISOString();
    if (payout > 0) {
      await rpgRepo.addGold(tx, payout, `Quête « ${template.title} »`, renewableRewardKey(instanceId), at);
    }
    await renewableQuestRepo.markClaimed(tx, instanceId, at, JSON.stringify({ rewardGold: payout }));
    await renewableQuestRepo.insertHistory(tx, createId('rqh'), instanceId, template.id, template.category, at);
    await spawnRenewal(tx, template.category, template.id, at);
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
        await closeChallengeSession(tx, row.challengeSessionId, 'interrupted', { requireSportConfirm: false });
      }
    }
    const at = now.toISOString();
    await renewableQuestRepo.markFailed(tx, instanceId, at);
    const tmpl = RENEWABLE_BY_ID[row.templateId];
    if (tmpl) await spawnRenewal(tx, tmpl.category, row.templateId, at);
    result = { ok: true, message: 'Quête retirée du carnet.' };
  });
  return result;
}

export function categoryLabel(cat: RenewableQuestCategory): string {
  return CATEGORY_LABELS[cat];
}