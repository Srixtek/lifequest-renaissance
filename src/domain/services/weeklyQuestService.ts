import type { Db } from '../../data/db/client';
import type { SqlRunner } from '../../data/db/sqlRunner';
import {
  CATEGORY_LABELS,
  MAX_ACTIVE_RENEWABLE,
  RENEWABLE_GOLD_DAILY_CAP,
  WEEKLY_BY_ID,
  WEEKLY_TEMPLATES,
  type WeeklyQuestTemplate,
} from '../../data/content/renewableQuestTemplates';
import * as renewableQuestRepo from '../../data/db/repositories/renewableQuestRepo';
import * as rpgRepo from '../../data/db/repositories/rpgRepo';
import { addDays } from '../rules/dates';
import { weekBoundsMondaySunday } from '../rules/weeklyTracking';
import { createId } from '../../utils/id';
import { resolveCtx, type Ctx, type DailyOpts } from './dailyQuestService';
import { getSharedGoldEarnedToday, utcDayStart } from './goldDailyCap';
import { insertEvidenceAllocation } from './questEvidenceClaims';
import { parseProgressJson } from './renewableQuestEvidence';
import { renewableRewardKey } from './renewableQuestService';
import {
  explainWeeklyMissing,
  findWeeklyEvidence,
  type WeeklyEvidenceItem,
  type WeeklyWindow,
} from './weeklyQuestEvidence';

/**
 * « Missions de la semaine » (V1-04B-2) : au-dessus du moteur de quêtes renouvelables.
 * - 2 offres par semaine (lundi → dimanche, date logique du profil), figées dans `weekly_quest_offers`.
 * - Une seule mission hebdomadaire acceptée à la fois ; elle occupe l'un des 3 emplacements de quêtes actifs.
 * - Accepter crée une instance `renewable_quest_instances` (progress_json.weeklyOfferId). Or : `wallet_ledger` clé
 *   `renewable:<id>:reward` → compté par le plafond partagé de 50 or/jour. Aucun second portefeuille.
 * - Plusieurs preuves par mission : `quest_evidence_allocations` (la table 017 est UNIQUE(instance_id)).
 *   Les allocations ne sont écrites qu'à la réclamation, dans la même transaction exclusive que le crédit d'or.
 * - Échéance : offre non acceptée → expirée. Mission acceptée incomplète → échouée (sans pénalité). Mission complète
 *   avant l'échéance : reste réclamable ensuite (les preuves sont bornées à la semaine, jamais rétroactives).
 */

type Conn = Db | SqlRunner;

const EPOCH_MONDAY = Date.UTC(2024, 0, 1);

function weekIndex(weekStart: string): number {
  const [y, m, d] = weekStart.split('-').map(Number);
  return Math.floor((Date.UTC(y!, m! - 1, d!) - EPOCH_MONDAY) / (7 * 86400000));
}

function weekOf(ctx: Ctx): { start: string; end: string } {
  return weekBoundsMondaySunday(ctx.today);
}

function windowFor(ctx: Ctx, weekStart: string, acceptedAt: string): WeeklyWindow {
  return {
    acceptedAt,
    weekStart,
    weekEnd: addDays(weekStart, 6),
    timeZone: ctx.timeZone,
    dayStartHour: ctx.dayStartHour,
  };
}

interface WeeklyOfferRow {
  id: string;
  weekStart: string;
  slotIndex: number;
  templateId: string;
  state: 'offered' | 'accepted' | 'replaced' | 'expired';
  instanceId: string | null;
  closedReason: 'expired' | 'abandoned' | null;
}

function mapOffer(r: Record<string, unknown>): WeeklyOfferRow {
  return {
    id: String(r.id),
    weekStart: String(r.week_start),
    slotIndex: Number(r.slot_index),
    templateId: String(r.template_id),
    state: String(r.state) as WeeklyOfferRow['state'],
    instanceId: r.instance_id != null ? String(r.instance_id) : null,
    closedReason: r.closed_reason != null ? (String(r.closed_reason) as 'expired' | 'abandoned') : null,
  };
}

