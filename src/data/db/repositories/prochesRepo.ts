import type { SQLiteBindValue } from 'expo-sqlite';
import type { Db } from '../client';
import type { SqlRunner } from '../sqlRunner';
import type { ProchesRelation } from '../../../domain/rules/proches';

type Conn = Db | SqlRunner;

export interface ProchesContact {
  id: string;
  name: string;
  relation: ProchesRelation | null;
  note: string | null;
  status: 'active' | 'archived';
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProchesCall {
  id: string;
  clientRequestId: string | null;
  contactId: string;
  contactName: string;
  contactArchived: boolean;
  calledAt: string;
  localDate: string;
  note: string | null;
  status: 'active' | 'cancelled';
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  corrections: number;
}

export interface ProchesWeeklyGoalRow {
  id: string;
  effectiveFrom: string;
  targetCount: number;
  source: 'manual' | 'default';
  createdAt: string;
}

export interface ProchesCorrection {
  id: string;
  callId: string;
  kind: 'edit' | 'cancel';
  before: Record<string, unknown>;
  after: Record<string, unknown> | null;
  createdAt: string;
}

const SELECT_CALL = `
  SELECT c.*, ct.name AS contact_name, (ct.status = 'archived') AS contact_archived,
    (SELECT COUNT(*) FROM proches_corrections k WHERE k.call_id = c.id AND k.kind = 'edit') AS corrections
  FROM proches_calls c
  INNER JOIN proches_contacts ct ON ct.id = c.contact_id`;

function mapContact(r: Record<string, unknown>): ProchesContact {
  return {
    id: String(r.id),
    name: String(r.name),
    relation: r.relation != null ? (String(r.relation) as ProchesRelation) : null,
    note: r.note != null ? String(r.note) : null,
    status: String(r.status) as 'active' | 'archived',
    archivedAt: r.archived_at != null ? String(r.archived_at) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function mapCall(r: Record<string, unknown>): ProchesCall {
  return {
    id: String(r.id),
    clientRequestId: r.client_request_id != null ? String(r.client_request_id) : null,
    contactId: String(r.contact_id),
    contactName: String(r.contact_name),
    contactArchived: Number(r.contact_archived) === 1,
    calledAt: String(r.called_at),
    localDate: String(r.local_date),
    note: r.note != null ? String(r.note) : null,
    status: String(r.status) as 'active' | 'cancelled',
    cancelledAt: r.cancelled_at != null ? String(r.cancelled_at) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    corrections: Number(r.corrections ?? 0),
  };
}

export async function getContact(db: Conn, id: string): Promise<ProchesContact | null> {
  const r = await db.getFirstAsync<Record<string, unknown>>(`SELECT * FROM proches_contacts WHERE id = ?`, id);
  return r ? mapContact(r) : null;
}

export async function listContacts(db: Conn, includeArchived = false): Promise<ProchesContact[]> {
  const sql = includeArchived
    ? `SELECT * FROM proches_contacts ORDER BY status ASC, name COLLATE NOCASE ASC`
    : `SELECT * FROM proches_contacts WHERE status = 'active' ORDER BY name COLLATE NOCASE ASC`;
  const rows = await db.getAllAsync<Record<string, unknown>>(sql);
  return rows.map(mapContact);
}

export async function insertContact(
  db: Conn,
  row: {
    id: string;
    name: string;
    relation: ProchesRelation | null;
    note: string | null;
    createdAt: string;
  },
): Promise<void> {
  await db.runAsync(
    `INSERT INTO proches_contacts (id, name, relation, note, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)`,
    row.id,
    row.name,
    row.relation,
    row.note,
    row.createdAt,
    row.createdAt,
  );
}

export async function updateContactName(db: Conn, id: string, name: string, at: string): Promise<void> {
  await db.runAsync(`UPDATE proches_contacts SET name = ?, updated_at = ? WHERE id = ?`, name, at, id);
}

export async function archiveContact(db: Conn, id: string, at: string): Promise<void> {
  await db.runAsync(
    `UPDATE proches_contacts SET status = 'archived', archived_at = ?, updated_at = ? WHERE id = ? AND status = 'active'`,
    at,
    at,
    id,
  );
}

export async function getCall(db: Conn, id: string): Promise<ProchesCall | null> {
  const r = await db.getFirstAsync<Record<string, unknown>>(`${SELECT_CALL} WHERE c.id = ?`, id);
  return r ? mapCall(r) : null;
}

export async function getCallByRequestId(db: Conn, requestId: string): Promise<ProchesCall | null> {
  const r = await db.getFirstAsync<Record<string, unknown>>(`${SELECT_CALL} WHERE c.client_request_id = ?`, requestId);
  return r ? mapCall(r) : null;
}

export async function insertCall(
  db: Conn,
  row: {
    id: string;
    clientRequestId: string | null;
    contactId: string;
    calledAt: string;
    localDate: string;
    note: string | null;
    createdAt: string;
  },
): Promise<void> {
  await db.runAsync(
    `INSERT INTO proches_calls (id, client_request_id, contact_id, called_at, local_date, note, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    row.id,
    row.clientRequestId,
    row.contactId,
    row.calledAt,
    row.localDate,
    row.note,
    row.createdAt,
    row.createdAt,
  );
}

export async function updateCall(
  db: Conn,
  id: string,
  fields: { calledAt: string; localDate: string; note: string | null },
  at: string,
): Promise<void> {
  await db.runAsync(
    `UPDATE proches_calls SET called_at = ?, local_date = ?, note = ?, updated_at = ? WHERE id = ?`,
    fields.calledAt,
    fields.localDate,
    fields.note,
    at,
    id,
  );
}

export async function cancelCall(db: Conn, id: string, at: string): Promise<void> {
  await db.runAsync(
    `UPDATE proches_calls SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ? AND status = 'active'`,
    at,
    at,
    id,
  );
}

export async function listCallsForDay(db: Conn, localDate: string, includeCancelled = false): Promise<ProchesCall[]> {
  const sql = `${SELECT_CALL} WHERE c.local_date = ?${includeCancelled ? '' : ` AND c.status = 'active'`} ORDER BY c.called_at ASC`;
  const rows = await db.getAllAsync<Record<string, unknown>>(sql, localDate);
  return rows.map(mapCall);
}

export async function countActiveCallsBetween(db: Conn, start: string, end: string): Promise<number> {
  const r = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM proches_calls WHERE status = 'active' AND local_date >= ? AND local_date <= ?`,
    start,
    end,
  );
  return Number(r?.n ?? 0);
}

export async function countByDayBetween(db: Conn, start: string, end: string): Promise<Array<{ localDate: string; count: number }>> {
  const rows = await db.getAllAsync<{ local_date: string; n: number }>(
    `SELECT local_date, COUNT(*) AS n FROM proches_calls WHERE status = 'active' AND local_date >= ? AND local_date <= ?
     GROUP BY local_date ORDER BY local_date`,
    start,
    end,
  );
  return rows.map((r) => ({ localDate: String(r.local_date), count: Number(r.n) }));
}

export async function distinctContactsCalledBetween(db: Conn, start: string, end: string): Promise<number> {
  const r = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(DISTINCT contact_id) AS n FROM proches_calls WHERE status = 'active' AND local_date >= ? AND local_date <= ?`,
    start,
    end,
  );
  return Number(r?.n ?? 0);
}

export async function recentContactCalls(db: Conn, limit = 5): Promise<Array<{ contactId: string; name: string; lastCalledAt: string }>> {
  const rows = await db.getAllAsync<{ contact_id: string; name: string; last_at: string }>(
    `SELECT c.contact_id, ct.name, MAX(c.called_at) AS last_at
     FROM proches_calls c
     INNER JOIN proches_contacts ct ON ct.id = c.contact_id
     WHERE c.status = 'active'
     GROUP BY c.contact_id
     ORDER BY last_at DESC
     LIMIT ?`,
    limit,
  );
  return rows.map((r) => ({ contactId: String(r.contact_id), name: String(r.name), lastCalledAt: String(r.last_at) }));
}

export async function listRecentCalls(db: Conn, limit = 20): Promise<ProchesCall[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `${SELECT_CALL} WHERE c.status = 'active' ORDER BY c.called_at DESC LIMIT ?`,
    limit,
  );
  return rows.map(mapCall);
}

export async function getGoalForWeek(db: Conn, weekStart: string): Promise<ProchesWeeklyGoalRow | null> {
  const r = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM proches_weekly_goals WHERE effective_from <= ? ORDER BY effective_from DESC, created_at DESC, rowid DESC LIMIT 1`,
    weekStart,
  );
  if (!r) return null;
  return {
    id: String(r.id),
    effectiveFrom: String(r.effective_from),
    targetCount: Number(r.target_count),
    source: String(r.source) as 'manual' | 'default',
    createdAt: String(r.created_at),
  };
}

export async function getGoalEffectiveOn(db: Conn, weekStart: string): Promise<ProchesWeeklyGoalRow | null> {
  const r = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM proches_weekly_goals WHERE effective_from = ?
     ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    weekStart,
  );
  if (!r) return null;
  return {
    id: String(r.id),
    effectiveFrom: String(r.effective_from),
    targetCount: Number(r.target_count),
    source: String(r.source) as 'manual' | 'default',
    createdAt: String(r.created_at),
  };
}

export async function countWeeklyGoals(db: Conn): Promise<number> {
  const r = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM proches_weekly_goals`);
  return Number(r?.n ?? 0);
}

export async function insertWeeklyGoal(
  db: Conn,
  row: { id: string; effectiveFrom: string; targetCount: number; source: 'manual' | 'default'; createdAt: string },
): Promise<void> {
  await db.runAsync(
    `INSERT INTO proches_weekly_goals (id, effective_from, target_count, source, created_at) VALUES (?, ?, ?, ?, ?)`,
    row.id,
    row.effectiveFrom,
    row.targetCount,
    row.source,
    row.createdAt,
  );
}

export async function listWeeklyGoals(db: Conn): Promise<ProchesWeeklyGoalRow[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM proches_weekly_goals ORDER BY effective_from DESC, created_at DESC`,
  );
  return rows.map((r) => ({
    id: String(r.id),
    effectiveFrom: String(r.effective_from),
    targetCount: Number(r.target_count),
    source: String(r.source) as 'manual' | 'default',
    createdAt: String(r.created_at),
  }));
}

