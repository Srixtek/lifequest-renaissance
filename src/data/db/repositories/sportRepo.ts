import type { SQLiteBindValue } from 'expo-sqlite';
import type { Db } from '../client';
import type { SqlRunner } from '../sqlRunner';
import { SPORT_ACTIVITY_SEED_SQL } from '../migrations/014_sport_tracker';
import type { SportActivityId, SportMetric, SportOutcome } from '../../../domain/rules/sport';

type Conn = Db | SqlRunner;

export interface SportSession {
  id: string;
  clientRequestId: string | null;
  activityId: SportActivityId;
  disciplineName: string | null;
  performedAt: string;
  localDate: string;
  reps: number | null;
  durationSec: number | null;
  distanceM: number | null;
  outcome: SportOutcome;
  goalId: string | null;
  goalMetric: SportMetric | null;
  goalTarget: number | null;
  note: string | null;
  status: 'active' | 'cancelled';
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  corrections: number;
}

export interface SportGoalRow {
  id: string;
  activityId: SportActivityId;
  metric: SportMetric;
  /** `null` : objectif retiré à cette date (l'historique est conservé). */
  targetValue: number | null;
  effectiveFrom: string;
  source: 'manual' | 'suggestion' | 'habit';
  reason: string | null;
  legacyGoalId: string | null;
  createdAt: string;
}

export interface SportCorrection {
  id: string;
  sessionId: string;
  kind: 'edit' | 'cancel';
  before: Record<string, unknown>;
  after: Record<string, unknown> | null;
  createdAt: string;
}

const SELECT_SESSION = `
  SELECT s.*, (SELECT COUNT(*) FROM sport_corrections k WHERE k.session_id = s.id AND k.kind = 'edit') AS corrections
  FROM sport_sessions s`;

function mapSession(r: Record<string, unknown>): SportSession {
  const num = (v: unknown) => (v != null ? Number(v) : null);
  return {
    id: String(r.id),
    clientRequestId: r.client_request_id != null ? String(r.client_request_id) : null,
    activityId: String(r.activity_id) as SportActivityId,
    disciplineName: r.discipline_name != null ? String(r.discipline_name) : null,
    performedAt: String(r.performed_at),
    localDate: String(r.local_date),
    reps: num(r.reps),
    durationSec: num(r.duration_sec),
    distanceM: num(r.distance_m),
    outcome: String(r.outcome) as SportOutcome,
    goalId: r.goal_id != null ? String(r.goal_id) : null,
    goalMetric: r.goal_metric != null ? (String(r.goal_metric) as SportMetric) : null,
    goalTarget: num(r.goal_target),
    note: r.note != null ? String(r.note) : null,
    status: String(r.status) as 'active' | 'cancelled',
    cancelledAt: r.cancelled_at != null ? String(r.cancelled_at) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    corrections: Number(r.corrections ?? 0),
  };
}

export async function ensureActivities(db: Db): Promise<void> {
  await db.execAsync(SPORT_ACTIVITY_SEED_SQL);
}

export async function getSession(db: Conn, id: string): Promise<SportSession | null> {
  const r = await db.getFirstAsync<Record<string, unknown>>(`${SELECT_SESSION} WHERE s.id = ?`, id);
  return r ? mapSession(r) : null;
}

export async function getSessionByRequestId(db: Conn, requestId: string): Promise<SportSession | null> {
  const r = await db.getFirstAsync<Record<string, unknown>>(
    `${SELECT_SESSION} WHERE s.client_request_id = ?`,
    requestId,
  );
  return r ? mapSession(r) : null;
}

export interface SessionFields {
  activityId: SportActivityId;
  disciplineName: string | null;
  performedAt: string;
  localDate: string;
  reps: number | null;
  durationSec: number | null;
  distanceM: number | null;
  outcome: SportOutcome;
  note: string | null;
}

export interface NewSessionRow extends SessionFields {
  id: string;
  clientRequestId: string | null;
  goalId: string | null;
  goalMetric: SportMetric | null;
  goalTarget: number | null;
  createdAt: string;
}

