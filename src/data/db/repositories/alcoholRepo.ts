import type { Db } from '../client';
import type { SqlRunner } from '../sqlRunner';
import type { AlcoholDrinkType } from '../../../domain/rules/alcohol';

type Conn = Db | SqlRunner;

export interface AlcoholConsumption {
  id: string;
  clientRequestId: string | null;
  drinkType: AlcoholDrinkType;
  name: string | null;
  volumeMlX10: number;
  abvX10: number;
  quantityX100: number;
  alcoholMg: number;
  consumedAt: string;
  localDate: string;
  note: string | null;
  status: 'active' | 'cancelled';
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Nombre de corrections tracées (modifications). */
  corrections: number;
}

export interface AlcoholCorrection {
  id: string;
  consumptionId: string;
  kind: 'edit' | 'cancel';
  before: Record<string, unknown>;
  after: Record<string, unknown> | null;
  createdAt: string;
}

export interface AlcoholGoalRow {
  id: string;
  effectiveFrom: string;
  targetMg: number;
  source: 'manual' | 'suggestion';
  createdAt: string;
}

const SELECT_CONSUMPTION = `
  SELECT c.*, (SELECT COUNT(*) FROM alcohol_corrections k WHERE k.consumption_id = c.id AND k.kind = 'edit') AS corrections
  FROM alcohol_consumptions c`;

function mapConsumption(r: Record<string, unknown>): AlcoholConsumption {
  return {
    id: String(r.id),
    clientRequestId: r.client_request_id != null ? String(r.client_request_id) : null,
    drinkType: String(r.drink_type) as AlcoholDrinkType,
    name: r.name != null ? String(r.name) : null,
    volumeMlX10: Number(r.volume_ml_x10),
    abvX10: Number(r.abv_x10),
    quantityX100: Number(r.quantity_x100),
    alcoholMg: Number(r.alcohol_mg),
    consumedAt: String(r.consumed_at),
    localDate: String(r.local_date),
    note: r.note != null ? String(r.note) : null,
    status: String(r.status) as 'active' | 'cancelled',
    cancelledAt: r.cancelled_at != null ? String(r.cancelled_at) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    corrections: Number(r.corrections ?? 0),
  };
}

export async function getConsumption(db: Conn, id: string): Promise<AlcoholConsumption | null> {
  const r = await db.getFirstAsync<Record<string, unknown>>(`${SELECT_CONSUMPTION} WHERE c.id = ?`, id);
  return r ? mapConsumption(r) : null;
}

export async function getConsumptionByRequestId(db: Conn, requestId: string): Promise<AlcoholConsumption | null> {
  const r = await db.getFirstAsync<Record<string, unknown>>(
    `${SELECT_CONSUMPTION} WHERE c.client_request_id = ?`,
    requestId,
  );
  return r ? mapConsumption(r) : null;
}

export interface NewConsumptionRow {
  id: string;
  clientRequestId: string | null;
  drinkType: AlcoholDrinkType;
  name: string | null;
  volumeMlX10: number;
  abvX10: number;
  quantityX100: number;
  alcoholMg: number;
  consumedAt: string;
  localDate: string;
  note: string | null;
  createdAt: string;
}

