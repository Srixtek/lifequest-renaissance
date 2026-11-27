import type { Db } from '../../data/db/client';
import type { SqlRunner } from '../../data/db/sqlRunner';
import * as alcoholRepo from '../../data/db/repositories/alcoholRepo';
import type { AlcoholConsumption, AlcoholCorrection } from '../../data/db/repositories/alcoholRepo';
import * as goalRepo from '../../data/db/repositories/goalRepo';
import * as profileRepo from '../../data/db/repositories/profileRepo';
import { createId } from '../../utils/id';
import {
  LIMITS,
  alcoholLogicalDate,
  computeAlcoholMg,
  computeGoalSuggestion,
  computeSince,
  isValidDrinkParams,
  weekBounds,
  type AlcoholDrinkType,
  type GoalSuggestion,
  type SinceInfo,
  type ValidatedDrink,
  type WeekFacts,
} from '../rules/alcohol';
import { addDays } from '../rules/dates';

/**
 * Suivi alcool V1-02B. Ce service n'écrit JAMAIS dans les registres XP / or / éclats, l'inventaire ou la progression RPG :
 * aucune récompense, aucune pénalité. Il ne touche pas non plus aux objectifs historiques `alcohol_limit`
 * (déclarations « verres » antérieures) : les deux suivis sont indépendants et ne s'additionnent jamais.
 */

export interface AlcoholOpts {
  now?: Date;
  /** Fuseau et début de journée : par défaut ceux du profil (comme le reste de l'app). */
  timeZone?: string | null;
  dayStartHour?: number;
}

interface Ctx {
  now: Date;
  timeZone: string | undefined;
  dayStartHour: number;
}

async function resolveCtx(db: SqlRunner, opts: AlcoholOpts): Promise<Ctx> {
  const profile =
    opts.timeZone !== undefined && opts.dayStartHour !== undefined
      ? null
      : await profileRepo.getProfile(db);
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

function daysInclusive(startDate: string, endDate: string): number {
  const [y1, m1, d1] = startDate.split('-').map(Number);
  const [y2, m2, d2] = endDate.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000) + 1;
}

function snapshot(c: {
  drinkType: AlcoholDrinkType;
  name: string | null;
  volumeMlX10: number;
  abvX10: number;
  quantityX100: number;
  alcoholMg: number;
  consumedAt: string;
  localDate: string;
  note: string | null;
}) {
  return {
    drinkType: c.drinkType,
    name: c.name,
    volumeMlX10: c.volumeMlX10,
    abvX10: c.abvX10,
    quantityX100: c.quantityX100,
    alcoholMg: c.alcoholMg,
    consumedAt: c.consumedAt,
    localDate: c.localDate,
    note: c.note,
  };
}

// ───────────────────────── Enregistrer / corriger / annuler ─────────────────────────

export type AddConsumptionResult =
  | { ok: true; consumption: AlcoholConsumption; duplicate: boolean; revokedZeroDay: boolean }
  | { ok: false; code: 'invalid_drink' | 'invalid_time' | 'future_time' };

/**
 * `clientRequestId` rend l'ajout idempotent : le même identifiant (formulaire déjà soumis, double appui) renvoie la
 * boisson déjà enregistrée sans en créer une seconde.
 */