export async function insertSession(db: Conn, s: NewSessionRow): Promise<void> {
  await db.runAsync(
    `INSERT INTO sport_sessions
       (id, client_request_id, activity_id, discipline_name, performed_at, local_date, reps, duration_sec, distance_m,
        outcome, goal_id, goal_metric, goal_target, note, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    s.id,
    s.clientRequestId,
    s.activityId,
    s.disciplineName,
    s.performedAt,
    s.localDate,
    s.reps,
    s.durationSec,
    s.distanceM,
    s.outcome,
    s.goalId,
    s.goalMetric,
    s.goalTarget,
    s.note,
    s.createdAt,
    s.createdAt,
  );
}

/** Correction : l'activité, l'objectif associé et son instantané restent figés ; seule la performance est corrigée. */
export async function updateSession(db: Conn, id: string, f: SessionFields, updatedAt: string): Promise<boolean> {
  const r = await db.runAsync(
    `UPDATE sport_sessions
     SET discipline_name = ?, performed_at = ?, local_date = ?, reps = ?, duration_sec = ?, distance_m = ?,
         outcome = ?, note = ?, updated_at = ?
     WHERE id = ? AND status = 'active'`,
    f.disciplineName,
    f.performedAt,
    f.localDate,
    f.reps,
    f.durationSec,
    f.distanceM,
    f.outcome,
    f.note,
    updatedAt,
    id,
  );
  return r.changes === 1;
}

export async function cancelSession(db: Conn, id: string, at: string): Promise<boolean> {
  const r = await db.runAsync(
    `UPDATE sport_sessions SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ? AND status = 'active'`,
    at,
    at,
    id,
  );
  return r.changes === 1;
}

export async function insertCorrection(
  db: Conn,
  k: { id: string; sessionId: string; kind: 'edit' | 'cancel'; before: unknown; after: unknown | null; createdAt: string },
): Promise<void> {
  await db.runAsync(
    `INSERT INTO sport_corrections (id, session_id, kind, before_json, after_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    k.id,
    k.sessionId,
    k.kind,
    JSON.stringify(k.before),
    k.after != null ? JSON.stringify(k.after) : null,
    k.createdAt,
  );
}

export async function listCorrections(db: Conn, sessionId: string): Promise<SportCorrection[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM sport_corrections WHERE session_id = ? ORDER BY created_at ASC, rowid ASC`,
    sessionId,
  );
  return rows.map((r) => ({
    id: String(r.id),
    sessionId: String(r.session_id),
    kind: String(r.kind) as 'edit' | 'cancel',
    before: JSON.parse(String(r.before_json)),
    after: r.after_json != null ? JSON.parse(String(r.after_json)) : null,
    createdAt: String(r.created_at),
  }));
}

export async function listSessionsForDate(
  db: Conn,
  localDate: string,
  includeCancelled = false,
): Promise<SportSession[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `${SELECT_SESSION} WHERE s.local_date = ? ${includeCancelled ? '' : `AND s.status = 'active'`}
     ORDER BY s.performed_at ASC, s.rowid ASC`,
    localDate,
  );
  return rows.map(mapSession);
}

export async function listRecentSessions(
  db: Conn,
  opts: { activityId?: SportActivityId; limit: number; includeCancelled?: boolean },
): Promise<SportSession[]> {
  const where: string[] = [];
  const params: SQLiteBindValue[] = [];
  if (!opts.includeCancelled) where.push(`s.status = 'active'`);
  if (opts.activityId) {
    where.push('s.activity_id = ?');
    params.push(opts.activityId);
  }
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `${SELECT_SESSION} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY s.performed_at DESC, s.rowid DESC LIMIT ?`,
    ...params,
    opts.limit,
  );
  return rows.map(mapSession);
}

export async function listActiveSessionsInRange(
  db: Conn,
  range: { sinceIso?: string | null; untilIso?: string | null },
): Promise<SportSession[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `${SELECT_SESSION}
     WHERE s.status = 'active' AND (? IS NULL OR s.performed_at >= ?) AND (? IS NULL OR s.performed_at < ?)
     ORDER BY s.performed_at ASC, s.rowid ASC`,
    range.sinceIso ?? null,
    range.sinceIso ?? null,
    range.untilIso ?? null,
    range.untilIso ?? null,
  );
  return rows.map(mapSession);
}

/** Tentatives (réussies ou échouées) liées à une version précise d'objectif, de la plus récente à la plus ancienne. */
export async function listAttemptsForGoal(db: Conn, goalId: string, limit: number): Promise<SportSession[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `${SELECT_SESSION}
     WHERE s.goal_id = ? AND s.status = 'active' AND s.outcome IN ('achieved', 'failed')
     ORDER BY s.performed_at DESC, s.rowid DESC LIMIT ?`,
    goalId,
    limit,
  );
  return rows.map(mapSession);
}

export interface PeriodAggregate {
  activityId: SportActivityId;
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

/** Totaux par activité sur une plage de dates logiques, calculés depuis les séances actives uniquement. */
export async function aggregateByActivity(db: Conn, startDate: string, endDate: string): Promise<PeriodAggregate[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT activity_id, COUNT(*) AS n,
            SUM(reps) AS reps_total, MAX(reps) AS reps_best,
            SUM(duration_sec) AS dur_total, MAX(duration_sec) AS dur_best,
            SUM(distance_m) AS dist_total, MAX(distance_m) AS dist_best,
            SUM(CASE WHEN outcome = 'achieved' THEN 1 ELSE 0 END) AS achieved,
            SUM(CASE WHEN outcome = 'failed' THEN 1 ELSE 0 END) AS failed
     FROM sport_sessions
     WHERE status = 'active' AND local_date >= ? AND local_date <= ?
     GROUP BY activity_id`,
    startDate,
    endDate,
  );
  const num = (v: unknown) => (v != null ? Number(v) : null);
  return rows.map((r) => ({
    activityId: String(r.activity_id) as SportActivityId,
    count: Number(r.n),
    totalReps: num(r.reps_total),
    bestReps: num(r.reps_best),
    totalDurationSec: num(r.dur_total),
    bestDurationSec: num(r.dur_best),
    totalDistanceM: num(r.dist_total),
    bestDistanceM: num(r.dist_best),
    achieved: Number(r.achieved ?? 0),
    failed: Number(r.failed ?? 0),
  }));
}