async function evidenceFor(tx: Conn, ctx: Ctx, offer: WeeklyOfferRow, acceptedAt: string): Promise<WeeklyEvidenceItem[]> {
  const template = WEEKLY_BY_ID[offer.templateId];
  if (!template) return [];
  return findWeeklyEvidence(tx, template, windowFor(ctx, offer.weekStart, acceptedAt));
}

/** Instances hebdomadaires encore ouvertes (active) dont la semaine est terminée : réussite conservée, sinon échec. */
async function settleExpiredMissions(tx: Conn, ctx: Ctx): Promise<void> {
  const week = weekOf(ctx);
  const rows = await tx.getAllAsync<Record<string, unknown>>(
    `SELECT o.* FROM weekly_quest_offers o JOIN renewable_quest_instances i ON i.id = o.instance_id
     WHERE o.state = 'accepted' AND o.week_start < ? AND i.status = 'active'`,
    week.start,
  );
  const at = ctx.now.toISOString();
  for (const r of rows) {
    const offer = mapOffer(r);
    const template = WEEKLY_BY_ID[offer.templateId];
    const inst = offer.instanceId ? await renewableQuestRepo.getInstance(tx, offer.instanceId) : null;
    if (!template || !inst?.acceptedAt) continue;
    const items = await evidenceFor(tx, ctx, offer, inst.acceptedAt);
    if (items.length >= template.steps) continue;
    if (await renewableQuestRepo.markFailed(tx, inst.id, at)) {
      await tx.runAsync(
        `UPDATE weekly_quest_offers SET closed_reason = 'expired', updated_at = ? WHERE id = ?`,
        at,
        offer.id,
      );
    }
  }
}

async function ensureWeek(tx: Conn, ctx: Ctx): Promise<void> {
  const at = ctx.now.toISOString();
  const week = weekOf(ctx);
  await tx.runAsync(
    `UPDATE weekly_quest_offers SET state = 'expired', updated_at = ? WHERE state = 'offered' AND week_start < ?`,
    at,
    week.start,
  );
  await settleExpiredMissions(tx, ctx);
  const existing = await tx.getFirstAsync<{ week_start: string }>(
    `SELECT week_start FROM weekly_quest_sets WHERE week_start = ?`,
    week.start,
  );
  if (existing) return;
  const idx = weekIndex(week.start);
  const n = WEEKLY_TEMPLATES.length;
  await tx.runAsync(
    `INSERT INTO weekly_quest_sets (week_start, replacements_used, created_at, updated_at) VALUES (?, 0, ?, ?)`,
    week.start,
    at,
    at,
  );
  for (let slot = 0; slot < 2; slot++) {
    const tmpl = WEEKLY_TEMPLATES[(((idx + slot) % n) + n) % n]!;
    await tx.runAsync(
      `INSERT INTO weekly_quest_offers (id, week_start, slot_index, template_id, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'offered', ?, ?)`,
      createId('wqo'),
      week.start,
      slot,
      tmpl.id,
      at,
      at,
    );
  }
}

export type WeeklyCardState = 'offered' | 'active' | 'ready' | 'claimed' | 'failed' | 'abandoned' | 'expired';

export interface WeeklyQuestCard {
  offerId: string;
  weekStart: string;
  weekEnd: string;
  template: WeeklyQuestTemplate;
  categoryLabel: string;
  state: WeeklyCardState;
  instanceId: string | null;
  steps: number;
  done: number;
  doneLabels: string[];
  carriedOver: boolean;
  creditedGold: number | null;
  canReplace: boolean;
  /** Il manque des étapes ? Explication courte. */
  hint: string;
}

export interface WeeklyQuestBlock {
  today: string;
  weekStart: string;
  weekEnd: string;
  cards: WeeklyQuestCard[];
  replacementsRemaining: number;
  acceptedCount: number;
  maxAccepted: number;
  slotsFull: boolean;
  weeklyAccepted: boolean;
  goldBalance: number;
  dailyGoldRemaining: number;
  goldCap: number;
}