export async function insertConsumption(db: Conn, c: NewConsumptionRow): Promise<void> {
  await db.runAsync(
    `INSERT INTO alcohol_consumptions
       (id, client_request_id, drink_type, name, volume_ml_x10, abv_x10, quantity_x100, alcohol_mg,
        consumed_at, local_date, note, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    c.id,
    c.clientRequestId,
    c.drinkType,
    c.name,
    c.volumeMlX10,
    c.abvX10,
    c.quantityX100,
    c.alcoholMg,
    c.consumedAt,
    c.localDate,
    c.note,
    c.createdAt,
    c.createdAt,
  );
}

export async function updateConsumption(
  db: Conn,
  id: string,
  c: Omit<NewConsumptionRow, 'id' | 'clientRequestId' | 'createdAt'>,
  updatedAt: string,
): Promise<boolean> {
  const r = await db.runAsync(
    `UPDATE alcohol_consumptions
     SET drink_type = ?, name = ?, volume_ml_x10 = ?, abv_x10 = ?, quantity_x100 = ?, alcohol_mg = ?,
         consumed_at = ?, local_date = ?, note = ?, updated_at = ?
     WHERE id = ? AND status = 'active'`,
    c.drinkType,
    c.name,
    c.volumeMlX10,
    c.abvX10,
    c.quantityX100,
    c.alcoholMg,
    c.consumedAt,
    c.localDate,
    c.note,
    updatedAt,
    id,
  );
  return r.changes === 1;
}

export async function cancelConsumption(db: Conn, id: string, at: string): Promise<boolean> {
  const r = await db.runAsync(
    `UPDATE alcohol_consumptions SET status = 'cancelled', cancelled_at = ?, updated_at = ?
     WHERE id = ? AND status = 'active'`,
    at,
    at,
    id,
  );
  return r.changes === 1;
}

export async function insertCorrection(
  db: Conn,
  k: { id: string; consumptionId: string; kind: 'edit' | 'cancel'; before: unknown; after: unknown | null; createdAt: string },
): Promise<void> {
  await db.runAsync(
    `INSERT INTO alcohol_corrections (id, consumption_id, kind, before_json, after_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    k.id,
    k.consumptionId,
    k.kind,
    JSON.stringify(k.before),
    k.after != null ? JSON.stringify(k.after) : null,
    k.createdAt,
  );
}

export async function listCorrections(db: Conn, consumptionId: string): Promise<AlcoholCorrection[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM alcohol_corrections WHERE consumption_id = ? ORDER BY created_at ASC, rowid ASC`,
    consumptionId,
  );
  return rows.map((r) => ({
    id: String(r.id),
    consumptionId: String(r.consumption_id),
    kind: String(r.kind) as 'edit' | 'cancel',
    before: JSON.parse(String(r.before_json)),
    after: r.after_json != null ? JSON.parse(String(r.after_json)) : null,
    createdAt: String(r.created_at),
  }));
}

export async function listConsumptionsForDate(
  db: Conn,
  localDate: string,
  includeCancelled = false,
): Promise<AlcoholConsumption[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `${SELECT_CONSUMPTION} WHERE c.local_date = ? ${includeCancelled ? '' : `AND c.status = 'active'`}
     ORDER BY c.consumed_at ASC, c.rowid ASC`,
    localDate,
  );
  return rows.map(mapConsumption);
}

export interface DayAggregate {
  localDate: string;
  totalMg: number;
  count: number;
}

/** Totaux par date logique, calculés depuis les milligrammes stockés des boissons actives. */
export async function aggregateByDate(db: Conn, startDate: string, endDate: string): Promise<DayAggregate[]> {
  const rows = await db.getAllAsync<{ local_date: string; total: number; n: number }>(
    `SELECT local_date, SUM(alcohol_mg) AS total, COUNT(*) AS n
     FROM alcohol_consumptions
     WHERE status = 'active' AND local_date >= ? AND local_date <= ?
     GROUP BY local_date ORDER BY local_date`,
    startDate,
    endDate,
  );
  return rows.map((r) => ({ localDate: r.local_date, totalMg: Number(r.total), count: Number(r.n) }));
}

export async function getLastActiveConsumedAt(db: Conn): Promise<string | null> {
  const r = await db.getFirstAsync<{ consumed_at: string }>(
    `SELECT consumed_at FROM alcohol_consumptions WHERE status = 'active' ORDER BY consumed_at DESC LIMIT 1`,
  );
  return r?.consumed_at ?? null;
}

export async function countActiveOnDate(db: Conn, localDate: string): Promise<number> {
  const r = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM alcohol_consumptions WHERE status = 'active' AND local_date = ?`,
    localDate,
  );
  return Number(r?.n ?? 0);
}

// Jours « aucune boisson » déclarés explicitement

export async function listActiveZeroDays(db: Conn, startDate: string, endDate: string): Promise<string[]> {
  const rows = await db.getAllAsync<{ local_date: string }>(
    `SELECT local_date FROM alcohol_zero_days
     WHERE revoked_at IS NULL AND local_date >= ? AND local_date <= ? ORDER BY local_date`,
    startDate,
    endDate,
  );
  return rows.map((r) => r.local_date);
}

