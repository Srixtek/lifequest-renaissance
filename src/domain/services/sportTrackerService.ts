import type { Db } from '../../data/db/client';
import type { SqlRunner } from '../../data/db/sqlRunner';
import * as sportRepo from '../../data/db/repositories/sportRepo';
import type { RecordRow, SportCorrection, SportGoalRow, SportSession } from '../../data/db/repositories/sportRepo';
import * as goalRepo from '../../data/db/repositories/goalRepo';
import * as profileRepo from '../../data/db/repositories/profileRepo';
import { categoryForGoal } from '../../data/content/habitCategories';
import { createId } from '../../utils/id';
import { isEvidencePaid } from './questEvidenceClaims';
import { alcoholLogicalDate, weekBounds } from '../rules/alcohol';
import {
  SPORT_ACTIVITIES,
  checkOutcome,
  computeSportSuggestion,
  isGoalMetricAllowed,
  isSportActivityId,
  isValidGoalTarget,
  isValidSessionValues,
  matchHabitGoalToActivity,
  valueForMetric,
  type HabitActivityMatch,
  type SportActivityDef,
  type SportActivityId,
  type SportGoalSuggestion,
  type SportMetric,
  type SportOutcome,
  type ValidatedSession,
} from '../rules/sport';

/**
 * Journal Sport V1-03A. Ce service n'écrit JAMAIS dans les registres XP / or / éclats, l'inventaire, les quêtes ni
 * la progression RPG, et ne touche ni `challenge_sessions` ni `tracking_events` : le suivi Sport historique
 * (habitude `sport_minutes`, chrono sport, quêtes) reste séparé. Les séances « atteintes » sont exposées comme
 * preuves structurées (`listSportEvidence`) pour une future mission Quêtes, sans rien créditer ici.
 */

export interface SportOpts {
  now?: Date;
  timeZone?: string | null;
  dayStartHour?: number;
}

interface Ctx {
  now: Date;
  timeZone: string | undefined;
  dayStartHour: number;
}

