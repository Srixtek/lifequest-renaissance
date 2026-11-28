import type { Db } from '../../data/db/client';
import type { SqlRunner } from '../../data/db/sqlRunner';
import {
  CATEGORY_LABELS,
  DAILY_POOL_IDS,
  DAILY_QUEST_COUNT,
  MAX_ACTIVE_RENEWABLE,
  RENEWABLE_BY_ID,
  RENEWABLE_GOLD_DAILY_CAP,
  type RenewableQuestTemplate,
} from '../../data/content/renewableQuestTemplates';
import * as renewableQuestRepo from '../../data/db/repositories/renewableQuestRepo';
import * as profileRepo from '../../data/db/repositories/profileRepo';
import * as rpgRepo from '../../data/db/repositories/rpgRepo';
import * as sportRepo from '../../data/db/repositories/sportRepo';
import { alcoholLogicalDate } from '../rules/alcohol';
import { createId } from '../../utils/id';
import { getSharedGoldEarnedToday, utcDayStart } from './goldDailyCap';
import { evaluateRenewableProof, parseProgressJson } from './renewableQuestEvidence';
import { isDailyEvidenceProof } from '../../data/content/renewableQuestTemplates';
import type { DailyParams } from './dailyQuestEvidence';
import type { QuestProgress } from './questEvidence';

/**
 * « Trois missions du jour » (V1-04B-1) : présentation + sélection au-dessus du moteur de quêtes renouvelables.
 * - Les 3 offres du jour sont figées dans `daily_quest_offers` (stables après redémarrage).
 * - Accepter crée une instance `renewable_quest_instances` ; preuve, réclamation, or (`wallet_ledger`) et plafond
 *   partagé restent ceux de `renewableQuestService`. Aucun second portefeuille ni second paiement.
 * - Renouvellement : date logique du profil (fuseau + début de journée). Plafond d'or : jour UTC (inchangé).
 * - Expiration : une offre NON acceptée expire au changement de jour. Une mission acceptée est reportée telle quelle
 *   (jamais supprimée) jusqu'à réclamation ou abandon. Remplacement : 1 offre non acceptée par jour.
 */

type Conn = Db | SqlRunner;

export interface DailyOpts {
  now?: Date;
  timeZone?: string | null;
  dayStartHour?: number;
}

interface Ctx {
  now: Date;
  timeZone: string | undefined;
  dayStartHour: number;
  today: string;
}

async function resolveCtx(db: Conn, opts: DailyOpts): Promise<Ctx> {
  const profile =
    opts.timeZone !== undefined && opts.dayStartHour !== undefined ? null : await profileRepo.getProfile(db);
  const now = opts.now ?? new Date();
  const timeZone = (opts.timeZone !== undefined ? opts.timeZone : profile?.timezone) ?? undefined;
  const dayStartHour = opts.dayStartHour ?? profile?.dayStartHour ?? 4;
  return { now, timeZone, dayStartHour, today: alcoholLogicalDate(now, timeZone, dayStartHour) };
}

interface OfferRow {
  id: string;
  localDate: string;
  slotIndex: number;
  templateId: string;
  params: DailyParams;
  state: 'offered' | 'accepted' | 'replaced' | 'expired';
  instanceId: string | null;
  createdAt: string;
}

function mapOffer(r: Record<string, unknown>): OfferRow {
  let params: DailyParams = {};
  try {
    params = r.params_json ? (JSON.parse(String(r.params_json)) as DailyParams) : {};
  } catch {
    params = {};
  }
  return {
    id: String(r.id),
    localDate: String(r.local_date),
    slotIndex: Number(r.slot_index),
    templateId: String(r.template_id),
    params,
    state: String(r.state) as OfferRow['state'],
    instanceId: r.instance_id != null ? String(r.instance_id) : null,
    createdAt: String(r.created_at),
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const kindOf = (templateId: string) => (templateId.startsWith('dq_sport_') ? 'sport' : templateId);

/** Modèles réellement faisables maintenant : jamais d'offre bloquée par un prérequis manquant. */
async function eligibleTemplates(db: Conn): Promise<Array<{ id: string; params: DailyParams }>> {
  const out: Array<{ id: string; params: DailyParams }> = [];
  for (const id of DAILY_POOL_IDS) {
    const tmpl = RENEWABLE_BY_ID[id];
    if (!tmpl) continue;
    if (tmpl.proof === 'sport_session' && tmpl.activityId) {
      const goal = await sportRepo.getLatestGoalRow(db, tmpl.activityId);
      if (!goal || goal.targetValue == null) continue;
      out.push({
        id,
        params: { activityId: tmpl.activityId, goalId: goal.id, goalMetric: goal.metric, goalTarget: goal.targetValue },
      });
      continue;
    }
    out.push({ id, params: {} });
  }
  return out;
}

async function previousDayTemplateIds(db: Conn, today: string): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ template_id: string }>(
    `SELECT template_id FROM daily_quest_offers
     WHERE local_date = (SELECT MAX(local_date) FROM daily_quest_offers WHERE local_date < ?)`,
    today,
  );
  return new Set(rows.map((r) => r.template_id));
}

