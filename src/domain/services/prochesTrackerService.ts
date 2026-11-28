import type { Db } from '../../data/db/client';
import type { SqlRunner } from '../../data/db/sqlRunner';
import * as prochesRepo from '../../data/db/repositories/prochesRepo';
import type { ProchesCall, ProchesContact, ProchesWeeklyGoalRow } from '../../data/db/repositories/prochesRepo';
import * as profileRepo from '../../data/db/repositories/profileRepo';
import { alcoholLogicalDate } from '../rules/alcohol';
import {
  DEFAULT_WEEKLY_CALL_TARGET,
  WEEKLY_CALL_LIMITS,
  parseContactName,
  parseContactNote,
  weekBounds,
  type ProchesRelation,
} from '../rules/proches';
import { addDays } from '../rules/dates';
import { createId } from '../../utils/id';
import { isEvidencePaid } from './questEvidenceClaims';

/**
 * Journal Proches V1-03B. Aucune écriture XP / or / quêtes / tracking call_family : le suivi historique reste séparé.
 */

export interface ProchesOpts {
  now?: Date;
  timeZone?: string | null;
  dayStartHour?: number;
}

interface Ctx {
  now: Date;
  timeZone: string | undefined;
  dayStartHour: number;
}

async function resolveCtx(db: SqlRunner, opts: ProchesOpts): Promise<Ctx> {
  const profile =
    opts.timeZone !== undefined && opts.dayStartHour !== undefined ? null : await profileRepo.getProfile(db);
  return {
    now: opts.now ?? new Date(),
    timeZone: (opts.timeZone !== undefined ? opts.timeZone : profile?.timezone) ?? undefined,
    dayStartHour: opts.dayStartHour ?? profile?.dayStartHour ?? 4,
  };
}

const MIN_DATE_MS = Date.parse('2000-01-01T00:00:00.000Z');
const FUTURE_TOLERANCE_MS = 60_000;

function validTime(d: Date, now: Date): 'ok' | 'invalid_time' | 'future_time' {
  const ms = d?.getTime?.();
  if (!Number.isFinite(ms) || ms < MIN_DATE_MS) return 'invalid_time';
  if (ms > now.getTime() + FUTURE_TOLERANCE_MS) return 'future_time';
  return 'ok';
}

function callSnapshot(c: {
  calledAt: string;
  localDate: string;
  note: string | null;
  contactId: string;
}) {
  return { calledAt: c.calledAt, localDate: c.localDate, note: c.note, contactId: c.contactId };
}

// ───────────────────────── Contacts ─────────────────────────

export type AddContactResult =
  | { ok: true; contact: ProchesContact }
  | { ok: false; code: 'invalid_name' };

export interface QuickContactCallInput {
  name: string;
  relation?: ProchesRelation | null;
  calledAt: Date;
  note?: string | null;
  clientRequestId?: string | null;
}

export type AddContactAndCallResult = AddCallResult | { ok: false; code: 'invalid_name' };

/** Création rapide + appel dans une seule transaction (pas de contact orphelin si l'appel échoue). */
export async function addContactAndCall(
  db: Db,
  input: QuickContactCallInput,
  opts: ProchesOpts = {},
): Promise<AddContactAndCallResult> {
  const parsed = parseContactName(input.name);
  if (!parsed.ok) return { ok: false, code: 'invalid_name' };
  let result: AddContactAndCallResult = { ok: false, code: 'not_found' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const ctx = await resolveCtx(tx, opts);
    const t = validTime(input.calledAt, ctx.now);
    if (t !== 'ok') {
      result = { ok: false, code: t };
      return;
    }
    if (input.clientRequestId) {
      const existing = await prochesRepo.getCallByRequestId(tx, input.clientRequestId);
      if (existing) {
        result = { ok: true, call: existing, duplicate: true };
        return;
      }
    }
    const contactId = createId('prc');
    const at = ctx.now.toISOString();
    await prochesRepo.insertContact(tx, {
      id: contactId,
      name: parsed.value,
      relation: input.relation ?? null,
      note: null,
      createdAt: at,
    });
    await prochesRepo.insertEvent(tx, {
      id: createId('pev'),
      kind: 'contact_added',
      contactId,
      occurredAt: at,
    });
    const callId = createId('pcl');
    const localDate = alcoholLogicalDate(input.calledAt, ctx.timeZone, ctx.dayStartHour);
    await prochesRepo.insertCall(tx, {
      id: callId,
      clientRequestId: input.clientRequestId ?? null,
      contactId,
      calledAt: input.calledAt.toISOString(),
      localDate,
      note: parseContactNote(input.note),
      createdAt: at,
    });
    await prochesRepo.insertEvent(tx, {
      id: createId('pev'),
      kind: 'call_logged',
      callId,
      contactId,
      localDate,
      occurredAt: at,
    });
    result = { ok: true, call: (await prochesRepo.getCall(tx, callId))!, duplicate: false };
  });
  return result;
}