async function resolveCtx(db: SqlRunner, opts: SportOpts): Promise<Ctx> {
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

const RECORD_METRICS: Record<SportActivityId, SportMetric[]> = {
  pushups: ['reps'],
  walking: ['duration_sec', 'distance_m'],
  running: ['duration_sec', 'distance_m'],
  free: [],
};

function snapshot(s: {
  disciplineName: string | null;
  performedAt: string;
  localDate: string;
  reps: number | null;
  durationSec: number | null;
  distanceM: number | null;
  outcome: SportOutcome;
  note: string | null;
}) {
  return {
    disciplineName: s.disciplineName,
    performedAt: s.performedAt,
    localDate: s.localDate,
    reps: s.reps,
    durationSec: s.durationSec,
    distanceM: s.distanceM,
    outcome: s.outcome,
    note: s.note,
  };
}

type SessionErrorCode =
  | 'invalid_session'
  | 'invalid_time'
  | 'future_time'
  | 'invalid_outcome'
  | 'no_goal'
  | 'stale_goal'
  | 'missing_performance'
  | 'below_target';

// ───────────────────────── Enregistrer / corriger / annuler ─────────────────────────

export interface NewRecord {
  metric: SportMetric;
  value: number;
  previous: number | null;
}

export type AddSessionResult =
  | { ok: true; session: SportSession; duplicate: boolean; newRecords: NewRecord[] }
  | { ok: false; code: SessionErrorCode };

export interface AddSessionInput {
  session: ValidatedSession;
  performedAt: Date;
  /** `free` (défaut) : aucune réussite ni échec revendiqué. `achieved` / `failed` : tentative de l'objectif `goalId`. */
  outcome?: SportOutcome;
  goalId?: string | null;
  clientRequestId?: string | null;
}

/**
 * Enregistre UNE séance (plusieurs par jour possibles). `clientRequestId` rend l'ajout idempotent. Une tentative
 * « échouée » est conservée avec sa performance réelle ; elle n'est jamais convertie en réussite.
 */
export async function addSession(db: Db, input: AddSessionInput, opts: SportOpts = {}): Promise<AddSessionResult> {
  let result: AddSessionResult = { ok: false, code: 'invalid_session' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const ctx = await resolveCtx(tx, opts);
    if (!isValidSessionValues(input.session)) return;
    const t = validTime(input.performedAt, ctx.now);
    if (t !== 'ok') {
      result = { ok: false, code: t };
      return;
    }
    if (input.clientRequestId) {
      const existing = await sportRepo.getSessionByRequestId(tx, input.clientRequestId);
      if (existing) {
        result = { ok: true, session: existing, duplicate: true, newRecords: [] };
        return;
      }
    }
    const outcome: SportOutcome = input.outcome ?? 'free';
    let goal: SportGoalRow | null = null;
    if (outcome === 'free') {
      if (input.goalId) {
        result = { ok: false, code: 'invalid_outcome' };
        return;
      }
    } else if (outcome === 'achieved' || outcome === 'failed') {
      const latest = await sportRepo.getLatestGoalRow(tx, input.session.activityId);
      if (!latest || latest.targetValue == null || !input.goalId) {
        result = { ok: false, code: 'no_goal' };
        return;
      }
      if (latest.id !== input.goalId) {
        result = { ok: false, code: 'stale_goal' };
        return;
      }
      goal = latest;
      const check = checkOutcome(outcome, latest.metric, latest.targetValue, input.session);
      if (check !== 'ok') {
        result = { ok: false, code: check };
        return;
      }
    } else {
      result = { ok: false, code: 'invalid_outcome' };
      return;
    }

    const at = ctx.now.toISOString();
    const id = createId('spt');
    const localDate = alcoholLogicalDate(input.performedAt, ctx.timeZone, ctx.dayStartHour);
    await sportRepo.insertSession(tx, {
      id,
      clientRequestId: input.clientRequestId ?? null,
      activityId: input.session.activityId,
      disciplineName: input.session.disciplineName,
      performedAt: input.performedAt.toISOString(),
      localDate,
      reps: input.session.reps,
      durationSec: input.session.durationSec,
      distanceM: input.session.distanceM,
      outcome,
      goalId: goal?.id ?? null,
      goalMetric: goal?.metric ?? null,
      goalTarget: goal?.targetValue ?? null,
      note: input.session.note,
      createdAt: at,
    });

    const newRecords: NewRecord[] = [];
    for (const metric of RECORD_METRICS[input.session.activityId]) {
      const value = valueForMetric(metric, input.session);
      if (value == null || value <= 0) continue;
      const before = await sportRepo.getBestExcluding(tx, input.session.activityId, metric, id);
      if (before == null || value > before) newRecords.push({ metric, value, previous: before });
    }
    await sportRepo.insertEvent(tx, {
      id: createId('sev'),
      kind: 'session_logged',
      sessionId: id,
      activityId: input.session.activityId,
      localDate,
      occurredAt: at,
      payload: {
        outcome,
        reps: input.session.reps,
        durationSec: input.session.durationSec,
        distanceM: input.session.distanceM,
        goalId: goal?.id ?? null,
        goalMetric: goal?.metric ?? null,
        goalTarget: goal?.targetValue ?? null,
        performedAt: input.performedAt.toISOString(),
      },
    });
    for (const r of newRecords) {
      await sportRepo.insertEvent(tx, {
        id: createId('sev'),
        kind: 'record_set',
        sessionId: id,
        activityId: input.session.activityId,
        localDate,
        occurredAt: at,
        payload: r,
      });
    }
    result = { ok: true, session: (await sportRepo.getSession(tx, id))!, duplicate: false, newRecords };
  });
  return result;
}

export type EditSessionResult =
  | { ok: true; session: SportSession; changed: boolean }
  | { ok: false; code: 'not_found' | 'cancelled' | 'rewarded' | SessionErrorCode };

/**
 * Correction : quantité, durée, distance, date, note, résultat. L'état précédent est conservé dans la trace d'audit.
 * L'activité et l'objectif associé restent figés. Records et totaux sont recalculés depuis les séances valides.
 */