async function insertOffer(
  db: Conn,
  row: { id: string; localDate: string; slotIndex: number; templateId: string; params: DailyParams; at: string },
): Promise<void> {
  await db.runAsync(
    `INSERT INTO daily_quest_offers (id, local_date, slot_index, template_id, params_json, state, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'offered', ?, ?)`,
    row.id,
    row.localDate,
    row.slotIndex,
    row.templateId,
    JSON.stringify(row.params),
    row.at,
    row.at,
  );
}

async function ensureTodaySet(tx: Conn, ctx: Ctx): Promise<void> {
  const at = ctx.now.toISOString();
  await tx.runAsync(
    `UPDATE daily_quest_offers SET state = 'expired', updated_at = ? WHERE state = 'offered' AND local_date < ?`,
    at,
    ctx.today,
  );
  const existing = await tx.getFirstAsync<{ local_date: string }>(
    `SELECT local_date FROM daily_quest_sets WHERE local_date = ?`,
    ctx.today,
  );
  if (existing) return;
  const eligible = await eligibleTemplates(tx);
  const yesterday = await previousDayTemplateIds(tx, ctx.today);
  const ordered = [...eligible].sort((a, b) => {
    const ya = yesterday.has(a.id) ? 1 : 0;
    const yb = yesterday.has(b.id) ? 1 : 0;
    if (ya !== yb) return ya - yb;
    return hash(`${ctx.today}:${a.id}`) - hash(`${ctx.today}:${b.id}`);
  });
  const picked: Array<{ id: string; params: DailyParams }> = [];
  const kinds = new Set<string>();
  for (const c of ordered) {
    if (picked.length >= DAILY_QUEST_COUNT) break;
    if (kinds.has(kindOf(c.id))) continue;
    kinds.add(kindOf(c.id));
    picked.push(c);
  }
  await tx.runAsync(
    `INSERT INTO daily_quest_sets (local_date, replacements_used, created_at, updated_at) VALUES (?, 0, ?, ?)`,
    ctx.today,
    at,
    at,
  );
  for (let i = 0; i < picked.length; i++) {
    await insertOffer(tx, {
      id: createId('dqo'),
      localDate: ctx.today,
      slotIndex: i,
      templateId: picked[i]!.id,
      params: picked[i]!.params,
      at,
    });
  }
}

export type DailyCardState = 'offered' | 'active' | 'ready' | 'claimed' | 'failed' | 'expired';

export interface DailyQuestCard {
  offerId: string;
  localDate: string;
  slotIndex: number;
  template: RenewableQuestTemplate;
  state: DailyCardState;
  instanceId: string | null;
  progress: QuestProgress | null;
  /** Mission acceptée un jour précédent, toujours en cours (reportée, jamais supprimée). */
  carriedOver: boolean;
  creditedGold: number | null;
  /** Texte précis sur l'action requise ; la cible Sport figée à l'offre est ajoutée. */
  instruction: string;
  canReplace: boolean;
}

export interface DailyQuestBlock {
  today: string;
  timeZone: string | undefined;
  dayStartHour: number;
  cards: DailyQuestCard[];
  replacementsRemaining: number;
  acceptedCount: number;
  maxAccepted: number;
  slotsFull: boolean;
  goldBalance: number;
  dailyGoldRemaining: number;
  goldCap: number;
}

