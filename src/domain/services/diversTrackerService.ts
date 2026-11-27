import type { Db } from '../../data/db/client';
import type { SqlRunner } from '../../data/db/sqlRunner';
import * as diversRepo from '../../data/db/repositories/diversRepo';
import type { DiversCompletionRow, DiversDaySlotsRow } from '../../data/db/repositories/diversRepo';
import * as profileRepo from '../../data/db/repositories/profileRepo';
import {
  DIVERS_ACTIVITIES,
  DIVERS_ACTIVITY_BY_ID,
  DIVERS_ACTIVITY_IDS,
  isDiversActivityId,
  type DiversActivityDef,
} from '../../data/content/diversActivities';
import { alcoholLogicalDate } from '../rules/alcohol';
import { addDays } from '../rules/dates';
import { createId } from '../../utils/id';

/**
 * Journal Divers V1-04A — petites activités facultatives.
 * Aucune écriture XP / or / quêtes. Preuves via listDiversEvidence pour usage futur.
 */

export interface DiversOpts {
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

async function resolveCtx(db: SqlRunner, opts: DiversOpts): Promise<Ctx> {
  const profile =
    opts.timeZone !== undefined && opts.dayStartHour !== undefined ? null : await profileRepo.getProfile(db);
  const now = opts.now ?? new Date();
  const timeZone = (opts.timeZone !== undefined ? opts.timeZone : profile?.timezone) ?? undefined;
  const dayStartHour = opts.dayStartHour ?? profile?.dayStartHour ?? 4;
  const today = alcoholLogicalDate(now, timeZone, dayStartHour);
  return { now, timeZone, dayStartHour, today };
}

const MAX_SLOTS = 2;
const MAX_REPLACEMENTS_PER_DAY = 1;

/** Déterministe pour un jour donné (persistance stable après redémarrage). */
function hashSeed(localDate: string, index: number): number {
  let h = 2166136261;
  const s = `${localDate}:${index}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pickFromPool(pool: readonly string[], seed: number): string {
  if (pool.length === 0) return DIVERS_ACTIVITY_IDS[0]!;
  return pool[seed % pool.length]!;
}

function buildExclude(
  slots: DiversDaySlotsRow | null,
  extra: Set<string>,
  yesterdayIds: string[],
): Set<string> {
  const ex = new Set(extra);
  if (slots) {
    ex.add(slots.slot0ActivityId);
    ex.add(slots.slot1ActivityId);
  }
  for (const id of yesterdayIds) ex.add(id);
  return ex;
}

function freshPair(localDate: string, exclude: Set<string>): [string, string] {
  const pool = DIVERS_ACTIVITY_IDS.filter((id) => !exclude.has(id));
  const fallback = [...DIVERS_ACTIVITY_IDS];
  const a = pickFromPool(pool.length >= 1 ? pool : fallback, hashSeed(localDate, 0));
  const poolB = (pool.length >= 2 ? pool : fallback).filter((id) => id !== a);
  const b = pickFromPool(poolB.length >= 1 ? poolB : fallback, hashSeed(localDate, 1));
  if (a === b && fallback.length > 1) {
    const alt = fallback.find((id) => id !== a) ?? b;
    return [a, alt];
  }
  return [a, b];
}

async function yesterdayActivityIds(db: SqlRunner, today: string): Promise<string[]> {
  const prev = addDays(today, -1);
  const slots = await diversRepo.getDaySlots(db, prev);
  const ids: string[] = [];
  if (slots) {
    ids.push(slots.slot0ActivityId, slots.slot1ActivityId);
  }
  const confirmed = await diversRepo.listCompletionsForDay(db, prev);
  for (const c of confirmed) ids.push(c.activityId);
  return [...new Set(ids)];
}

async function ensureDaySlots(tx: SqlRunner, ctx: Ctx): Promise<DiversDaySlotsRow> {
  const existing = await diversRepo.getDaySlots(tx, ctx.today);
  if (existing) return existing;
  const yesterday = await yesterdayActivityIds(tx, ctx.today);
  const [s0, s1] = freshPair(ctx.today, buildExclude(null, new Set(), yesterday));
  const at = ctx.now.toISOString();
  const row = {
    localDate: ctx.today,
    slot0ActivityId: s0,
    slot1ActivityId: s1,
    replacementsUsed: 0,
    createdAt: at,
    updatedAt: at,
  };
  await diversRepo.upsertDaySlots(tx, row);
  await diversRepo.insertEvent(tx, {
    id: createId('dev'),
    kind: 'slots_generated',
    localDate: ctx.today,
    occurredAt: at,
    payloadJson: JSON.stringify({ slot0: s0, slot1: s1 }),
  });
  return (await diversRepo.getDaySlots(tx, ctx.today))!;
}

export interface DiversSuggestionSlot {
  slotIndex: 0 | 1;
  activityId: string;
  activity: DiversActivityDef;
}

export interface DiversDashboard {
  nowIso: string;
  timeZone: string | undefined;
  dayStartHour: number;
  today: string;
  suggestions: DiversSuggestionSlot[];
  replacementsRemaining: number;
  todayCompletions: DiversCompletionRow[];
  recentHistory: DiversCompletionRow[];
}

export async function getDiversDashboard(db: Db, opts: DiversOpts = {}): Promise<DiversDashboard> {
  let dash: DiversDashboard | null = null;
  await db.withExclusiveTransactionAsync(async (tx) => {
    const ctx = await resolveCtx(tx, opts);
    const slots = await ensureDaySlots(tx, ctx);
    const suggestions: DiversSuggestionSlot[] = [];
    for (const [idx, activityId] of [
      [0, slots.slot0ActivityId],
      [1, slots.slot1ActivityId],
    ] as const) {
      const activity = DIVERS_ACTIVITY_BY_ID[activityId];
      if (activity) suggestions.push({ slotIndex: idx, activityId, activity });
    }
    const todayCompletions = await diversRepo.listCompletionsForDay(tx, ctx.today, true);
    const recentHistory = await diversRepo.listRecentCompletions(tx, 12, true);
    dash = {
      nowIso: ctx.now.toISOString(),
      timeZone: ctx.timeZone,
      dayStartHour: ctx.dayStartHour,
      today: ctx.today,
      suggestions,
      replacementsRemaining: Math.max(0, MAX_REPLACEMENTS_PER_DAY - slots.replacementsUsed),
      todayCompletions,
      recentHistory,
    };
  });
  return dash!;
}

function pickReplacement(exclude: Set<string>, localDate: string, slotIndex: number): string {
  const pool = DIVERS_ACTIVITY_IDS.filter((id) => !exclude.has(id));
  if (pool.length === 0) {
    return pickFromPool(DIVERS_ACTIVITY_IDS, hashSeed(localDate, 10 + slotIndex));
  }
  return pickFromPool(pool, hashSeed(localDate, 20 + slotIndex));
}

export type PassSuggestionResult = { ok: true; dashboard: DiversDashboard } | { ok: false; code: 'invalid_slot' };

/** Passer une suggestion : rotation vers une autre activité du catalogue. */
export async function passDiversSuggestion(
  db: Db,
  slotIndex: 0 | 1,
  opts: DiversOpts = {},
): Promise<PassSuggestionResult> {
  let result: PassSuggestionResult = { ok: false, code: 'invalid_slot' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const ctx = await resolveCtx(tx, opts);
    const slots = await ensureDaySlots(tx, ctx);
    const at = ctx.now.toISOString();
    const exclude = buildExclude(slots, new Set(), []);
    const current = slotIndex === 0 ? slots.slot0ActivityId : slots.slot1ActivityId;
    exclude.add(current);
    const next = pickReplacement(exclude, ctx.today, slotIndex);
    const nextSlots = {
      ...slots,
      localDate: slots.localDate,
      slot0ActivityId: slotIndex === 0 ? next : slots.slot0ActivityId,
      slot1ActivityId: slotIndex === 1 ? next : slots.slot1ActivityId,
      updatedAt: at,
    };
    await diversRepo.upsertDaySlots(tx, nextSlots);
    await diversRepo.insertEvent(tx, {
      id: createId('dev'),
      kind: 'suggestion_passed',
      activityId: current,
      slotIndex,
      localDate: ctx.today,
      occurredAt: at,
      payloadJson: JSON.stringify({ replacedBy: next }),
    });
    result = { ok: true, dashboard: await buildDashboardInTx(tx, ctx) };
  });
  return result;
}

async function buildDashboardInTx(tx: SqlRunner, ctx: Ctx): Promise<DiversDashboard> {
  const slots = (await diversRepo.getDaySlots(tx, ctx.today))!;
  const suggestions: DiversSuggestionSlot[] = [];
  for (const [idx, activityId] of [
    [0, slots.slot0ActivityId],
    [1, slots.slot1ActivityId],
  ] as const) {
    const activity = DIVERS_ACTIVITY_BY_ID[activityId];
    if (activity) suggestions.push({ slotIndex: idx, activityId, activity });
  }
  return {
    nowIso: ctx.now.toISOString(),
    timeZone: ctx.timeZone,
    dayStartHour: ctx.dayStartHour,
    today: ctx.today,
    suggestions,
    replacementsRemaining: Math.max(0, MAX_REPLACEMENTS_PER_DAY - slots.replacementsUsed),
    todayCompletions: await diversRepo.listCompletionsForDay(tx, ctx.today, true),
    recentHistory: await diversRepo.listRecentCompletions(tx, 12, true),
  };
}

export type ReplaceSuggestionResult =
  | { ok: true; dashboard: DiversDashboard }
  | { ok: false; code: 'limit_reached' | 'invalid_slot' };

/** Remplacement explicite : max 1/jour ; l’activité remplacée ne revient pas tout de suite. */
export async function replaceDiversSuggestion(
  db: Db,
  slotIndex: 0 | 1,
  opts: DiversOpts = {},
): Promise<ReplaceSuggestionResult> {
  let result: ReplaceSuggestionResult = { ok: false, code: 'invalid_slot' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const ctx = await resolveCtx(tx, opts);
    const slots = await ensureDaySlots(tx, ctx);
    if (slots.replacementsUsed >= MAX_REPLACEMENTS_PER_DAY) {
      result = { ok: false, code: 'limit_reached' };
      return;
    }
    const at = ctx.now.toISOString();
    const current = slotIndex === 0 ? slots.slot0ActivityId : slots.slot1ActivityId;
    const exclude = buildExclude(slots, new Set([current]), []);
    const next = pickReplacement(exclude, ctx.today, slotIndex + 5);
    await diversRepo.upsertDaySlots(tx, {
      localDate: slots.localDate,
      slot0ActivityId: slotIndex === 0 ? next : slots.slot0ActivityId,
      slot1ActivityId: slotIndex === 1 ? next : slots.slot1ActivityId,
      replacementsUsed: slots.replacementsUsed + 1,
      createdAt: slots.createdAt,
      updatedAt: at,
    });
    await diversRepo.insertEvent(tx, {
      id: createId('dev'),
      kind: 'suggestion_replaced',
      activityId: current,
      slotIndex,
      localDate: ctx.today,
      occurredAt: at,
      payloadJson: JSON.stringify({ replacedBy: next }),
    });
    result = { ok: true, dashboard: await buildDashboardInTx(tx, ctx) };
  });
  return result;
}

export type ConfirmActivityResult =
  | { ok: true; completion: DiversCompletionRow; duplicate: boolean; message: string }
  | { ok: false; code: 'invalid_activity' | 'not_suggested' };

export async function confirmDiversActivity(
  db: Db,
  activityId: string,
  clientRequestId?: string | null,
  opts: DiversOpts = {},
): Promise<ConfirmActivityResult> {
  if (!isDiversActivityId(activityId)) return { ok: false, code: 'invalid_activity' };
  let result: ConfirmActivityResult = { ok: false, code: 'not_suggested' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const ctx = await resolveCtx(tx, opts);
    const slots = await ensureDaySlots(tx, ctx);
    const inSlots = activityId === slots.slot0ActivityId || activityId === slots.slot1ActivityId;
    if (!inSlots) {
      result = { ok: false, code: 'not_suggested' };
      return;
    }
    if (clientRequestId) {
      const existing = await diversRepo.getCompletionByRequestId(tx, clientRequestId);
      if (existing) {
        result = {
          ok: true,
          completion: existing,
          duplicate: true,
          message: 'Cette confirmation était déjà enregistrée.',
        };
        return;
      }
    }
    const at = ctx.now.toISOString();
    const id = createId('dvc');
    await diversRepo.insertCompletion(tx, {
      id,
      clientRequestId: clientRequestId ?? null,
      activityId,
      confirmedAt: at,
      localDate: ctx.today,
      createdAt: at,
      updatedAt: at,
    });
    await diversRepo.insertEvent(tx, {
      id: createId('dev'),
      kind: 'activity_confirmed',
      activityId,
      localDate: ctx.today,
      completionId: id,
      occurredAt: at,
    });
    const completion = (await diversRepo.getCompletion(tx, id))!;
    const title = DIVERS_ACTIVITY_BY_ID[activityId]?.title ?? 'Activité';
    result = {
      ok: true,
      completion,
      duplicate: false,
      message: `Noté : ${title}.`,
    };
  });
  return result;
}

export type CancelCompletionResult = { ok: true } | { ok: false; code: 'not_found' | 'already_cancelled' };

export async function cancelDiversCompletion(db: Db, id: string, opts: DiversOpts = {}): Promise<CancelCompletionResult> {
  let result: CancelCompletionResult = { ok: false, code: 'not_found' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const ctx = await resolveCtx(tx, opts);
    const cur = await diversRepo.getCompletion(tx, id);
    if (!cur) return;
    if (cur.status === 'cancelled') {
      result = { ok: false, code: 'already_cancelled' };
      return;
    }
    const at = ctx.now.toISOString();
    await diversRepo.cancelCompletion(tx, id, at, at);
    await diversRepo.insertEvent(tx, {
      id: createId('dev'),
      kind: 'completion_cancelled',
      activityId: cur.activityId,
      localDate: cur.localDate,
      completionId: id,
      occurredAt: at,
    });
    result = { ok: true };
  });
  return result;
}

export interface DiversEvidence {
  evidenceKey: string;
  completionId: string;
  activityId: string;
  confirmedAt: string;
  localDate: string;
  status: 'active' | 'cancelled';
}

export async function listDiversEvidence(
  db: Db,
  range?: { sinceIso?: string; untilIso?: string },
): Promise<DiversEvidence[]> {
  let sql = `SELECT id, activity_id, confirmed_at, local_date, status FROM divers_completions WHERE status = 'active'`;
  const args: string[] = [];
  if (range?.sinceIso) {
    sql += ` AND confirmed_at >= ?`;
    args.push(range.sinceIso);
  }
  if (range?.untilIso) {
    sql += ` AND confirmed_at <= ?`;
    args.push(range.untilIso);
  }
  sql += ` ORDER BY confirmed_at ASC`;
  const rows = await db.getAllAsync<Record<string, unknown>>(sql, ...args);
  return rows.map((r) => ({
    evidenceKey: `divers_activity:${r.id}`,
    completionId: String(r.id),
    activityId: String(r.activity_id),
    confirmedAt: String(r.confirmed_at),
    localDate: String(r.local_date),
    status: String(r.status) as 'active',
  }));
}

/** Exposé pour tests : nombre d’activités catalogue. */
export function diversCatalogSize(): number {
  return DIVERS_ACTIVITIES.length;
}