export async function editSession(
  db: Db,
  id: string,
  next: { session: ValidatedSession; performedAt: Date; outcome?: SportOutcome },
  opts: SportOpts = {},
): Promise<EditSessionResult> {
  let result: EditSessionResult = { ok: false, code: 'not_found' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const ctx = await resolveCtx(tx, opts);
    const cur = await sportRepo.getSession(tx, id);
    if (!cur) return;
    if (cur.status !== 'active') {
      result = { ok: false, code: 'cancelled' };
      return;
    }
    if (next.session.activityId !== cur.activityId || !isValidSessionValues(next.session)) {
      result = { ok: false, code: 'invalid_session' };
      return;
    }
    const t = validTime(next.performedAt, ctx.now);
    if (t !== 'ok') {
      result = { ok: false, code: t };
      return;
    }
    const outcome: SportOutcome = next.outcome ?? cur.outcome;
    if (cur.goalId == null) {
      if (outcome !== 'free') {
        result = { ok: false, code: 'invalid_outcome' };
        return;
      }
    } else {
      if (outcome !== 'achieved' && outcome !== 'failed') {
        result = { ok: false, code: 'invalid_outcome' };
        return;
      }
      const check = checkOutcome(outcome, cur.goalMetric!, cur.goalTarget!, next.session);
      if (check !== 'ok') {
        result = { ok: false, code: check };
        return;
      }
    }
    const at = ctx.now.toISOString();
    const row = {
      activityId: cur.activityId,
      disciplineName: next.session.disciplineName,
      performedAt: next.performedAt.toISOString(),
      localDate: alcoholLogicalDate(next.performedAt, ctx.timeZone, ctx.dayStartHour),
      reps: next.session.reps,
      durationSec: next.session.durationSec,
      distanceM: next.session.distanceM,
      outcome,
      note: next.session.note,
    };
    const before = snapshot(cur);
    const after = snapshot(row);
    if (JSON.stringify(before) === JSON.stringify(after)) {
      result = { ok: true, session: cur, changed: false };
      return;
    }
    const proofChanged =
      cur.performedAt !== row.performedAt ||
      cur.reps !== row.reps ||
      cur.durationSec !== row.durationSec ||
      cur.distanceM !== row.distanceM ||
      cur.outcome !== row.outcome;
    if (proofChanged && (await isEvidencePaid(tx, `sport_session:${id}`))) {
      result = { ok: false, code: 'rewarded' };
      return;
    }
    await sportRepo.insertCorrection(tx, {
      id: createId('scr'),
      sessionId: id,
      kind: 'edit',
      before,
      after,
      createdAt: at,
    });
    await sportRepo.updateSession(tx, id, row, at);
    await sportRepo.insertEvent(tx, {
      id: createId('sev'),
      kind: 'session_edited',
      sessionId: id,
      activityId: cur.activityId,
      localDate: row.localDate,
      occurredAt: at,
      payload: { before, after },
    });
    result = { ok: true, session: (await sportRepo.getSession(tx, id))!, changed: true };
  });
  return result;
}

export type CancelSessionResult = { ok: true } | { ok: false; code: 'not_found' | 'already_cancelled' | 'rewarded' };

/** Annulation logique : la séance et son audit restent en base ; elle sort des totaux, records et preuves. */
export async function cancelSession(db: Db, id: string, opts: SportOpts = {}): Promise<CancelSessionResult> {
  let result: CancelSessionResult = { ok: false, code: 'not_found' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const ctx = await resolveCtx(tx, opts);
    const cur = await sportRepo.getSession(tx, id);
    if (!cur) return;
    if (cur.status === 'cancelled') {
      result = { ok: false, code: 'already_cancelled' };
      return;
    }
    if (await isEvidencePaid(tx, `sport_session:${id}`)) {
      result = { ok: false, code: 'rewarded' };
      return;
    }
    const at = ctx.now.toISOString();
    await sportRepo.insertCorrection(tx, {
      id: createId('scr'),
      sessionId: id,
      kind: 'cancel',
      before: snapshot(cur),
      after: null,
      createdAt: at,
    });
    await sportRepo.cancelSession(tx, id, at);
    await sportRepo.insertEvent(tx, {
      id: createId('sev'),
      kind: 'session_cancelled',
      sessionId: id,
      activityId: cur.activityId,
      localDate: cur.localDate,
      occurredAt: at,
      payload: { reps: cur.reps, durationSec: cur.durationSec, distanceM: cur.distanceM, outcome: cur.outcome },
    });
    result = { ok: true };
  });
  return result;
}