export async function hasActiveZeroDay(db: Conn, localDate: string): Promise<boolean> {
  const r = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM alcohol_zero_days WHERE local_date = ? AND revoked_at IS NULL`,
    localDate,
  );
  return r != null;
}

export async function insertZeroDay(db: Conn, id: string, localDate: string, at: string): Promise<void> {
  await db.runAsync(
    `INSERT INTO alcohol_zero_days (id, local_date, declared_at) VALUES (?, ?, ?)`,
    id,
    localDate,
    at,
  );
}

export async function revokeZeroDay(db: Conn, localDate: string, at: string, reason: string): Promise<boolean> {
  const r = await db.runAsync(
    `UPDATE alcohol_zero_days SET revoked_at = ?, revoke_reason = ? WHERE local_date = ? AND revoked_at IS NULL`,
    at,
    reason,
    localDate,
  );
  return r.changes > 0;
}

// Départ explicitement confirmé (chrono sans consommation connue)

export async function getActiveStartMarker(db: Conn): Promise<string | null> {
  const r = await db.getFirstAsync<{ started_at: string }>(
    `SELECT started_at FROM alcohol_start_markers WHERE voided_at IS NULL ORDER BY created_at DESC, rowid DESC LIMIT 1`,
  );
  return r?.started_at ?? null;
}

export async function voidStartMarkers(db: Conn, at: string): Promise<void> {
  await db.runAsync(`UPDATE alcohol_start_markers SET voided_at = ? WHERE voided_at IS NULL`, at);
}

export async function insertStartMarker(db: Conn, id: string, startedAt: string, createdAt: string): Promise<void> {
  await db.runAsync(
    `INSERT INTO alcohol_start_markers (id, started_at, created_at) VALUES (?, ?, ?)`,
    id,
    startedAt,
    createdAt,
  );
}

// Objectifs hebdomadaires versionnés (append-only)

function mapGoal(r: Record<string, unknown>): AlcoholGoalRow {
  return {
    id: String(r.id),
    effectiveFrom: String(r.effective_from),
    targetMg: Number(r.target_mg),
    source: String(r.source) as 'manual' | 'suggestion',
    createdAt: String(r.created_at),
  };
}

/** Objectif en vigueur pour la semaine commençant à `weekStart` (dernière version dont l'effet est ≤ cette semaine). */
export async function getGoalForWeek(db: Conn, weekStart: string): Promise<AlcoholGoalRow | null> {
  const r = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM alcohol_weekly_goals WHERE effective_from <= ?
     ORDER BY effective_from DESC, created_at DESC, rowid DESC LIMIT 1`,
    weekStart,
  );
  return r ? mapGoal(r) : null;
}

export async function getLatestGoalChange(db: Conn): Promise<AlcoholGoalRow | null> {
  const r = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM alcohol_weekly_goals ORDER BY created_at DESC, rowid DESC LIMIT 1`,
  );
  return r ? mapGoal(r) : null;
}

export async function insertGoal(
  db: Conn,
  g: { id: string; effectiveFrom: string; targetMg: number; source: 'manual' | 'suggestion'; createdAt: string },
): Promise<void> {
  await db.runAsync(
    `INSERT INTO alcohol_weekly_goals (id, effective_from, target_mg, source, created_at) VALUES (?, ?, ?, ?, ?)`,
    g.id,
    g.effectiveFrom,
    g.targetMg,
    g.source,
    g.createdAt,
  );
}

export async function listGoalHistory(db: Conn): Promise<AlcoholGoalRow[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM alcohol_weekly_goals ORDER BY created_at ASC, rowid ASC`,
  );
  return rows.map(mapGoal);
}

// Événements (futures statistiques / page Bilan)

export async function insertEvent(
  db: Conn,
  e: { id: string; kind: string; consumptionId?: string | null; localDate?: string | null; occurredAt: string; payload?: unknown },
): Promise<void> {
  await db.runAsync(
    `INSERT INTO alcohol_events (id, kind, consumption_id, local_date, occurred_at, payload_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    e.id,
    e.kind,
    e.consumptionId ?? null,
    e.localDate ?? null,
    e.occurredAt,
    e.payload !== undefined ? JSON.stringify(e.payload) : null,
  );
}

export async function getLastEventAt(db: Conn, kind: string): Promise<string | null> {
  const r = await db.getFirstAsync<{ occurred_at: string }>(
    `SELECT occurred_at FROM alcohol_events WHERE kind = ? ORDER BY occurred_at DESC LIMIT 1`,
    kind,
  );
  return r?.occurred_at ?? null;
}