export interface RecordRow {
  value: number;
  sessionId: string;
  performedAt: string;
  localDate: string;
}

const RECORD_COLUMN: Record<SportMetric, string> = {
  reps: 'reps',
  duration_sec: 'duration_sec',
  distance_m: 'distance_m',
};

/**
 * Record = meilleure valeur strictement positive parmi les séances actives (tentatives échouées comprises),
 * recalculé à chaque lecture. Égalité : la plus ancienne l'emporte.
 */
export async function getRecord(db: Conn, activityId: SportActivityId, metric: SportMetric): Promise<RecordRow | null> {
  const col = RECORD_COLUMN[metric];
  const r = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT id, ${col} AS v, performed_at, local_date FROM sport_sessions
     WHERE activity_id = ? AND status = 'active' AND ${col} IS NOT NULL AND ${col} > 0
     ORDER BY ${col} DESC, performed_at ASC, rowid ASC LIMIT 1`,
    activityId,
  );
  return r
    ? { value: Number(r.v), sessionId: String(r.id), performedAt: String(r.performed_at), localDate: String(r.local_date) }
    : null;
}

/** Meilleure valeur parmi les séances actives, une séance exclue (calcul « avant cette séance »). */
export async function getBestExcluding(
  db: Conn,
  activityId: SportActivityId,
  metric: SportMetric,
  excludeSessionId: string,
): Promise<number | null> {
  const col = RECORD_COLUMN[metric];
  const r = await db.getFirstAsync<{ v: number | null }>(
    `SELECT MAX(${col}) AS v FROM sport_sessions WHERE activity_id = ? AND status = 'active' AND id != ?`,
    activityId,
    excludeSessionId,
  );
  return r?.v != null ? Number(r.v) : null;
}

// Objectifs versionnés (append-only)

function mapGoal(r: Record<string, unknown>): SportGoalRow {
  return {
    id: String(r.id),
    activityId: String(r.activity_id) as SportActivityId,
    metric: String(r.metric) as SportMetric,
    targetValue: r.target_value != null ? Number(r.target_value) : null,
    effectiveFrom: String(r.effective_from),
    source: String(r.source) as SportGoalRow['source'],
    reason: r.reason != null ? String(r.reason) : null,
    legacyGoalId: r.legacy_goal_id != null ? String(r.legacy_goal_id) : null,
    createdAt: String(r.created_at),
  };
}

/** Dernière version enregistrée pour l'activité (peut être un retrait : `targetValue === null`). */
export async function getLatestGoalRow(db: Conn, activityId: SportActivityId): Promise<SportGoalRow | null> {
  const r = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM sport_goals WHERE activity_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    activityId,
  );
  return r ? mapGoal(r) : null;
}

export async function getGoalRow(db: Conn, id: string): Promise<SportGoalRow | null> {
  const r = await db.getFirstAsync<Record<string, unknown>>(`SELECT * FROM sport_goals WHERE id = ?`, id);
  return r ? mapGoal(r) : null;
}

export async function insertGoal(db: Conn, g: SportGoalRow): Promise<void> {
  await db.runAsync(
    `INSERT INTO sport_goals (id, activity_id, metric, target_value, effective_from, source, reason, legacy_goal_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    g.id,
    g.activityId,
    g.metric,
    g.targetValue,
    g.effectiveFrom,
    g.source,
    g.reason,
    g.legacyGoalId,
    g.createdAt,
  );
}