export async function getSessionAudit(db: Db, id: string): Promise<SportCorrection[]> {
  return sportRepo.listCorrections(db, id);
}

export async function listDaySessions(db: Db, localDate: string, includeCancelled = true): Promise<SportSession[]> {
  return sportRepo.listSessionsForDate(db, localDate, includeCancelled);
}

// ───────────────────────── Objectifs versionnés ─────────────────────────

export interface SportGoalView {
  id: string;
  metric: SportMetric;
  target: number;
  effectiveFrom: string;
  source: 'manual' | 'suggestion' | 'habit';
  reason: string | null;
  legacyGoalId: string | null;
}

function toGoalView(g: SportGoalRow | null): SportGoalView | null {
  if (!g || g.targetValue == null) return null;
  return {
    id: g.id,
    metric: g.metric,
    target: g.targetValue,
    effectiveFrom: g.effectiveFrom,
    source: g.source,
    reason: g.reason,
    legacyGoalId: g.legacyGoalId,
  };
}

export type SetSportGoalResult =
  | { ok: true; changed: boolean; goal: SportGoalView | null }
  | { ok: false; code: 'invalid_goal' };

async function applyGoal(
  tx: Db,
  ctx: Ctx,
  args: {
    activityId: SportActivityId;
    metric: SportMetric;
    target: number | null;
    source: 'manual' | 'suggestion' | 'habit';
    reason: string | null;
    legacyGoalId?: string | null;
  },
): Promise<SetSportGoalResult> {
  if (!isSportActivityId(args.activityId) || !isGoalMetricAllowed(args.activityId, args.metric)) {
    return { ok: false, code: 'invalid_goal' };
  }
  if (args.target != null && !isValidGoalTarget(args.metric, args.target)) return { ok: false, code: 'invalid_goal' };
  const latest = await sportRepo.getLatestGoalRow(tx, args.activityId);
  const unchanged = latest
    ? latest.targetValue === args.target && (args.target == null || latest.metric === args.metric)
    : args.target == null;
  if (unchanged) return { ok: true, changed: false, goal: toGoalView(latest) };
  const at = ctx.now.toISOString();
  const row: SportGoalRow = {
    id: createId('sgl'),
    activityId: args.activityId,
    metric: args.metric,
    targetValue: args.target,
    effectiveFrom: alcoholLogicalDate(ctx.now, ctx.timeZone, ctx.dayStartHour),
    source: args.source,
    reason: args.reason,
    legacyGoalId: args.legacyGoalId ?? null,
    createdAt: at,
  };
  await sportRepo.insertGoal(tx, row);
  await sportRepo.insertEvent(tx, {
    id: createId('sev'),
    kind: 'goal_set',
    activityId: args.activityId,
    localDate: row.effectiveFrom,
    occurredAt: at,
    payload: {
      goalId: row.id,
      metric: args.metric,
      target: args.target,
      previousTarget: latest?.targetValue ?? null,
      previousMetric: latest?.metric ?? null,
      source: args.source,
    },
  });
  return { ok: true, changed: true, goal: toGoalView(row) };
}

/**
 * Fixe (ou retire, `target = null`) l'objectif d'une activité. Append-only : les anciennes versions et les séances
 * déjà rattachées à une version précédente restent évaluées avec la cible d'alors.
 */
export async function setSportGoal(
  db: Db,
  input: { activityId: SportActivityId; metric: SportMetric; target: number | null },
  opts: SportOpts = {},
): Promise<SetSportGoalResult> {
  let result: SetSportGoalResult = { ok: false, code: 'invalid_goal' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    result = await applyGoal(tx, await resolveCtx(tx, opts), {
      ...input,
      source: 'manual',
      reason: input.target == null ? 'Objectif retiré' : null,
    });
  });
  return result;
}

export async function getSportGoalHistory(db: Db, activityId: SportActivityId): Promise<SportGoalRow[]> {
  return sportRepo.listGoalHistory(db, activityId);
}

