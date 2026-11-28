import type { SqlRunner } from '../sqlRunner';

export interface DiversDaySlotsRow {
  localDate: string;
  slot0ActivityId: string;
  slot1ActivityId: string;
  slot0Passed: boolean;
  slot1Passed: boolean;
  replacementsUsed: number;
  createdAt: string;
  updatedAt: string;
}

export interface DiversCompletionRow {
  id: string;
  clientRequestId: string | null;
  activityId: string;
  confirmedAt: string;
  localDate: string;
  status: 'active' | 'cancelled';
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapSlots(r: Record<string, unknown>): DiversDaySlotsRow {
  return {
    localDate: String(r.local_date),
    slot0ActivityId: String(r.slot0_activity_id),
    slot1ActivityId: String(r.slot1_activity_id),
    slot0Passed: Number(r.slot0_passed ?? 0) === 1,
    slot1Passed: Number(r.slot1_passed ?? 0) === 1,
    replacementsUsed: Number(r.replacements_used),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function mapCompletion(r: Record<string, unknown>): DiversCompletionRow {
  return {
    id: String(r.id),
    clientRequestId: r.client_request_id != null ? String(r.client_request_id) : null,
    activityId: String(r.activity_id),
    confirmedAt: String(r.confirmed_at),
    localDate: String(r.local_date),
    status: String(r.status) as 'active' | 'cancelled',
    cancelledAt: r.cancelled_at != null ? String(r.cancelled_at) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export async function getDaySlots(db: SqlRunner, localDate: string): Promise<DiversDaySlotsRow | null> {
  const r = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM divers_day_slots WHERE local_date = ?`,
    localDate,
  );
  return r ? mapSlots(r) : null;
}

export async function upsertDaySlots(
  db: SqlRunner,
  row: {
    localDate: string;
    slot0ActivityId: string;
    slot1ActivityId: string;
    slot0Passed?: boolean;
    slot1Passed?: boolean;
    replacementsUsed: number;
    createdAt: string;
    updatedAt: string;
  },
): Promise<void> {
  await db.runAsync(
    `INSERT INTO divers_day_slots (local_date, slot0_activity_id, slot1_activity_id, slot0_passed, slot1_passed, replacements_used, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(local_date) DO UPDATE SET
       slot0_activity_id = excluded.slot0_activity_id,
       slot1_activity_id = excluded.slot1_activity_id,
       slot0_passed = excluded.slot0_passed,
       slot1_passed = excluded.slot1_passed,
       replacements_used = excluded.replacements_used,
       updated_at = excluded.updated_at`,
    row.localDate,
    row.slot0ActivityId,
    row.slot1ActivityId,
    row.slot0Passed ? 1 : 0,
    row.slot1Passed ? 1 : 0,
    row.replacementsUsed,
    row.createdAt,
    row.updatedAt,
  );
}

export async function getCompletionByRequestId(db: SqlRunner, clientRequestId: string): Promise<DiversCompletionRow | null> {
  const r = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM divers_completions WHERE client_request_id = ?`,
    clientRequestId,
  );
  return r ? mapCompletion(r) : null;
}

export async function getCompletion(db: SqlRunner, id: string): Promise<DiversCompletionRow | null> {
  const r = await db.getFirstAsync<Record<string, unknown>>(`SELECT * FROM divers_completions WHERE id = ?`, id);
  return r ? mapCompletion(r) : null;
}

export async function insertCompletion(
  db: SqlRunner,
  row: {
    id: string;
    clientRequestId: string | null;
    activityId: string;
    confirmedAt: string;
    localDate: string;
    createdAt: string;
    updatedAt: string;
  },
): Promise<void> {
  await db.runAsync(
    `INSERT INTO divers_completions (id, client_request_id, activity_id, confirmed_at, local_date, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
    row.id,
    row.clientRequestId,
    row.activityId,
    row.confirmedAt,
    row.localDate,
    row.createdAt,
    row.updatedAt,
  );
}

export async function cancelCompletion(db: SqlRunner, id: string, cancelledAt: string, updatedAt: string): Promise<void> {
  await db.runAsync(
    `UPDATE divers_completions SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ?`,
    cancelledAt,
    updatedAt,
    id,
  );
}

export async function listRecentCompletions(db: SqlRunner, limit: number, includeCancelled = false): Promise<DiversCompletionRow[]> {
  const status = includeCancelled ? '' : ` AND status = 'active'`;
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM divers_completions WHERE 1=1${status} ORDER BY confirmed_at DESC LIMIT ?`,
    limit,
  );
  return rows.map(mapCompletion);
}

export async function listCompletionsForDay(
  db: SqlRunner,
  localDate: string,
  includeCancelled = false,
): Promise<DiversCompletionRow[]> {
  const status = includeCancelled ? '' : ` AND status = 'active'`;
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM divers_completions WHERE local_date = ?${status} ORDER BY confirmed_at ASC`,
    localDate,
  );
  return rows.map(mapCompletion);
}

export async function insertEvent(
  db: SqlRunner,
  ev: {
    id: string;
    kind: string;
    activityId?: string | null;
    slotIndex?: number | null;
    localDate?: string | null;
    completionId?: string | null;
    occurredAt: string;
    payloadJson?: string | null;
  },
): Promise<void> {
  await db.runAsync(
    `INSERT INTO divers_events (id, kind, activity_id, slot_index, local_date, completion_id, occurred_at, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ev.id,
    ev.kind,
    ev.activityId ?? null,
    ev.slotIndex ?? null,
    ev.localDate ?? null,
    ev.completionId ?? null,
    ev.occurredAt,
    ev.payloadJson ?? null,
  );
}

export async function listActivityIdsBetween(db: SqlRunner, start: string, end: string, kinds?: string[]): Promise<string[]> {
  let sql = `SELECT DISTINCT activity_id FROM divers_events WHERE activity_id IS NOT NULL AND local_date >= ? AND local_date <= ?`;
  const args: (string | number)[] = [start, end];
  if (kinds?.length) {
    sql += ` AND kind IN (${kinds.map(() => '?').join(', ')})`;
    args.push(...kinds);
  }
  const rows = await db.getAllAsync<{ activity_id: string }>(sql, ...args);
  return rows.map((r) => String(r.activity_id));
}

export async function getDaySlotsBefore(db: SqlRunner, localDate: string): Promise<DiversDaySlotsRow | null> {
  const r = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM divers_day_slots WHERE local_date < ? ORDER BY local_date DESC LIMIT 1`,
    localDate,
  );
  return r ? mapSlots(r) : null;
}

export async function findActiveCompletionForActivity(
  db: SqlRunner,
  localDate: string,
  activityId: string,
): Promise<DiversCompletionRow | null> {
  const r = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM divers_completions WHERE local_date = ? AND activity_id = ? AND status = 'active'
     ORDER BY confirmed_at ASC, rowid ASC LIMIT 1`,
    localDate,
    activityId,
  );
  return r ? mapCompletion(r) : null;
}

/** Première confirmation (tous statuts) d'une activité pour un jour : seule candidate à une récompense. */
export async function getFirstCompletionForActivity(
  db: SqlRunner,
  localDate: string,
  activityId: string,
): Promise<DiversCompletionRow | null> {
  const r = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM divers_completions WHERE local_date = ? AND activity_id = ?
     ORDER BY confirmed_at ASC, rowid ASC LIMIT 1`,
    localDate,
    activityId,
  );
  return r ? mapCompletion(r) : null;
}