export async function addConsumption(
  db: Db,
  input: { drink: ValidatedDrink; consumedAt: Date; clientRequestId?: string | null },
  opts: AlcoholOpts = {},
): Promise<AddConsumptionResult> {
  let result: AddConsumptionResult = { ok: false, code: 'invalid_drink' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const ctx = await resolveCtx(tx, opts);
    if (!isValidDrinkParams(input.drink)) return;
    const t = validTime(input.consumedAt, ctx.now);
    if (t !== 'ok') {
      result = { ok: false, code: t };
      return;
    }
    if (input.clientRequestId) {
      const existing = await alcoholRepo.getConsumptionByRequestId(tx, input.clientRequestId);
      if (existing) {
        result = { ok: true, consumption: existing, duplicate: true, revokedZeroDay: false };
        return;
      }
    }
    const at = ctx.now.toISOString();
    const id = createId('alc');
    const localDate = alcoholLogicalDate(input.consumedAt, ctx.timeZone, ctx.dayStartHour);
    const alcoholMg = computeAlcoholMg(input.drink);
    await alcoholRepo.insertConsumption(tx, {
      id,
      clientRequestId: input.clientRequestId ?? null,
      drinkType: input.drink.drinkType,
      name: input.drink.name,
      volumeMlX10: input.drink.volumeMlX10,
      abvX10: input.drink.abvX10,
      quantityX100: input.drink.quantityX100,
      alcoholMg,
      consumedAt: input.consumedAt.toISOString(),
      localDate,
      note: input.drink.note,
      createdAt: at,
    });
    const revoked = await revokeZeroDayOn(tx, localDate, at, 'consumption_added');
    await alcoholRepo.insertEvent(tx, {
      id: createId('aev'),
      kind: 'consumption_added',
      consumptionId: id,
      localDate,
      occurredAt: at,
      payload: { alcoholMg, drinkType: input.drink.drinkType, consumedAt: input.consumedAt.toISOString() },
    });
    result = {
      ok: true,
      consumption: (await alcoholRepo.getConsumption(tx, id))!,
      duplicate: false,
      revokedZeroDay: revoked,
    };
  });
  return result;
}

async function revokeZeroDayOn(
  tx: SqlRunner,
  localDate: string,
  at: string,
  reason: string,
): Promise<boolean> {
  const revoked = await alcoholRepo.revokeZeroDay(tx, localDate, at, reason);
  if (revoked) {
    await alcoholRepo.insertEvent(tx, {
      id: createId('aev'),
      kind: 'zero_revoked',
      localDate,
      occurredAt: at,
      payload: { reason },
    });
  }
  return revoked;
}

export type EditConsumptionResult =
  | { ok: true; consumption: AlcoholConsumption; changed: boolean }
  | { ok: false; code: 'not_found' | 'cancelled' | 'invalid_drink' | 'invalid_time' | 'future_time' };

/** Correction : recalcule l'alcool pur et la date logique ; l'état précédent est conservé dans la trace d'audit. */
export async function editConsumption(
  db: Db,
  id: string,
  next: { drink: ValidatedDrink; consumedAt: Date },
  opts: AlcoholOpts = {},
): Promise<EditConsumptionResult> {
  let result: EditConsumptionResult = { ok: false, code: 'not_found' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const ctx = await resolveCtx(tx, opts);
    const cur = await alcoholRepo.getConsumption(tx, id);
    if (!cur) return;
    if (cur.status !== 'active') {
      result = { ok: false, code: 'cancelled' };
      return;
    }
    if (!isValidDrinkParams(next.drink)) {
      result = { ok: false, code: 'invalid_drink' };
      return;
    }
    const t = validTime(next.consumedAt, ctx.now);
    if (t !== 'ok') {
      result = { ok: false, code: t };
      return;
    }
    const at = ctx.now.toISOString();
    const row = {
      drinkType: next.drink.drinkType,
      name: next.drink.name,
      volumeMlX10: next.drink.volumeMlX10,
      abvX10: next.drink.abvX10,
      quantityX100: next.drink.quantityX100,
      alcoholMg: computeAlcoholMg(next.drink),
      consumedAt: next.consumedAt.toISOString(),
      localDate: alcoholLogicalDate(next.consumedAt, ctx.timeZone, ctx.dayStartHour),
      note: next.drink.note,
    };
    const before = snapshot(cur);
    if (JSON.stringify(before) === JSON.stringify(row)) {
      result = { ok: true, consumption: cur, changed: false };
      return;
    }
    await alcoholRepo.insertCorrection(tx, {
      id: createId('acr'),
      consumptionId: id,
      kind: 'edit',
      before,
      after: row,
      createdAt: at,
    });
    await alcoholRepo.updateConsumption(tx, id, row, at);
    await revokeZeroDayOn(tx, row.localDate, at, 'consumption_edited');
    await alcoholRepo.insertEvent(tx, {
      id: createId('aev'),
      kind: 'consumption_edited',
      consumptionId: id,
      localDate: row.localDate,
      occurredAt: at,
      payload: { fromMg: cur.alcoholMg, toMg: row.alcoholMg, fromDate: cur.localDate, toDate: row.localDate },
    });
    result = { ok: true, consumption: (await alcoholRepo.getConsumption(tx, id))!, changed: true };
  });
  return result;
}