async function buildCard(tx: Conn, ctx: Ctx, offer: WeeklyOfferRow): Promise<WeeklyQuestCard | null> {
  const template = WEEKLY_BY_ID[offer.templateId];
  if (!template) return null;
  let state: WeeklyCardState = offer.state === 'expired' ? 'expired' : 'offered';
  let items: WeeklyEvidenceItem[] = [];
  let credited: number | null = null;
  let instanceId: string | null = null;
  if (offer.state === 'accepted' && offer.instanceId) {
    const row = await renewableQuestRepo.getInstance(tx, offer.instanceId);
    if (row) {
      instanceId = row.id;
      if (row.status === 'claimed') {
        state = 'claimed';
        credited = Number(parseProgressJson(row.progressJson).rewardGold ?? 0);
      } else if (row.status === 'failed') {
        state = offer.closedReason === 'abandoned' ? 'abandoned' : 'failed';
      } else if (row.acceptedAt) {
        items = await evidenceFor(tx, ctx, offer, row.acceptedAt);
        state = items.length >= template.steps ? 'ready' : 'active';
      }
    }
  }
  const done = state === 'claimed' ? template.steps : Math.min(items.length, template.steps);
  return {
    offerId: offer.id,
    weekStart: offer.weekStart,
    weekEnd: addDays(offer.weekStart, 6),
    template,
    categoryLabel: CATEGORY_LABELS[template.category],
    state,
    instanceId,
    steps: template.steps,
    done,
    doneLabels: state === 'claimed' ? [] : items.map((i) => i.label),
    carriedOver: offer.weekStart < weekOf(ctx).start,
    creditedGold: credited,
    canReplace: false,
    hint: state === 'active' ? explainWeeklyMissing(template) : '',
  };
}