export async function addContact(
  db: Db,
  input: { name: string; relation?: ProchesRelation | null; note?: string | null },
  opts: ProchesOpts = {},
): Promise<AddContactResult> {
  const parsed = parseContactName(input.name);
  if (!parsed.ok) return { ok: false, code: 'invalid_name' };
  const id = createId('prc');
  const at = (opts.now ?? new Date()).toISOString();
  await db.withExclusiveTransactionAsync(async (tx) => {
    await prochesRepo.insertContact(tx, {
      id,
      name: parsed.value,
      relation: input.relation ?? null,
      note: parseContactNote(input.note),
      createdAt: at,
    });
    await prochesRepo.insertEvent(tx, {
      id: createId('pev'),
      kind: 'contact_added',
      contactId: id,
      occurredAt: at,
    });
  });
  return { ok: true, contact: (await prochesRepo.getContact(db, id))! };
}

export type UpdateContactResult = { ok: true; contact: ProchesContact } | { ok: false; code: 'not_found' | 'invalid_name' };

export async function updateContactName(db: Db, id: string, name: string, opts: ProchesOpts = {}): Promise<UpdateContactResult> {
  const parsed = parseContactName(name);
  if (!parsed.ok) return { ok: false, code: 'invalid_name' };
  const cur = await prochesRepo.getContact(db, id);
  if (!cur) return { ok: false, code: 'not_found' };
  const at = (opts.now ?? new Date()).toISOString();
  if (cur.name === parsed.value) return { ok: true, contact: cur };
  await prochesRepo.updateContactName(db, id, parsed.value, at);
  return { ok: true, contact: (await prochesRepo.getContact(db, id))! };
}

export type ArchiveContactResult = { ok: true } | { ok: false; code: 'not_found' | 'already_archived' };

export async function archiveContact(db: Db, id: string, opts: ProchesOpts = {}): Promise<ArchiveContactResult> {
  const cur = await prochesRepo.getContact(db, id);
  if (!cur) return { ok: false, code: 'not_found' };
  if (cur.status === 'archived') return { ok: false, code: 'already_archived' };
  const at = (opts.now ?? new Date()).toISOString();
  await prochesRepo.archiveContact(db, id, at);
  return { ok: true };
}

export async function listContacts(db: Db, includeArchived = false): Promise<ProchesContact[]> {
  return prochesRepo.listContacts(db, includeArchived);
}

// ───────────────────────── Appels ─────────────────────────

export interface AddCallInput {
  contactId: string;
  calledAt: Date;
  note?: string | null;
  clientRequestId?: string | null;
}

export type AddCallResult =
  | { ok: true; call: ProchesCall; duplicate: boolean }
  | { ok: false; code: 'not_found' | 'invalid_time' | 'future_time' };