export type CancelConsumptionResult = { ok: true } | { ok: false; code: 'not_found' | 'already_cancelled' };

/** Annulation logique : la ligne et son historique restent en base (exclue des totaux et du chrono). */
export async function cancelConsumption(db: Db, id: string, opts: AlcoholOpts = {}): Promise<CancelConsumptionResult> {
  let result: CancelConsumptionResult = { ok: false, code: 'not_found' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const ctx = await resolveCtx(tx, opts);
    const cur = await alcoholRepo.getConsumption(tx, id);
    if (!cur) return;
    if (cur.status === 'cancelled') {
      result = { ok: false, code: 'already_cancelled' };
      return;
    }
    const at = ctx.now.toISOString();
    await alcoholRepo.insertCorrection(tx, {
      id: createId('acr'),
      consumptionId: id,
      kind: 'cancel',
      before: snapshot(cur),
      after: null,
      createdAt: at,
    });
    await alcoholRepo.cancelConsumption(tx, id, at);
    await alcoholRepo.insertEvent(tx, {
      id: createId('aev'),
      kind: 'consumption_cancelled',
      consumptionId: id,
      localDate: cur.localDate,
      occurredAt: at,
      payload: { alcoholMg: cur.alcoholMg },
    });
    result = { ok: true };
  });
  return result;
}

export async function getConsumptionAudit(db: Db, id: string): Promise<AlcoholCorrection[]> {
  return alcoholRepo.listCorrections(db, id);
}

export async function listDayEntries(
  db: Db,
  localDate: string,
  includeCancelled = true,
): Promise<AlcoholConsumption[]> {
  return alcoholRepo.listConsumptionsForDate(db, localDate, includeCancelled);
}

// ───────────────────────── Zéro explicite, départ confirmé ─────────────────────────

export type ZeroDayResult =
  | { ok: true; alreadyDeclared: boolean }
  | { ok: false; code: 'invalid_date' | 'future_date' | 'has_consumption' };

/** « Aucune boisson ce jour-là » : déclaration explicite (≠ absence de saisie). */
export async function declareZeroDay(db: Db, localDate: string, opts: AlcoholOpts = {}): Promise<ZeroDayResult> {
  let result: ZeroDayResult = { ok: false, code: 'invalid_date' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) return result;
  await db.withExclusiveTransactionAsync(async (tx) => {
    const ctx = await resolveCtx(tx, opts);
    const today = alcoholLogicalDate(ctx.now, ctx.timeZone, ctx.dayStartHour);
    if (localDate > today) {
      result = { ok: false, code: 'future_date' };
      return;
    }
    if ((await alcoholRepo.countActiveOnDate(tx, localDate)) > 0) {
      result = { ok: false, code: 'has_consumption' };
      return;
    }
    if (await alcoholRepo.hasActiveZeroDay(tx, localDate)) {
      result = { ok: true, alreadyDeclared: true };
      return;
    }
    const at = ctx.now.toISOString();
    await alcoholRepo.insertZeroDay(tx, createId('azd'), localDate, at);
    await alcoholRepo.insertEvent(tx, { id: createId('aev'), kind: 'zero_declared', localDate, occurredAt: at });
    result = { ok: true, alreadyDeclared: false };
  });
  return result;
}

export async function revokeZeroDayDeclaration(db: Db, localDate: string, opts: AlcoholOpts = {}): Promise<boolean> {
  let revoked = false;
  await db.withExclusiveTransactionAsync(async (tx) => {
    const ctx = await resolveCtx(tx, opts);
    revoked = await revokeZeroDayOn(tx, localDate, ctx.now.toISOString(), 'user_revoked');
  });
  return revoked;
}