async function suggestionFor(tx: Db, activityId: SportActivityId): Promise<SportGoalSuggestion | null> {
  const goal = await sportRepo.getLatestGoalRow(tx, activityId);
  if (!goal || goal.targetValue == null) return null;
  const attempts = await sportRepo.listAttemptsForGoal(tx, goal.id, 8);
  const dismissedAt = await sportRepo.getLastEventAt(tx, 'suggestion_dismissed', activityId, goal.id);
  const since = dismissedAt ? await sportRepo.countAttemptsSince(tx, goal.id, dismissedAt) : null;
  return computeSportSuggestion({
    metric: goal.metric,
    target: goal.targetValue,
    attemptsNewestFirst: attempts.map((s) => ({
      value: valueForMetric(goal.metric, s)!,
      outcome: s.outcome as 'achieved' | 'failed',
      localDate: s.localDate,
    })),
    attemptsSinceDismissal: since,
  });
}

export type AcceptSportSuggestionResult = SetSportGoalResult | { ok: false; code: 'stale_suggestion' };

/** Acceptation explicite : nouvelle version d'objectif tracée (raison conservée). Jamais appliquée autrement. */
export async function acceptSportSuggestion(
  db: Db,
  activityId: SportActivityId,
  expectedProposedTarget: number,
  opts: SportOpts = {},
): Promise<AcceptSportSuggestionResult> {
  let result: AcceptSportSuggestionResult = { ok: false, code: 'stale_suggestion' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const ctx = await resolveCtx(tx, opts);
    const s = await suggestionFor(tx, activityId);
    if (!s || s.proposedTarget !== expectedProposedTarget) return;
    const r = await applyGoal(tx, ctx, {
      activityId,
      metric: s.metric,
      target: s.proposedTarget,
      source: 'suggestion',
      reason: s.message,
    });
    if (r.ok && r.changed) {
      await sportRepo.insertEvent(tx, {
        id: createId('sev'),
        kind: 'suggestion_accepted',
        activityId,
        occurredAt: ctx.now.toISOString(),
        payload: { goalId: r.goal?.id, from: s.currentTarget, to: s.proposedTarget, reason: s.reason },
      });
    }
    result = r;
  });
  return result;
}

/** Refus : l'objectif ne change pas ; la suggestion se tait jusqu'à de nouvelles tentatives. */
export async function dismissSportSuggestion(db: Db, activityId: SportActivityId, opts: SportOpts = {}): Promise<void> {
  await db.withExclusiveTransactionAsync(async (tx) => {
    const ctx = await resolveCtx(tx, opts);
    const goal = await sportRepo.getLatestGoalRow(tx, activityId);
    if (!goal || goal.targetValue == null) return;
    await sportRepo.insertEvent(tx, {
      id: createId('sev'),
      kind: 'suggestion_dismissed',
      activityId,
      occurredAt: ctx.now.toISOString(),
      payload: { goalId: goal.id },
    });
  });
}

// ───────────────────────── Habitudes Sport personnalisées ─────────────────────────

export interface HabitLink {
  goalId: string;
  title: string;
  paused: boolean;
  match: HabitActivityMatch | null;
  /** Plusieurs habitudes pour la même activité : aucun rattachement automatique. */
  ambiguous: boolean;
  adopted: boolean;
}

async function listHabitLinks(tx: Db, today: string): Promise<HabitLink[]> {
  const goals = (await goalRepo.listGoals(tx)).filter((g) => categoryForGoal(g) === 'sport');
  const raw: Array<{ goalId: string; title: string; paused: boolean; match: HabitActivityMatch | null }> = [];
  for (const g of goals) {
    const v = await goalRepo.getVersionForDate(tx, g.id, today);
    raw.push({
      goalId: g.id,
      title: g.title,
      paused: g.status === 'paused',
      match: matchHabitGoalToActivity({ title: g.title, unit: g.unit, target: v?.targetValue ?? null }),
    });
  }
  const perActivity = new Map<SportActivityId, number>();
  for (const r of raw) if (r.match) perActivity.set(r.match.activityId, (perActivity.get(r.match.activityId) ?? 0) + 1);
  const links: HabitLink[] = [];
  for (const r of raw) {
    const latest = r.match ? await sportRepo.getLatestGoalRow(tx, r.match.activityId) : null;
    links.push({
      ...r,
      ambiguous: r.match != null && (perActivity.get(r.match.activityId) ?? 0) > 1,
      adopted:
        latest != null &&
        r.match != null &&
        latest.legacyGoalId === r.goalId &&
        latest.targetValue === r.match.target &&
        latest.metric === r.match.metric,
    });
  }
  return links;
}