export async function addCall(db: Db, input: AddCallInput, opts: ProchesOpts = {}): Promise<AddCallResult> {
  let result: AddCallResult = { ok: false, code: 'not_found' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const ctx = await resolveCtx(tx, opts);
    const contact = await prochesRepo.getContact(tx, input.contactId);
    if (!contact) return;
    const t = validTime(input.calledAt, ctx.now);
    if (t !== 'ok') {
      result = { ok: false, code: t };
      return;
    }
    if (input.clientRequestId) {
      const existing = await prochesRepo.getCallByRequestId(tx, input.clientRequestId);
      if (existing) {
        result = { ok: true, call: existing, duplicate: true };
        return;
      }
    }
    const at = ctx.now.toISOString();
    const id = createId('pcl');
    const localDate = alcoholLogicalDate(input.calledAt, ctx.timeZone, ctx.dayStartHour);
    await prochesRepo.insertCall(tx, {
      id,
      clientRequestId: input.clientRequestId ?? null,
      contactId: input.contactId,
      calledAt: input.calledAt.toISOString(),
      localDate,
      note: parseContactNote(input.note),
      createdAt: at,
    });
    await prochesRepo.insertEvent(tx, {
      id: createId('pev'),
      kind: 'call_logged',
      callId: id,
      contactId: input.contactId,
      localDate,
      occurredAt: at,
    });
    result = { ok: true, call: (await prochesRepo.getCall(tx, id))!, duplicate: false };
  });
  return result;
}

export type EditCallResult =
  | { ok: true; call: ProchesCall; changed: boolean }
  | { ok: false; code: 'not_found' | 'cancelled' | 'rewarded' | 'invalid_time' | 'future_time' };

export async function editCall(
  db: Db,
  id: string,
  next: { calledAt: Date; note?: string | null },
  opts: ProchesOpts = {},
): Promise<EditCallResult> {
  let result: EditCallResult = { ok: false, code: 'not_found' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const ctx = await resolveCtx(tx, opts);
    const cur = await prochesRepo.getCall(tx, id);
    if (!cur) return;
    if (cur.status !== 'active') {
      result = { ok: false, code: 'cancelled' };
      return;
    }
    const t = validTime(next.calledAt, ctx.now);
    if (t !== 'ok') {
      result = { ok: false, code: t };
      return;
    }
    const at = ctx.now.toISOString();
    const row = {
      calledAt: next.calledAt.toISOString(),
      localDate: alcoholLogicalDate(next.calledAt, ctx.timeZone, ctx.dayStartHour),
      note: parseContactNote(next.note ?? cur.note),
      contactId: cur.contactId,
    };
    const before = callSnapshot(cur);
    const after = callSnapshot(row);
    if (JSON.stringify(before) === JSON.stringify(after)) {
      result = { ok: true, call: cur, changed: false };
      return;
    }
    if (cur.calledAt !== row.calledAt && (await isEvidencePaid(tx, `proches_call:${id}`))) {
      result = { ok: false, code: 'rewarded' };
      return;
    }
    await prochesRepo.insertCorrection(tx, {
      id: createId('pcr'),
      callId: id,
      kind: 'edit',
      before,
      after,
      createdAt: at,
    });
    await prochesRepo.updateCall(tx, id, row, at);
    await prochesRepo.insertEvent(tx, {
      id: createId('pev'),
      kind: 'call_edited',
      callId: id,
      contactId: cur.contactId,
      localDate: row.localDate,
      occurredAt: at,
    });
    result = { ok: true, call: (await prochesRepo.getCall(tx, id))!, changed: true };
  });
  return result;
}

export type CancelCallResult = { ok: true } | { ok: false; code: 'not_found' | 'already_cancelled' | 'rewarded' };

export async function cancelCall(db: Db, id: string, opts: ProchesOpts = {}): Promise<CancelCallResult> {
  let result: CancelCallResult = { ok: false, code: 'not_found' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const ctx = await resolveCtx(tx, opts);
    const cur = await prochesRepo.getCall(tx, id);
    if (!cur) return;
    if (cur.status === 'cancelled') {
      result = { ok: false, code: 'already_cancelled' };
      return;
    }
    if (await isEvidencePaid(tx, `proches_call:${id}`)) {
      result = { ok: false, code: 'rewarded' };
      return;
    }
    const at = ctx.now.toISOString();
    await prochesRepo.insertCorrection(tx, {
      id: createId('pcr'),
      callId: id,
      kind: 'cancel',
      before: callSnapshot(cur),
      after: null,
      createdAt: at,
    });
    await prochesRepo.cancelCall(tx, id, at);
    await prochesRepo.insertEvent(tx, {
      id: createId('pev'),
      kind: 'call_cancelled',
      callId: id,
      contactId: cur.contactId,
      localDate: cur.localDate,
      occurredAt: at,
    });
    result = { ok: true };
  });
  return result;
}