function instruction(template: RenewableQuestTemplate, params: DailyParams): string {
  if (template.proof === 'sport_session' && params.goalTarget != null && params.goalMetric) {
    const unit =
      params.goalMetric === 'reps'
        ? `${params.goalTarget} répétitions`
        : params.goalMetric === 'duration_sec'
          ? `${Math.round(params.goalTarget / 60)} min`
          : `${(params.goalTarget / 1000).toLocaleString('fr-FR')} km`;
    return `${template.objective} Objectif actuel : ${unit}.`;
  }
  return template.objective;
}

async function buildCard(tx: Conn, offer: OfferRow, today: string): Promise<DailyQuestCard | null> {
  const template = RENEWABLE_BY_ID[offer.templateId];
  if (!template) return null;
  let state: DailyCardState = offer.state === 'expired' ? 'expired' : 'offered';
  let progress: QuestProgress | null = null;
  let instanceId: string | null = null;
  let creditedGold: number | null = null;
  if (offer.state === 'accepted' && offer.instanceId) {
    const row = await renewableQuestRepo.getInstance(tx, offer.instanceId);
    if (row) {
      instanceId = row.id;
      const meta = parseProgressJson(row.progressJson);
      if (row.status === 'claimed') {
        state = 'claimed';
        creditedGold = Number(meta.rewardGold ?? 0);
      } else if (row.status === 'failed') {
        state = 'failed';
      } else if (row.acceptedAt) {
        progress = await evaluateRenewableProof(tx, template, row.acceptedAt, row.progressJson, row.challengeSessionId);
        const satisfied = progress.target > 0 && progress.current >= progress.target;
        if (isDailyEvidenceProof(template.proof)) state = satisfied ? 'ready' : 'active';
        else state = row.status === 'ready' || satisfied ? 'ready' : 'active';
      }
    }
  }
  return {
    offerId: offer.id,
    localDate: offer.localDate,
    slotIndex: offer.slotIndex,
    template,
    state,
    instanceId,
    progress,
    carriedOver: offer.localDate !== today,
    creditedGold,
    instruction: instruction(template, offer.params),
    canReplace: false,
  };
}

export async function getDailyQuestBlock(db: Db, opts: DailyOpts = {}): Promise<DailyQuestBlock> {
  let block: DailyQuestBlock | null = null;
  await db.withExclusiveTransactionAsync(async (tx) => {
    const ctx = await resolveCtx(tx, opts);
    await ensureTodaySet(tx, ctx);
    block = await buildBlock(tx, ctx);
  });
  return block!;
}

async function buildBlock(tx: Conn, ctx: Ctx): Promise<DailyQuestBlock> {
  const set = await tx.getFirstAsync<{ replacements_used: number }>(
    `SELECT replacements_used FROM daily_quest_sets WHERE local_date = ?`,
    ctx.today,
  );
  const replacementsRemaining = Math.max(0, 1 - Number(set?.replacements_used ?? 0));
  const todayRows = (
    await tx.getAllAsync<Record<string, unknown>>(
      `SELECT * FROM daily_quest_offers WHERE local_date = ? AND state != 'replaced' ORDER BY slot_index ASC`,
      ctx.today,
    )
  ).map(mapOffer);
  const carriedRows = (
    await tx.getAllAsync<Record<string, unknown>>(
      `SELECT o.* FROM daily_quest_offers o
       JOIN renewable_quest_instances i ON i.id = o.instance_id
       WHERE o.local_date < ? AND o.state = 'accepted' AND i.status IN ('active', 'ready')
       ORDER BY o.local_date ASC, o.slot_index ASC`,
      ctx.today,
    )
  ).map(mapOffer);
  const cards: DailyQuestCard[] = [];
  for (const o of [...carriedRows, ...todayRows]) {
    const card = await buildCard(tx, o, ctx.today);
    if (!card) continue;
    card.canReplace = replacementsRemaining > 0 && o.localDate === ctx.today && card.state === 'offered';
    cards.push(card);
  }
  const acceptedCount = await renewableQuestRepo.countActive(tx);
  const earned = await getSharedGoldEarnedToday(tx, utcDayStart(ctx.now));
  return {
    today: ctx.today,
    timeZone: ctx.timeZone,
    dayStartHour: ctx.dayStartHour,
    cards,
    replacementsRemaining,
    acceptedCount,
    maxAccepted: MAX_ACTIVE_RENEWABLE,
    slotsFull: acceptedCount >= MAX_ACTIVE_RENEWABLE,
    goldBalance: await rpgRepo.getGoldBalance(tx),
    dailyGoldRemaining: Math.max(0, RENEWABLE_GOLD_DAILY_CAP - earned),
    goldCap: RENEWABLE_GOLD_DAILY_CAP,
  };
}