export async function insertCorrection(
  db: Conn,
  row: {
    id: string;
    callId: string;
    kind: 'edit' | 'cancel';
    before: Record<string, unknown>;
    after: Record<string, unknown> | null;
    createdAt: string;
  },
): Promise<void> {
  await db.runAsync(
    `INSERT INTO proches_corrections (id, call_id, kind, before_json, after_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    row.id,
    row.callId,
    row.kind,
    JSON.stringify(row.before),
    row.after ? JSON.stringify(row.after) : null,
    row.createdAt,
  );
}

export async function listCorrectionsForCall(db: Conn, callId: string): Promise<ProchesCorrection[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM proches_corrections WHERE call_id = ? ORDER BY created_at ASC`,
    callId,
  );
  return rows.map((r) => ({
    id: String(r.id),
    callId: String(r.call_id),
    kind: String(r.kind) as 'edit' | 'cancel',
    before: JSON.parse(String(r.before_json)) as Record<string, unknown>,
    after: r.after_json ? (JSON.parse(String(r.after_json)) as Record<string, unknown>) : null,
    createdAt: String(r.created_at),
  }));
}

export async function insertEvent(
  db: Conn,
  row: {
    id: string;
    kind: string;
    callId?: string | null;
    contactId?: string | null;
    localDate?: string | null;
    occurredAt: string;
    payload?: Record<string, unknown> | null;
  },
): Promise<void> {
  const args: SQLiteBindValue[] = [
    row.id,
    row.kind,
    row.callId ?? null,
    row.contactId ?? null,
    row.localDate ?? null,
    row.occurredAt,
    row.payload ? JSON.stringify(row.payload) : null,
  ];
  await db.runAsync(
    `INSERT INTO proches_events (id, kind, call_id, contact_id, local_date, occurred_at, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ...args,
  );
}