export type AdoptHabitResult =
  | { ok: true; changed: boolean; activityId: SportActivityId }
  | { ok: false; code: 'not_found' | 'not_compatible' | 'ambiguous' | 'invalid_goal' };

/**
 * Reprend la cible d'une habitude Sport personnalisée comme objectif du journal, sans modifier l'habitude,
 * uniquement si le rattachement est sans ambiguïté. Action explicite de l'utilisateur.
 */
export async function adoptHabitGoal(db: Db, habitGoalId: string, opts: SportOpts = {}): Promise<AdoptHabitResult> {
  let result: AdoptHabitResult = { ok: false, code: 'not_found' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const ctx = await resolveCtx(tx, opts);
    const today = alcoholLogicalDate(ctx.now, ctx.timeZone, ctx.dayStartHour);
    const links = await listHabitLinks(tx, today);
    const link = links.find((l) => l.goalId === habitGoalId);
    if (!link) return;
    if (!link.match) {
      result = { ok: false, code: 'not_compatible' };
      return;
    }
    if (link.ambiguous) {
      result = { ok: false, code: 'ambiguous' };
      return;
    }
    const r = await applyGoal(tx, ctx, {
      activityId: link.match.activityId,
      metric: link.match.metric,
      target: link.match.target,
      source: 'habit',
      reason: `Reprise de l'habitude « ${link.title} »`,
      legacyGoalId: habitGoalId,
    });
    result = r.ok
      ? { ok: true, changed: r.changed, activityId: link.match.activityId }
      : { ok: false, code: 'invalid_goal' };
  });
  return result;
}

// ───────────────────────── Tableau de bord ─────────────────────────

export interface DayAgg {
  count: number;
  totalReps: number | null;
  bestReps: number | null;
  totalDurationSec: number | null;
  bestDurationSec: number | null;
  totalDistanceM: number | null;
  bestDistanceM: number | null;
  achieved: number;
  failed: number;
}

const EMPTY_AGG: DayAgg = {
  count: 0,
  totalReps: null,
  bestReps: null,
  totalDurationSec: null,
  bestDurationSec: null,
  totalDistanceM: null,
  bestDistanceM: null,
  achieved: 0,
  failed: 0,
};

function aggOf(a: sportRepo.PeriodAggregate | undefined): DayAgg {
  if (!a) return { ...EMPTY_AGG };
  return {
    count: a.count,
    totalReps: a.totalReps,
    bestReps: a.bestReps,
    totalDurationSec: a.totalDurationSec,
    bestDurationSec: a.bestDurationSec,
    totalDistanceM: a.totalDistanceM,
    bestDistanceM: a.bestDistanceM,
    achieved: a.achieved,
    failed: a.failed,
  };
}

export interface SportActivitySummary {
  activity: SportActivityDef;
  today: DayAgg;
  week: DayAgg;
  records: Partial<Record<SportMetric, RecordRow>>;
  goal: SportGoalView | null;
  suggestion: SportGoalSuggestion | null;
  recent: SportSession[];
  trend: 'up' | 'flat' | 'down' | null;
}

export interface SportDashboard {
  nowIso: string;
  timeZone: string | undefined;
  dayStartHour: number;
  today: string;
  weekStart: string;
  weekEnd: string;
  mainActivityId: SportActivityId;
  activities: SportActivitySummary[];
  recentSessions: SportSession[];
  habitLinks: HabitLink[];
}

function computeTrend(recentNewestFirst: SportSession[], metric: SportMetric | null): 'up' | 'flat' | 'down' | null {
  if (!metric) return null;
  const values = recentNewestFirst.map((s) => valueForMetric(metric, s)).filter((v): v is number => v != null);
  if (values.length < 4) return null;
  const newest = values.slice(0, 3);
  const previous = values.slice(3, 6);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const a = avg(newest);
  const b = avg(previous);
  if (b <= 0) return null;
  if (a > b * 1.05) return 'up';
  if (a < b * 0.95) return 'down';
  return 'flat';
}