export async function listDayCalls(db: Db, localDate: string, includeCancelled = false): Promise<ProchesCall[]> {
  return prochesRepo.listCallsForDay(db, localDate, includeCancelled);
}

export async function listCallCorrections(db: Db, callId: string) {
  return prochesRepo.listCorrectionsForCall(db, callId);
}

// ───────────────────────── Objectif hebdomadaire ─────────────────────────

export type SetWeeklyGoalResult =
  | { ok: true; changed: boolean; effectiveFrom: string; targetCount: number }
  | { ok: false; code: 'invalid_goal' };

async function ensureDefaultWeeklyGoal(tx: SqlRunner, ctx: Ctx): Promise<ProchesWeeklyGoalRow | null> {
  const today = alcoholLogicalDate(ctx.now, ctx.timeZone, ctx.dayStartHour);
  const { start } = weekBounds(today);
  const existing = await prochesRepo.getGoalForWeek(tx, start);
  if (existing) return existing;
  const any = await prochesRepo.countWeeklyGoals(tx);
  if (any > 0) return null;
  const at = ctx.now.toISOString();
  const row = {
    id: createId('pwg'),
    effectiveFrom: start,
    targetCount: DEFAULT_WEEKLY_CALL_TARGET,
    source: 'default' as const,
    createdAt: at,
  };
  await prochesRepo.insertWeeklyGoal(tx, row);
  await prochesRepo.insertEvent(tx, { id: createId('pev'), kind: 'goal_default', occurredAt: at, payload: { targetCount: DEFAULT_WEEKLY_CALL_TARGET, effectiveFrom: start } });
  return { id: row.id, effectiveFrom: start, targetCount: DEFAULT_WEEKLY_CALL_TARGET, source: 'default', createdAt: at };
}

export async function setWeeklyCallGoal(db: Db, targetCount: number, opts: ProchesOpts = {}): Promise<SetWeeklyGoalResult> {
  if (!Number.isInteger(targetCount) || targetCount < WEEKLY_CALL_LIMITS.min || targetCount > WEEKLY_CALL_LIMITS.max) {
    return { ok: false, code: 'invalid_goal' };
  }
  let result: SetWeeklyGoalResult = { ok: false, code: 'invalid_goal' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const ctx = await resolveCtx(tx, opts);
    const today = alcoholLogicalDate(ctx.now, ctx.timeZone, ctx.dayStartHour);
    const { start } = weekBounds(today);
    const current = (await ensureDefaultWeeklyGoal(tx, ctx)) ?? (await prochesRepo.getGoalForWeek(tx, start));
    if (current && current.targetCount === targetCount) {
      result = { ok: true, changed: false, effectiveFrom: start, targetCount };
      return;
    }
    const at = ctx.now.toISOString();
    await prochesRepo.insertWeeklyGoal(tx, {
      id: createId('pwg'),
      effectiveFrom: start,
      targetCount,
      source: 'manual',
      createdAt: at,
    });
    await prochesRepo.insertEvent(tx, {
      id: createId('pev'),
      kind: 'goal_set',
      occurredAt: at,
      payload: { targetCount, previous: current?.targetCount ?? null, effectiveFrom: start },
    });
    result = { ok: true, changed: true, effectiveFrom: start, targetCount };
  });
  return result;
}

export async function getWeeklyGoalHistory(db: Db): Promise<Awaited<ReturnType<typeof prochesRepo.listWeeklyGoals>>> {
  return prochesRepo.listWeeklyGoals(db);
}

// ───────────────────────── Tableau de bord ─────────────────────────