export type AcceptDailyResult = { ok: true; message: string; instanceId: string } | { ok: false; message: string };

export async function acceptDailyQuest(db: Db, offerId: string, opts: DailyOpts = {}): Promise<AcceptDailyResult> {
  let result: AcceptDailyResult = { ok: false, message: 'Mission introuvable.' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const ctx = await resolveCtx(tx, opts);
    await ensureTodaySet(tx, ctx);
    const r = await tx.getFirstAsync<Record<string, unknown>>(`SELECT * FROM daily_quest_offers WHERE id = ?`, offerId);
    const offer = r ? mapOffer(r) : null;
    if (!offer) return;
    if (offer.state === 'accepted') {
      result = { ok: false, message: 'Mission déjà acceptée.' };
      return;
    }
    if (offer.state !== 'offered' || offer.localDate !== ctx.today) {
      result = { ok: false, message: 'Cette offre n\'est plus disponible (expirée ou remplacée).' };
      return;
    }
    const template = RENEWABLE_BY_ID[offer.templateId];
    if (!template) return;
    if ((await renewableQuestRepo.countActive(tx)) >= MAX_ACTIVE_RENEWABLE) {
      result = {
        ok: false,
        message: `Carnet plein (${MAX_ACTIVE_RENEWABLE}/${MAX_ACTIVE_RENEWABLE}) : termine ou abandonne une quête acceptée pour libérer un emplacement.`,
      };
      return;
    }
    if (template.proof === 'sport_session' && template.activityId) {
      const goal = await sportRepo.getLatestGoalRow(tx, template.activityId);
      if (!goal || goal.targetValue == null) {
        result = { ok: false, message: 'Ton objectif Sport a été retiré : cette mission n\'est plus réalisable.' };
        return;
      }
    }
    const at = ctx.now.toISOString();
    const instanceId = createId('rnw');
    await renewableQuestRepo.insertOffered(tx, instanceId, template.id, template.category, template.rewardGold, at);
    const progressJson = JSON.stringify({ dailyOfferId: offer.id, dailyParams: offer.params });
    if (!(await renewableQuestRepo.markActive(tx, instanceId, at, progressJson, null))) {
      throw new Error('Activation de la mission impossible.');
    }
    await tx.runAsync(
      `UPDATE daily_quest_offers SET state = 'accepted', instance_id = ?, updated_at = ? WHERE id = ? AND state = 'offered'`,
      instanceId,
      at,
      offer.id,
    );
    result = {
      ok: true,
      message: `« ${template.title} » acceptée : l'action compte à partir de maintenant.`,
      instanceId,
    };
  });
  return result;
}

export type ReplaceDailyResult =
  | { ok: true; message: string }
  | { ok: false; code: 'limit_reached' | 'not_replaceable' | 'no_alternative'; message: string };