export type StartMarkerResult =
  | { ok: true }
  | { ok: false; code: 'invalid_time' | 'future_time' | 'before_last_drink' };

/**
 * Départ explicitement confirmé (date + heure) : sert de référence au chrono tant qu'aucune boisson plus récente
 * n'est enregistrée. Remplace (sans effacer) un départ précédent. Jamais déduit automatiquement.
 */
export async function confirmStartMarker(db: Db, startedAt: Date, opts: AlcoholOpts = {}): Promise<StartMarkerResult> {
  let result: StartMarkerResult = { ok: false, code: 'invalid_time' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const ctx = await resolveCtx(tx, opts);
    const t = validTime(startedAt, ctx.now);
    if (t !== 'ok') {
      result = { ok: false, code: t };
      return;
    }
    const last = await alcoholRepo.getLastActiveConsumedAt(tx);
    if (last && Date.parse(last) > startedAt.getTime()) {
      result = { ok: false, code: 'before_last_drink' };
      return;
    }
    const at = ctx.now.toISOString();
    await alcoholRepo.voidStartMarkers(tx, at);
    await alcoholRepo.insertStartMarker(tx, createId('asm'), startedAt.toISOString(), at);
    await alcoholRepo.insertEvent(tx, {
      id: createId('aev'),
      kind: 'start_confirmed',
      occurredAt: at,
      payload: { startedAt: startedAt.toISOString() },
    });
    result = { ok: true };
  });
  return result;
}

// ───────────────────────── Objectif hebdomadaire ─────────────────────────

export type SetGoalResult = { ok: true; changed: boolean; effectiveFrom: string } | { ok: false; code: 'invalid_goal' };

async function applyGoal(
  tx: Db,
  ctx: Ctx,
  targetMg: number,
  source: 'manual' | 'suggestion',
): Promise<SetGoalResult> {
  if (
    !Number.isInteger(targetMg) ||
    targetMg < LIMITS.weeklyGoalMg.min ||
    targetMg > LIMITS.weeklyGoalMg.max
  ) {
    return { ok: false, code: 'invalid_goal' };
  }
  const today = alcoholLogicalDate(ctx.now, ctx.timeZone, ctx.dayStartHour);
  const { start } = weekBounds(today);
  const current = await alcoholRepo.getGoalForWeek(tx, start);
  if (current && current.targetMg === targetMg) return { ok: true, changed: false, effectiveFrom: start };
  const at = ctx.now.toISOString();
  await alcoholRepo.insertGoal(tx, { id: createId('agl'), effectiveFrom: start, targetMg, source, createdAt: at });
  await alcoholRepo.insertEvent(tx, {
    id: createId('aev'),
    kind: 'goal_set',
    occurredAt: at,
    payload: { targetMg, previousMg: current?.targetMg ?? null, effectiveFrom: start, source },
  });
  return { ok: true, changed: true, effectiveFrom: start };
}

/**
 * Définit l'objectif (verres standard, en mg) à partir de la semaine civile en cours. Les versions précédentes sont
 * conservées : les semaines passées restent évaluées avec l'objectif qui était alors en vigueur.
 */
export async function setWeeklyGoal(db: Db, targetMg: number, opts: AlcoholOpts = {}): Promise<SetGoalResult> {
  let result: SetGoalResult = { ok: false, code: 'invalid_goal' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    result = await applyGoal(tx, await resolveCtx(tx, opts), targetMg, 'manual');
  });
  return result;
}

export type AcceptSuggestionResult = SetGoalResult | { ok: false; code: 'stale_suggestion' };

export async function acceptGoalSuggestion(
  db: Db,
  expectedProposedMg: number,
  opts: AlcoholOpts = {},
): Promise<AcceptSuggestionResult> {
  let result: AcceptSuggestionResult = { ok: false, code: 'stale_suggestion' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const ctx = await resolveCtx(tx, opts);
    const s = await suggestionOn(tx, ctx);
    if (!s || s.proposedMg !== expectedProposedMg) return;
    result = await applyGoal(tx, ctx, s.proposedMg, 'suggestion');
  });
  return result;
}