export async function getSportDashboard(db: Db, opts: SportOpts = {}): Promise<SportDashboard> {
  const ctx = await resolveCtx(db, opts);
  const today = alcoholLogicalDate(ctx.now, ctx.timeZone, ctx.dayStartHour);
  const { start: weekStart, end: weekEnd } = weekBounds(today);
  const [todayAgg, weekAgg] = await Promise.all([
    sportRepo.aggregateByActivity(db, today, today),
    sportRepo.aggregateByActivity(db, weekStart, weekEnd),
  ]);
  const recentSessions = await sportRepo.listRecentSessions(db, { limit: 10 });

  const activities: SportActivitySummary[] = [];
  for (const def of SPORT_ACTIVITIES) {
    const records: Partial<Record<SportMetric, RecordRow>> = {};
    for (const m of RECORD_METRICS[def.id]) {
      const r = await sportRepo.getRecord(db, def.id, m);
      if (r) records[m] = r;
    }
    const recent = await sportRepo.listRecentSessions(db, { activityId: def.id, limit: 6 });
    const latestGoal = await sportRepo.getLatestGoalRow(db, def.id);
    activities.push({
      activity: def,
      today: aggOf(todayAgg.find((a) => a.activityId === def.id)),
      week: aggOf(weekAgg.find((a) => a.activityId === def.id)),
      records,
      goal: toGoalView(latestGoal),
      suggestion: await suggestionFor(db, def.id),
      recent: recent.slice(0, 5),
      trend: computeTrend(recent, def.primaryMetric),
    });
  }
  return {
    nowIso: ctx.now.toISOString(),
    timeZone: ctx.timeZone,
    dayStartHour: ctx.dayStartHour,
    today,
    weekStart,
    weekEnd,
    mainActivityId: recentSessions[0]?.activityId ?? 'pushups',
    activities,
    recentSessions,
    habitLinks: await listHabitLinks(db, today),
  };
}

export interface SportDayTotals {
  localDate: string;
  agg: DayAgg;
}

/** Totaux quotidiens (jours sans séance : `count = 0`, jamais présentés comme une performance nulle). */
export async function getSportDayTotals(
  db: Db,
  activityId: SportActivityId,
  startDate: string,
  endDate: string,
): Promise<SportDayTotals[]> {
  const out: SportDayTotals[] = [];
  const [y, m, d] = startDate.split('-').map(Number);
  for (let t = Date.UTC(y, m - 1, d); ; t += 86_400_000) {
    const dt = new Date(t);
    const key = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
    if (key > endDate) break;
    const rows = await sportRepo.aggregateByActivity(db, key, key);
    out.push({ localDate: key, agg: aggOf(rows.find((r) => r.activityId === activityId)) });
    if (out.length > 400) break;
  }
  return out;
}

// ───────────────────────── Preuves structurées (future mission Quêtes) ─────────────────────────

export interface SportEvidence {
  /** Clé stable et unique par séance : un consommateur futur s'en sert pour ne jamais créditer deux fois. */
  evidenceKey: string;
  sessionId: string;
  activityId: SportActivityId;
  performedAt: string;
  localDate: string;
  reps: number | null;
  durationSec: number | null;
  distanceM: number | null;
  outcome: SportOutcome;
  goalId: string | null;
  goalMetric: SportMetric | null;
  goalTarget: number | null;
  /** Vrai uniquement pour une tentative d'objectif RÉELLEMENT atteinte. Échecs et séances libres : faux. */
  countsAsSuccess: boolean;
}

/** Séances actives (annulées exclues), triées par date. Lecture seule : aucune récompense n'est attribuée ici. */
export async function listSportEvidence(
  db: Db,
  range: { sinceIso?: string | null; untilIso?: string | null } = {},
): Promise<SportEvidence[]> {
  const rows = await sportRepo.listActiveSessionsInRange(db, range);
  return rows.map((s) => ({
    evidenceKey: `sport_session:${s.id}`,
    sessionId: s.id,
    activityId: s.activityId,
    performedAt: s.performedAt,
    localDate: s.localDate,
    reps: s.reps,
    durationSec: s.durationSec,
    distanceM: s.distanceM,
    outcome: s.outcome,
    goalId: s.goalId,
    goalMetric: s.goalMetric,
    goalTarget: s.goalTarget,
    countsAsSuccess: s.outcome === 'achieved',
  }));
}