export interface DayCallSummary {
  localDate: string;
  count: number;
}

export interface ProchesDashboard {
  nowIso: string;
  timeZone: string | undefined;
  dayStartHour: number;
  today: string;
  weekStart: string;
  weekEnd: string;
  weekCallCount: number;
  weekDistinctContacts: number;
  weekTarget: number | null;
  weekTargetSource: 'manual' | 'default' | null;
  previousWeekCallCount: number | null;
  recentContacts: Array<{ contactId: string; name: string; lastCalledAt: string }>;
  monthDays: DayCallSummary[];
  monthStart: string;
  monthEnd: string;
  recentCalls: ProchesCall[];
}

export async function getProchesDashboard(db: Db, opts: ProchesOpts = {}): Promise<ProchesDashboard> {
  const ctx = await resolveCtx(db, opts);
  await db.withExclusiveTransactionAsync(async (tx) => {
    await ensureDefaultWeeklyGoal(tx, ctx);
  });
  const today = alcoholLogicalDate(ctx.now, ctx.timeZone, ctx.dayStartHour);
  const { start: weekStart, end: weekEnd } = weekBounds(today);
  const prevStart = addDays(weekStart, -7);
  const prevEnd = addDays(weekEnd, -7);

  const goal = await prochesRepo.getGoalForWeek(db, weekStart);
  const weekCallCount = await prochesRepo.countActiveCallsBetween(db, weekStart, weekEnd);
  const weekDistinctContacts = await prochesRepo.distinctContactsCalledBetween(db, weekStart, weekEnd);
  const previousWeekCallCount = await prochesRepo.countActiveCallsBetween(db, prevStart, prevEnd);

  const monthStart = today.slice(0, 8) + '01';
  const monthEndDate = new Date(Date.parse(`${monthStart}T12:00:00.000Z`));
  monthEndDate.setUTCMonth(monthEndDate.getUTCMonth() + 1);
  monthEndDate.setUTCDate(0);
  const monthEnd = monthEndDate.toISOString().slice(0, 10);

  const monthDays = await prochesRepo.countByDayBetween(db, monthStart, monthEnd);

  return {
    nowIso: ctx.now.toISOString(),
    timeZone: ctx.timeZone,
    dayStartHour: ctx.dayStartHour,
    today,
    weekStart,
    weekEnd,
    weekCallCount,
    weekDistinctContacts,
    weekTarget: goal?.targetCount ?? null,
    weekTargetSource: goal?.source ?? null,
    previousWeekCallCount: previousWeekCallCount > 0 || weekCallCount > 0 ? previousWeekCallCount : null,
    recentContacts: await prochesRepo.recentContactCalls(db, 5),
    monthDays,
    monthStart,
    monthEnd,
    recentCalls: await prochesRepo.listRecentCalls(db, 15),
  };
}

// ───────────────────────── Preuves (futures quêtes) ─────────────────────────

export interface ProchesCallEvidence {
  evidenceKey: string;
  callId: string;
  contactId: string;
  calledAt: string;
  localDate: string;
  note: string | null;
}

export async function listProchesEvidence(
  db: Db,
  range?: { sinceIso?: string; untilIso?: string },
): Promise<ProchesCallEvidence[]> {
  let sql = `SELECT id, contact_id, called_at, local_date, note FROM proches_calls WHERE status = 'active'`;
  const args: string[] = [];
  if (range?.sinceIso) {
    sql += ` AND called_at >= ?`;
    args.push(range.sinceIso);
  }
  if (range?.untilIso) {
    sql += ` AND called_at <= ?`;
    args.push(range.untilIso);
  }
  sql += ` ORDER BY called_at ASC`;
  const rows = await db.getAllAsync<Record<string, unknown>>(sql, ...args);
  return rows.map((r) => ({
    evidenceKey: `proches_call:${r.id}`,
    callId: String(r.id),
    contactId: String(r.contact_id),
    calledAt: String(r.called_at),
    localDate: String(r.local_date),
    note: r.note != null ? String(r.note) : null,
  }));
}