/** Refus : aucune modification d'objectif ; la suggestion se tait 4 semaines. */
export async function dismissGoalSuggestion(db: Db, opts: AlcoholOpts = {}): Promise<void> {
  await db.withExclusiveTransactionAsync(async (tx) => {
    const ctx = await resolveCtx(tx, opts);
    await alcoholRepo.insertEvent(tx, {
      id: createId('aev'),
      kind: 'suggestion_dismissed',
      occurredAt: ctx.now.toISOString(),
    });
  });
}

// ───────────────────────── Totaux, semaines, tableau de bord ─────────────────────────

export type DayStatus = 'drinks' | 'zero_declared' | 'no_data';

export interface DaySummary {
  localDate: string;
  totalMg: number;
  count: number;
  /** « 0 déclaré » ≠ « aucune donnée » : ce dernier n'est jamais présenté comme zéro. */
  status: DayStatus;
}

export type VsGoal = 'no_data' | 'no_goal' | 'within' | 'over';

export interface WeekSummary {
  weekStart: string;
  weekEnd: string;
  totalMg: number;
  drinkDays: number;
  zeroDays: number;
  documentedDays: number;
  elapsedDays: number;
  weekOver: boolean;
  goalMg: number | null;
  vsGoal: VsGoal;
}

async function summarizeDays(tx: SqlRunner, start: string, end: string): Promise<DaySummary[]> {
  const [agg, zeros] = await Promise.all([
    alcoholRepo.aggregateByDate(tx, start, end),
    alcoholRepo.listActiveZeroDays(tx, start, end),
  ]);
  const byDate = new Map(agg.map((a) => [a.localDate, a]));
  const zeroSet = new Set(zeros);
  const out: DaySummary[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const a = byDate.get(d);
    out.push({
      localDate: d,
      totalMg: a?.totalMg ?? 0,
      count: a?.count ?? 0,
      status: a && a.count > 0 ? 'drinks' : zeroSet.has(d) ? 'zero_declared' : 'no_data',
    });
  }
  return out;
}

async function summarizeWeek(tx: Db, weekStart: string, today: string): Promise<WeekSummary> {
  const { end } = weekBounds(weekStart);
  const days = await summarizeDays(tx, weekStart, end);
  const elapsed = weekStart > today ? 0 : Math.min(7, daysInclusive(weekStart, today));
  const counted = days.filter((d) => d.localDate <= today);
  const drinkDays = counted.filter((d) => d.status === 'drinks').length;
  const zeroDays = counted.filter((d) => d.status === 'zero_declared').length;
  const totalMg = days.reduce((s, d) => s + d.totalMg, 0);
  const documentedDays = drinkDays + zeroDays;
  const goal = await alcoholRepo.getGoalForWeek(tx, weekStart);
  const vsGoal: VsGoal =
    documentedDays === 0 ? 'no_data' : goal == null ? 'no_goal' : totalMg <= goal.targetMg ? 'within' : 'over';
  return {
    weekStart,
    weekEnd: end,
    totalMg,
    drinkDays,
    zeroDays,
    documentedDays,
    elapsedDays: elapsed,
    weekOver: end < today,
    goalMg: goal?.targetMg ?? null,
    vsGoal,
  };
}