export async function listGoalHistory(db: Conn, activityId: SportActivityId): Promise<SportGoalRow[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM sport_goals WHERE activity_id = ? ORDER BY created_at ASC, rowid ASC`,
    activityId,
  );
  return rows.map(mapGoal);
}

// Événements (futurs graphiques du Bilan)

export async function insertEvent(
  db: Conn,
  e: {
    id: string;
    kind: string;
    sessionId?: string | null;
    activityId?: string | null;
    localDate?: string | null;
    occurredAt: string;
    payload?: unknown;
  },
): Promise<void> {
  await db.runAsync(
    `INSERT INTO sport_events (id, kind, session_id, activity_id, local_date, occurred_at, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    e.id,
    e.kind,
    e.sessionId ?? null,
    e.activityId ?? null,
    e.localDate ?? null,
    e.occurredAt,
    e.payload !== undefined ? JSON.stringify(e.payload) : null,
  );
}

export async function getLastEventAt(
  db: Conn,
  kind: string,
  activityId: SportActivityId,
  goalId?: string,
): Promise<string | null> {
  const rows = await db.getAllAsync<{ occurred_at: string; payload_json: string | null }>(
    `SELECT occurred_at, payload_json FROM sport_events WHERE kind = ? AND activity_id = ? ORDER BY occurred_at DESC, rowid DESC`,
    kind,
    activityId,
  );
  for (const r of rows) {
    if (!goalId) return r.occurred_at;
    try {
      if ((JSON.parse(r.payload_json ?? '{}') as { goalId?: string }).goalId === goalId) return r.occurred_at;
    } catch {
      /* payload illisible : ignoré */
    }
  }
  return null;
}

export async function countAttemptsSince(db: Conn, goalId: string, sinceIso: string): Promise<number> {
  const r = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM sport_sessions
     WHERE goal_id = ? AND status = 'active' AND outcome IN ('achieved', 'failed') AND created_at > ?`,
    goalId,
    sinceIso,
  );
  return Number(r?.n ?? 0);
}
