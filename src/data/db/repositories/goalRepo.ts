import type { Db } from '../client';
import type { SqlRunner } from '../sqlRunner';
import type { GoalDefinition, GoalVersion, TrackingEvent, TrackingStatus } from '../../../domain/models/types';

type Conn = Db | SqlRunner;

export async function listGoals(db: Conn, includeArchived = false): Promise<GoalDefinition[]> {
  const sql = includeArchived
    ? 'SELECT * FROM goal_definitions ORDER BY created_at'
    : `SELECT * FROM goal_definitions WHERE status != 'archived' ORDER BY created_at`;
  const rows = await db.getAllAsync<any>(sql);
  return rows.map(mapGoal);
}

function mapGoal(r: any): GoalDefinition {
  return {
    id: r.id,
    title: r.title,
    kind: r.kind,
    unit: r.unit,
    weight: r.weight,
    status: r.status,
    templateId: r.template_id,
    sensitive: !!r.sensitive,
    followWithoutXp: !!r.follow_without_xp,
    createdAt: r.created_at,
  };
}

export async function insertGoal(
  db: Db,
  goal: GoalDefinition,
  version: GoalVersion,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO goal_definitions
     (id, title, kind, unit, weight, status, template_id, sensitive, follow_without_xp, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    goal.id,
    goal.title,
    goal.kind,
    goal.unit,
    goal.weight,
    goal.status,
    goal.templateId,
    goal.sensitive ? 1 : 0,
    goal.followWithoutXp ? 1 : 0,
    goal.createdAt,
  );
  await db.runAsync(
    `INSERT INTO goal_versions
     (id, goal_id, version, tier, target_value, schedule_kind, weekly_target_count, notes, effective_from, effective_to)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    version.id,
    version.goalId,
    version.version,
    version.tier,
    version.targetValue,
    version.scheduleKind,
    version.weeklyTargetCount,
    version.notes,
    version.effectiveFrom,
    version.effectiveTo,
  );
}

export async function setGoalStatus(
  db: Db,
  goalId: string,
  status: 'active' | 'paused' | 'archived',
): Promise<void> {
  await db.runAsync('UPDATE goal_definitions SET status = ? WHERE id = ?', status, goalId);
}

export async function getCurrentVersion(db: Conn, goalId: string): Promise<GoalVersion | null> {
  const r = await db.getFirstAsync<any>(
    `SELECT * FROM goal_versions WHERE goal_id = ? AND effective_to IS NULL ORDER BY version DESC LIMIT 1`,
    goalId,
  );
  if (!r) return null;
  return {
    id: r.id,
    goalId: r.goal_id,
    version: r.version,
    tier: r.tier,
    targetValue: r.target_value,
    scheduleKind: r.schedule_kind,
    weeklyTargetCount: r.weekly_target_count,
    notes: r.notes,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
  };
}

export async function upsertTracking(
  db: Conn,
  event: TrackingEvent,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO tracking_events (id, goal_id, local_date, status, value, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(goal_id, local_date) DO UPDATE SET
       status=excluded.status,
       value=excluded.value,
       note=excluded.note,
       updated_at=excluded.updated_at`,
    event.id,
    event.goalId,
    event.localDate,
    event.status,
    event.value,
    event.note,
    event.createdAt,
    event.updatedAt,
  );
}

export async function getTracking(
  db: Conn,
  goalId: string,
  localDate: string,
): Promise<TrackingEvent | null> {
  const r = await db.getFirstAsync<any>(
    'SELECT * FROM tracking_events WHERE goal_id = ? AND local_date = ?',
    goalId,
    localDate,
  );
  return r ? mapTrack(r) : null;
}

export async function listTrackingInRange(
  db: Db,
  goalId: string,
  from: string,
  to: string,
): Promise<TrackingEvent[]> {
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM tracking_events WHERE goal_id = ? AND local_date >= ? AND local_date <= ? ORDER BY local_date`,
    goalId,
    from,
    to,
  );
  return rows.map(mapTrack);
}

function mapTrack(r: any): TrackingEvent {
  return {
    id: r.id,
    goalId: r.goal_id,
    localDate: r.local_date,
    status: r.status as TrackingStatus,
    value: r.value,
    note: r.note,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