async function suggestionOn(tx: Db, ctx: Ctx): Promise<GoalSuggestion | null> {
  const today = alcoholLogicalDate(ctx.now, ctx.timeZone, ctx.dayStartHour);
  const { start } = weekBounds(today);
  const facts: WeekFacts[] = [];
  for (let i = 1; i <= 4; i += 1) {
    const w = await summarizeWeek(tx, addDays(start, -7 * i), today);
    facts.push({ weekStart: w.weekStart, totalMg: w.totalMg, documentedDays: w.documentedDays, complete: w.weekOver });
  }
  const goal = await alcoholRepo.getGoalForWeek(tx, start);
  const latest = await alcoholRepo.getLatestGoalChange(tx);
  const dismissed = await alcoholRepo.getLastEventAt(tx, 'suggestion_dismissed');
  return computeGoalSuggestion({
    completedWeeksNewestFirst: facts,
    currentGoalMg: goal?.targetMg ?? null,
    lastGoalChangeMs: latest ? Date.parse(latest.createdAt) : null,
    lastDismissMs: dismissed ? Date.parse(dismissed) : null,
    nowMs: ctx.now.getTime(),
  });
}

export interface WeekComparison {
  previousWeekStart: string;
  latestWeekStart: string;
  deltaMg: number;
}

export interface AlcoholDashboard {
  nowIso: string;
  timeZone: string | undefined;
  dayStartHour: number;
  today: string;
  weekStart: string;
  weekEnd: string;
  todayMg: number;
  todayStatus: DayStatus;
  last7Mg: number;
  last7Days: DaySummary[];
  weekMg: number;
  week: WeekSummary;
  /** Semaine en cours puis 4 semaines précédentes (base de la future page Bilan). */
  weeks: WeekSummary[];
  comparison: WeekComparison | null;
  goal: { targetMg: number; effectiveFrom: string; source: 'manual' | 'suggestion' } | null;
  suggestion: GoalSuggestion | null;
  since: SinceInfo | null;
  /** Aucune boisson connue ni départ confirmé : on demande une confirmation explicite, on ne suppose rien. */
  needsStartConfirmation: boolean;
  legacyGoalActive: boolean;
}

export async function getAlcoholDashboard(db: Db, opts: AlcoholOpts = {}): Promise<AlcoholDashboard> {
  const ctx = await resolveCtx(db, opts);
  const nowMs = ctx.now.getTime();
  const today = alcoholLogicalDate(ctx.now, ctx.timeZone, ctx.dayStartHour);
  const { start: weekStart, end: weekEnd } = weekBounds(today);

  const last7Start = addDays(today, -6);
  const last7Days = await summarizeDays(db, last7Start, today);
  const todayDay = last7Days[last7Days.length - 1];

  const weeks: WeekSummary[] = [];
  for (let i = 0; i <= 4; i += 1) weeks.push(await summarizeWeek(db, addDays(weekStart, -7 * i), today));

  const documentedComplete = weeks.filter((w) => w.weekOver && w.documentedDays >= 5);
  const comparison: WeekComparison | null =
    documentedComplete.length >= 2
      ? {
          latestWeekStart: documentedComplete[0].weekStart,
          previousWeekStart: documentedComplete[1].weekStart,
          deltaMg: documentedComplete[0].totalMg - documentedComplete[1].totalMg,
        }
      : null;

  const goal = await alcoholRepo.getGoalForWeek(db, weekStart);
  const lastDrink = await alcoholRepo.getLastActiveConsumedAt(db);
  const marker = await alcoholRepo.getActiveStartMarker(db);
  const since = computeSince(lastDrink, marker, nowMs);
  const legacy = await goalRepo.findActiveByTemplateId(db, 'alcohol_limit');

  return {
    nowIso: ctx.now.toISOString(),
    timeZone: ctx.timeZone,
    dayStartHour: ctx.dayStartHour,
    today,
    weekStart,
    weekEnd,
    todayMg: todayDay.totalMg,
    todayStatus: todayDay.status,
    last7Mg: last7Days.reduce((s, d) => s + d.totalMg, 0),
    last7Days,
    weekMg: weeks[0].totalMg,
    week: weeks[0],
    weeks,
    comparison,
    goal: goal ? { targetMg: goal.targetMg, effectiveFrom: goal.effectiveFrom, source: goal.source } : null,
    suggestion: await suggestionOn(db, ctx),
    since,
    needsStartConfirmation: since == null,
    legacyGoalActive: legacy != null && legacy.status !== 'archived' && legacy.status !== 'paused',
  };
}