/** Remplace UNE offre non acceptée du jour (1 remplacement par jour). L'offre remplacée reste dans l'historique. */
export async function replaceDailyQuest(db: Db, offerId: string, opts: DailyOpts = {}): Promise<ReplaceDailyResult> {
  let result: ReplaceDailyResult = { ok: false, code: 'not_replaceable', message: 'Offre non remplaçable.' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const ctx = await resolveCtx(tx, opts);
    await ensureTodaySet(tx, ctx);
    const set = await tx.getFirstAsync<{ replacements_used: number }>(
      `SELECT replacements_used FROM daily_quest_sets WHERE local_date = ?`,
      ctx.today,
    );
    if (Number(set?.replacements_used ?? 0) >= 1) {
      result = { ok: false, code: 'limit_reached', message: 'Remplacement du jour déjà utilisé.' };
      return;
    }
    const r = await tx.getFirstAsync<Record<string, unknown>>(`SELECT * FROM daily_quest_offers WHERE id = ?`, offerId);
    const offer = r ? mapOffer(r) : null;
    if (!offer || offer.state !== 'offered' || offer.localDate !== ctx.today) {
      result = { ok: false, code: 'not_replaceable', message: 'Seule une offre du jour non acceptée peut être remplacée.' };
      return;
    }
    const todayAll = (
      await tx.getAllAsync<Record<string, unknown>>(`SELECT * FROM daily_quest_offers WHERE local_date = ?`, ctx.today)
    ).map(mapOffer);
    const usedToday = new Set(todayAll.map((o) => o.templateId));
    const keptKinds = new Set(
      todayAll.filter((o) => o.state !== 'replaced' && o.id !== offer.id).map((o) => kindOf(o.templateId)),
    );
    const candidates = (await eligibleTemplates(tx))
      .filter((c) => !usedToday.has(c.id))
      .sort((a, b) => {
        const ka = keptKinds.has(kindOf(a.id)) ? 1 : 0;
        const kb = keptKinds.has(kindOf(b.id)) ? 1 : 0;
        if (ka !== kb) return ka - kb;
        return hash(`${ctx.today}:r:${a.id}`) - hash(`${ctx.today}:r:${b.id}`);
      });
    const next = candidates[0];
    if (!next) {
      result = { ok: false, code: 'no_alternative', message: 'Aucune autre mission disponible aujourd\'hui.' };
      return;
    }
    const at = ctx.now.toISOString();
    const newId = createId('dqo');
    await tx.runAsync(
      `UPDATE daily_quest_offers SET state = 'replaced', replaced_by = ?, updated_at = ? WHERE id = ? AND state = 'offered'`,
      newId,
      at,
      offer.id,
    );
    await insertOffer(tx, {
      id: newId,
      localDate: ctx.today,
      slotIndex: offer.slotIndex,
      templateId: next.id,
      params: next.params,
      at,
    });
    await tx.runAsync(
      `UPDATE daily_quest_sets SET replacements_used = 1, updated_at = ? WHERE local_date = ?`,
      at,
      ctx.today,
    );
    result = { ok: true, message: `Mission remplacée par « ${RENEWABLE_BY_ID[next.id]?.title ?? next.id} ».` };
  });
  return result;
}

export type DailyHistoryOutcome = 'claimed' | 'failed' | 'replaced' | 'expired' | 'active' | 'ready' | 'offered';

export interface DailyHistoryEntry {
  offerId: string;
  localDate: string;
  title: string;
  categoryLabel: string;
  outcome: DailyHistoryOutcome;
  creditedGold: number | null;
  evidenceKey: string | null;
  claimedAt: string | null;
}

/** Missions terminées, échouées, remplacées, expirées ou en cours, avec preuve utilisée et or réellement crédité. */
export async function listDailyQuestHistory(db: Conn, limit = 40): Promise<DailyHistoryEntry[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT o.*, i.status AS inst_status, i.progress_json AS inst_progress, i.claimed_at AS inst_claimed
     FROM daily_quest_offers o LEFT JOIN renewable_quest_instances i ON i.id = o.instance_id
     ORDER BY o.local_date DESC, o.slot_index ASC, o.created_at DESC LIMIT ?`,
    limit,
  );
  const out: DailyHistoryEntry[] = [];
  for (const r of rows) {
    const offer = mapOffer(r);
    const template = RENEWABLE_BY_ID[offer.templateId];
    if (!template) continue;
    let outcome: DailyHistoryOutcome =
      offer.state === 'replaced' ? 'replaced' : offer.state === 'expired' ? 'expired' : 'offered';
    let credited: number | null = null;
    let evidenceKey: string | null = null;
    if (offer.state === 'accepted') {
      const st = String(r.inst_status ?? 'active');
      outcome = st === 'claimed' ? 'claimed' : st === 'failed' ? 'failed' : st === 'ready' ? 'ready' : 'active';
      if (st === 'claimed') {
        const meta = parseProgressJson(r.inst_progress != null ? String(r.inst_progress) : null);
        credited = Number(meta.rewardGold ?? 0);
        evidenceKey = meta.proofEvidenceKey ?? null;
      }
    }
    out.push({
      offerId: offer.id,
      localDate: offer.localDate,
      title: template.title,
      categoryLabel: template.dailyTag ?? CATEGORY_LABELS[template.category],
      outcome,
      creditedGold: credited,
      evidenceKey,
      claimedAt: r.inst_claimed != null ? String(r.inst_claimed) : null,
    });
  }
  return out;
}