async function weeklyAcceptedCount(tx: Conn): Promise<number> {
  const r = await tx.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) AS c FROM weekly_quest_offers o JOIN renewable_quest_instances i ON i.id = o.instance_id
     WHERE o.state = 'accepted' AND i.status IN ('active', 'ready')`,
  );
  return Number(r?.c ?? 0);
}

async function buildBlock(tx: Conn, ctx: Ctx): Promise<WeeklyQuestBlock> {
  const week = weekOf(ctx);
  const set = await tx.getFirstAsync<{ replacements_used: number }>(
    `SELECT replacements_used FROM weekly_quest_sets WHERE week_start = ?`,
    week.start,
  );
  const replacementsRemaining = Math.max(0, 1 - Number(set?.replacements_used ?? 0));
  const carried = (
    await tx.getAllAsync<Record<string, unknown>>(
      `SELECT o.* FROM weekly_quest_offers o JOIN renewable_quest_instances i ON i.id = o.instance_id
       WHERE o.week_start < ? AND o.state = 'accepted' AND i.status IN ('active', 'ready')
       ORDER BY o.week_start ASC, o.slot_index ASC`,
      week.start,
    )
  ).map(mapOffer);
  const current = (
    await tx.getAllAsync<Record<string, unknown>>(
      `SELECT * FROM weekly_quest_offers WHERE week_start = ? AND state != 'replaced' ORDER BY slot_index ASC`,
      week.start,
    )
  ).map(mapOffer);
  const cards: WeeklyQuestCard[] = [];
  for (const o of [...carried, ...current]) {
    const card = await buildCard(tx, ctx, o);
    if (!card) continue;
    card.canReplace = replacementsRemaining > 0 && o.weekStart === week.start && card.state === 'offered';
    cards.push(card);
  }
  const acceptedCount = await renewableQuestRepo.countActive(tx);
  const earned = await getSharedGoldEarnedToday(tx, utcDayStart(ctx.now));
  return {
    today: ctx.today,
    weekStart: week.start,
    weekEnd: week.end,
    cards,
    replacementsRemaining,
    acceptedCount,
    maxAccepted: MAX_ACTIVE_RENEWABLE,
    slotsFull: acceptedCount >= MAX_ACTIVE_RENEWABLE,
    weeklyAccepted: (await weeklyAcceptedCount(tx)) > 0,
    goldBalance: await rpgRepo.getGoldBalance(tx),
    dailyGoldRemaining: Math.max(0, RENEWABLE_GOLD_DAILY_CAP - earned),
    goldCap: RENEWABLE_GOLD_DAILY_CAP,
  };
}

export async function getWeeklyQuestBlock(db: Db, opts: DailyOpts = {}): Promise<WeeklyQuestBlock> {
  let block: WeeklyQuestBlock | null = null;
  await db.withExclusiveTransactionAsync(async (tx) => {
    const ctx = await resolveCtx(tx, opts);
    await ensureWeek(tx, ctx);
    block = await buildBlock(tx, ctx);
  });
  return block!;
}

export type AcceptWeeklyResult = { ok: true; message: string; instanceId: string } | { ok: false; message: string };

export async function acceptWeeklyQuest(db: Db, offerId: string, opts: DailyOpts = {}): Promise<AcceptWeeklyResult> {
  let result: AcceptWeeklyResult = { ok: false, message: 'Mission introuvable.' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const ctx = await resolveCtx(tx, opts);
    await ensureWeek(tx, ctx);
    const r = await tx.getFirstAsync<Record<string, unknown>>(`SELECT * FROM weekly_quest_offers WHERE id = ?`, offerId);
    const offer = r ? mapOffer(r) : null;
    if (!offer) return;
    if (offer.state === 'accepted') {
      result = { ok: false, message: 'Mission déjà acceptée.' };
      return;
    }
    if (offer.state !== 'offered' || offer.weekStart !== weekOf(ctx).start) {
      result = { ok: false, message: 'Cette offre n\'est plus disponible (expirée ou remplacée).' };
      return;
    }
    const template = WEEKLY_BY_ID[offer.templateId];
    if (!template) return;
    if ((await weeklyAcceptedCount(tx)) > 0) {
      result = {
        ok: false,
        message: 'Une seule mission de la semaine à la fois : termine ou abandonne celle en cours.',
      };
      return;
    }
    if ((await renewableQuestRepo.countActive(tx)) >= MAX_ACTIVE_RENEWABLE) {
      result = {
        ok: false,
        message: `Carnet plein (${MAX_ACTIVE_RENEWABLE}/${MAX_ACTIVE_RENEWABLE}) : termine ou abandonne une quête acceptée pour libérer un emplacement.`,
      };
      return;
    }
    const at = ctx.now.toISOString();
    const instanceId = createId('rnw');
    await renewableQuestRepo.insertOffered(tx, instanceId, template.id, template.category, template.rewardGold, at);
    const progressJson = JSON.stringify({ weeklyOfferId: offer.id, weekStart: offer.weekStart });
    if (!(await renewableQuestRepo.markActive(tx, instanceId, at, progressJson, null))) {
      throw new Error('Activation de la mission impossible.');
    }
    await tx.runAsync(
      `UPDATE weekly_quest_offers SET state = 'accepted', instance_id = ?, updated_at = ? WHERE id = ? AND state = 'offered'`,
      instanceId,
      at,
      offer.id,
    );
    result = {
      ok: true,
      message: `« ${template.title} » acceptée : seules les actions faites à partir de maintenant comptent.`,
      instanceId,
    };
  });
  return result;
}

export type ReplaceWeeklyResult =
  | { ok: true; message: string }
  | { ok: false; code: 'limit_reached' | 'not_replaceable' | 'no_alternative'; message: string };

/** Remplace UNE offre non acceptée de la semaine (1 remplacement par semaine). L'offre remplacée reste dans l'historique. */
export async function replaceWeeklyQuest(db: Db, offerId: string, opts: DailyOpts = {}): Promise<ReplaceWeeklyResult> {
  let result: ReplaceWeeklyResult = { ok: false, code: 'not_replaceable', message: 'Offre non remplaçable.' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const ctx = await resolveCtx(tx, opts);
    await ensureWeek(tx, ctx);
    const week = weekOf(ctx);
    const set = await tx.getFirstAsync<{ replacements_used: number }>(
      `SELECT replacements_used FROM weekly_quest_sets WHERE week_start = ?`,
      week.start,
    );
    if (Number(set?.replacements_used ?? 0) >= 1) {
      result = { ok: false, code: 'limit_reached', message: 'Remplacement de la semaine déjà utilisé.' };
      return;
    }
    const r = await tx.getFirstAsync<Record<string, unknown>>(`SELECT * FROM weekly_quest_offers WHERE id = ?`, offerId);
    const offer = r ? mapOffer(r) : null;
    if (!offer || offer.state !== 'offered' || offer.weekStart !== week.start) {
      result = { ok: false, code: 'not_replaceable', message: 'Seule une offre de la semaine non acceptée peut être remplacée.' };
      return;
    }
    const all = (
      await tx.getAllAsync<Record<string, unknown>>(`SELECT * FROM weekly_quest_offers WHERE week_start = ?`, week.start)
    ).map(mapOffer);
    const used = new Set(all.map((o) => o.templateId));
    const next = WEEKLY_TEMPLATES.find((t) => !used.has(t.id));
    if (!next) {
      result = { ok: false, code: 'no_alternative', message: 'Aucune autre mission disponible cette semaine.' };
      return;
    }
    const at = ctx.now.toISOString();
    const newId = createId('wqo');
    await tx.runAsync(
      `UPDATE weekly_quest_offers SET state = 'replaced', replaced_by = ?, updated_at = ? WHERE id = ? AND state = 'offered'`,
      newId,
      at,
      offer.id,
    );
    await tx.runAsync(
      `INSERT INTO weekly_quest_offers (id, week_start, slot_index, template_id, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'offered', ?, ?)`,
      newId,
      week.start,
      offer.slotIndex,
      next.id,
      at,
      at,
    );
    await tx.runAsync(
      `UPDATE weekly_quest_sets SET replacements_used = 1, updated_at = ? WHERE week_start = ?`,
      at,
      week.start,
    );
    result = { ok: true, message: `Mission remplacée par « ${next.title} ».` };
  });
  return result;
}

export type ClaimWeeklyResult =
  | { ok: true; message: string; gold: number; balance: number }
  | { ok: false; message: string };

/**
 * Réclamation (transaction exclusive) : relit TOUTES les preuves, vérifie dates/validité/non-consommation,
 * les attribue à la mission, calcule l'or disponible (plafond partagé), crédite, marque réclamée. Tout ou rien.
 */
export async function claimWeeklyQuest(db: Db, instanceId: string, opts: DailyOpts = {}): Promise<ClaimWeeklyResult> {
  let result: ClaimWeeklyResult = { ok: false, message: 'Réclamation impossible.' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const ctx = await resolveCtx(tx, opts);
    await ensureWeek(tx, ctx);
    const row = await renewableQuestRepo.getInstance(tx, instanceId);
    const offerRow = await tx.getFirstAsync<Record<string, unknown>>(
      `SELECT * FROM weekly_quest_offers WHERE instance_id = ?`,
      instanceId,
    );
    if (!row || !offerRow) {
      result = { ok: false, message: 'Mission introuvable.' };
      return;
    }
    const offer = mapOffer(offerRow);
    const template = WEEKLY_BY_ID[offer.templateId];
    if (!template) return;
    if (row.status === 'claimed') {
      result = { ok: false, message: 'Récompense déjà réclamée.' };
      return;
    }
    if (row.status === 'failed') {
      result = { ok: false, message: 'Mission échouée ou abandonnée — aucune récompense.' };
      return;
    }
    if (!row.acceptedAt || row.status !== 'active') {
      result = { ok: false, message: 'Mission non acceptée.' };
      return;
    }
    const items = await evidenceFor(tx, ctx, offer, row.acceptedAt);
    if (items.length < template.steps) {
      result = {
        ok: false,
        message: `Progression ${items.length}/${template.steps} : mission pas terminée. ${explainWeeklyMissing(template)}`,
      };
      return;
    }
    const at = ctx.now.toISOString();
    const earned = await getSharedGoldEarnedToday(tx, utcDayStart(ctx.now));
    const payout = Math.max(0, Math.min(template.rewardGold, RENEWABLE_GOLD_DAILY_CAP - earned));
    for (const it of items.slice(0, template.steps)) {
      await insertEvidenceAllocation(tx, {
        id: createId('qea'),
        evidenceKey: it.evidenceKey,
        evidenceGroup: it.evidenceGroup,
        instanceId,
        source: it.source,
        claimedAt: at,
      });
    }
    if (payout > 0) {
      await rpgRepo.addGold(tx, payout, `Mission de la semaine « ${template.title} »`, renewableRewardKey(instanceId), at);
    }
    if (!(await renewableQuestRepo.markReady(tx, instanceId, row.progressJson, at))) {
      throw new Error('Mission non réclamable.');
    }
    const claimMeta = {
      ...parseProgressJson(row.progressJson),
      rewardGold: payout,
      proofEvidenceKeys: items.map((i) => i.evidenceKey),
    };
    if (!(await renewableQuestRepo.markClaimed(tx, instanceId, at, JSON.stringify(claimMeta)))) {
      throw new Error('Réclamation impossible.');
    }
    await renewableQuestRepo.insertHistory(tx, createId('rqh'), instanceId, template.id, template.category, at);
    const balance = await rpgRepo.getGoldBalance(tx);
    result = {
      ok: true,
      message: payout > 0 ? `+${payout} or — bravo !` : 'Mission terminée (plafond journalier atteint) : 0 or crédité.',
      gold: payout,
      balance,
    };
  });
  return result;
}

export async function abandonWeeklyQuest(db: Db, instanceId: string, opts: DailyOpts = {}): Promise<{ ok: boolean; message: string }> {
  let result = { ok: false, message: 'Mission non abandonnable.' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const ctx = await resolveCtx(tx, opts);
    const row = await renewableQuestRepo.getInstance(tx, instanceId);
    const offerRow = await tx.getFirstAsync<Record<string, unknown>>(
      `SELECT * FROM weekly_quest_offers WHERE instance_id = ?`,
      instanceId,
    );
    if (!row || !offerRow || row.status !== 'active') return;
    const at = ctx.now.toISOString();
    if (!(await renewableQuestRepo.markFailed(tx, instanceId, at))) return;
    await tx.runAsync(
      `UPDATE weekly_quest_offers SET closed_reason = 'abandoned', updated_at = ? WHERE instance_id = ?`,
      at,
      instanceId,
    );
    result = { ok: true, message: 'Mission retirée du carnet, sans pénalité.' };
  });
  return result;
}

export type WeeklyHistoryOutcome = 'claimed' | 'failed' | 'abandoned' | 'replaced' | 'expired' | 'active' | 'ready' | 'offered';

export interface WeeklyHistoryEntry {
  offerId: string;
  weekStart: string;
  title: string;
  outcome: WeeklyHistoryOutcome;
  creditedGold: number | null;
}

export async function listWeeklyQuestHistory(db: Conn, limit = 30): Promise<WeeklyHistoryEntry[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT o.*, i.status AS inst_status, i.progress_json AS inst_progress
     FROM weekly_quest_offers o LEFT JOIN renewable_quest_instances i ON i.id = o.instance_id
     ORDER BY o.week_start DESC, o.slot_index ASC, o.created_at DESC LIMIT ?`,
    limit,
  );
  const out: WeeklyHistoryEntry[] = [];
  for (const r of rows) {
    const offer = mapOffer(r);
    const template = WEEKLY_BY_ID[offer.templateId];
    if (!template) continue;
    let outcome: WeeklyHistoryOutcome =
      offer.state === 'replaced' ? 'replaced' : offer.state === 'expired' ? 'expired' : 'offered';
    let credited: number | null = null;
    if (offer.state === 'accepted') {
      const st = String(r.inst_status ?? 'active');
      outcome =
        st === 'claimed'
          ? 'claimed'
          : st === 'failed'
            ? offer.closedReason === 'abandoned'
              ? 'abandoned'
              : 'failed'
            : st === 'ready'
              ? 'ready'
              : 'active';
      if (st === 'claimed') {
        credited = Number(parseProgressJson(r.inst_progress != null ? String(r.inst_progress) : null).rewardGold ?? 0);
      }
    }
    out.push({ offerId: offer.id, weekStart: offer.weekStart, title: template.title, outcome, creditedGold: credited });
  }
  return out;
}
