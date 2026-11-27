import type { Db } from '../client';
import type { SqlRunner } from '../sqlRunner';

type Conn = Db | SqlRunner;

export type VapeMainStatus = 'active' | 'closed' | 'voided';

export interface VapeMainSession {
  id: string;
  status: VapeMainStatus;
  startedAt: string;
  endedAt: string | null;
  durationSec: number | null;
  endReason: 'vaped' | null;
  originalEndedAt: string | null;
  voidReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VapeMainClaim {
  id: string;
  kind: 'step' | 'record';
  sessionId: string;
  step: number;
  requestedGold: number;
  grantedGold: number;
  ledgerKey: string;
  claimedAt: string;
}

export interface VapeRewardLedgerRow {
  amount: number;
  reason: string;
  createdAt: string;
}

function mapSession(r: Record<string, unknown>): VapeMainSession {
  return {
    id: String(r.id),
    status: String(r.status) as VapeMainStatus,
    startedAt: String(r.started_at),
    endedAt: r.ended_at != null ? String(r.ended_at) : null,
    durationSec: r.duration_sec != null ? Number(r.duration_sec) : null,
    endReason: r.end_reason != null ? (String(r.end_reason) as 'vaped') : null,
    originalEndedAt: r.original_ended_at != null ? String(r.original_ended_at) : null,
    voidReason: r.void_reason != null ? String(r.void_reason) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export async function getActiveSession(db: Conn): Promise<VapeMainSession | null> {
  const r = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM vape_main_sessions WHERE status = 'active' LIMIT 1`,
  );
  return r ? mapSession(r) : null;
}

export async function getSessionById(db: Conn, id: string): Promise<VapeMainSession | null> {
  const r = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM vape_main_sessions WHERE id = ?`,
    id,
  );
  return r ? mapSession(r) : null;
}

/** Dernier intervalle clôturé par une déclaration (le plus récemment terminé). */
export async function getLastClosedSession(db: Conn): Promise<VapeMainSession | null> {
  const r = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM vape_main_sessions WHERE status = 'closed' ORDER BY ended_at DESC, created_at DESC LIMIT 1`,
  );
  return r ? mapSession(r) : null;
}

export async function listRecentSessions(db: Conn, limit: number): Promise<VapeMainSession[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM vape_main_sessions WHERE status != 'active' ORDER BY ended_at DESC, created_at DESC LIMIT ?`,
    limit,
  );
  return rows.map(mapSession);
}

export async function insertActiveSession(db: Conn, id: string, startedAt: string): Promise<void> {
  await db.runAsync(
    `INSERT INTO vape_main_sessions (id, status, started_at, created_at, updated_at)
     VALUES (?, 'active', ?, ?, ?)`,
    id,
    startedAt,
    startedAt,
    startedAt,
  );
}

export async function closeSession(
  db: Conn,
  id: string,
  endedAt: string,
  durationSec: number,
  updatedAt: string,
): Promise<boolean> {
  const r = await db.runAsync(
    `UPDATE vape_main_sessions
     SET status = 'closed', ended_at = ?, duration_sec = ?, end_reason = 'vaped', updated_at = ?
     WHERE id = ? AND status = 'active'`,
    endedAt,
    durationSec,
    updatedAt,
    id,
  );
  return r.changes === 1;
}

export async function reopenSession(db: Conn, id: string, updatedAt: string): Promise<boolean> {
  const r = await db.runAsync(
    `UPDATE vape_main_sessions
     SET status = 'active', ended_at = NULL, duration_sec = NULL, end_reason = NULL, updated_at = ?
     WHERE id = ? AND status = 'closed'`,
    updatedAt,
    id,
  );
  return r.changes === 1;
}

export async function amendSessionEnd(
  db: Conn,
  id: string,
  endedAt: string,
  durationSec: number,
  updatedAt: string,
): Promise<boolean> {
  const r = await db.runAsync(
    `UPDATE vape_main_sessions
     SET original_ended_at = COALESCE(original_ended_at, ended_at), ended_at = ?, duration_sec = ?, updated_at = ?
     WHERE id = ? AND status = 'closed'`,
    endedAt,
    durationSec,
    updatedAt,
    id,
  );
  return r.changes === 1;
}

export async function voidSession(
  db: Conn,
  id: string,
  reason: string,
  endedAtIfActive: string,
  updatedAt: string,
): Promise<boolean> {
  const r = await db.runAsync(
    `UPDATE vape_main_sessions
     SET status = 'voided', void_reason = ?, ended_at = COALESCE(ended_at, ?), updated_at = ?
     WHERE id = ? AND status IN ('active', 'closed')`,
    reason,
    endedAtIfActive,
    updatedAt,
    id,
  );
  return r.changes === 1;
}

/** Meilleure durée parmi les intervalles clôturés (non annulés), hors session donnée. */
export async function bestClosedDurationSec(db: Conn, excludeSessionId: string | null): Promise<number> {
  const r = await db.getFirstAsync<{ m: number | null }>(
    `SELECT MAX(duration_sec) AS m FROM vape_main_sessions
     WHERE status = 'closed' AND (? IS NULL OR id != ?)`,
    excludeSessionId,
    excludeSessionId,
  );
  return Number(r?.m ?? 0);
}

export async function listClaimedSteps(db: Conn, sessionId: string): Promise<Set<number>> {
  const rows = await db.getAllAsync<{ step: number }>(
    `SELECT step FROM vape_main_claims WHERE session_id = ? AND kind = 'step'`,
    sessionId,
  );
  return new Set(rows.map((r) => Number(r.step)));
}

export async function listClaimedRecordThresholds(db: Conn): Promise<Set<number>> {
  const rows = await db.getAllAsync<{ step: number }>(
    `SELECT step FROM vape_main_claims WHERE kind = 'record'`,
  );
  return new Set(rows.map((r) => Number(r.step)));
}

export async function insertClaim(db: Conn, claim: VapeMainClaim): Promise<void> {
  await db.runAsync(
    `INSERT INTO vape_main_claims
     (id, kind, session_id, step, requested_gold, granted_gold, ledger_key, claimed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    claim.id,
    claim.kind,
    claim.sessionId,
    claim.step,
    claim.requestedGold,
    claim.grantedGold,
    claim.ledgerKey,
    claim.claimedAt,
  );
}

export async function listClaims(db: Conn, sessionId: string): Promise<VapeMainClaim[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM vape_main_claims WHERE session_id = ? ORDER BY claimed_at, step`,
    sessionId,
  );
  return rows.map((r) => ({
    id: String(r.id),
    kind: String(r.kind) as 'step' | 'record',
    sessionId: String(r.session_id),
    step: Number(r.step),
    requestedGold: Number(r.requested_gold),
    grantedGold: Number(r.granted_gold),
    ledgerKey: String(r.ledger_key),
    claimedAt: String(r.claimed_at),
  }));
}

/** Dernières récompenses vape réellement créditées (lues dans le ledger d'or). */
export async function listRecentVapeRewards(db: Conn, limit: number): Promise<VapeRewardLedgerRow[]> {
  const rows = await db.getAllAsync<{ amount: number; reason: string; created_at: string }>(
    `SELECT amount, reason, created_at FROM wallet_ledger
     WHERE resource = 'gold' AND amount > 0
       AND (idempotency_key LIKE 'vape:%' OR idempotency_key LIKE 'adaptive:vape:%')
     ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    limit,
  );
  return rows.map((r) => ({ amount: Number(r.amount), reason: String(r.reason), createdAt: String(r.created_at) }));
}

export async function insertEvent(
  db: Conn,
  e: { id: string; kind: string; sessionId?: string | null; attemptId?: string | null; occurredAt: string; payload?: unknown },
): Promise<void> {
  await db.runAsync(
    `INSERT INTO vape_events (id, kind, session_id, attempt_id, occurred_at, payload_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    e.id,
    e.kind,
    e.sessionId ?? null,
    e.attemptId ?? null,
    e.occurredAt,
    e.payload !== undefined ? JSON.stringify(e.payload) : null,
  );
}

/** Une session no_vape en cours qui n'est pas un défi envie court (conflit de chronos). */
export async function hasLegacyVapeTimerRunning(db: Conn): Promise<boolean> {
  const r = await db.getFirstAsync<{ id: string }>(
    `SELECT cs.id AS id FROM challenge_sessions cs
     WHERE cs.type = 'no_vape' AND cs.state = 'running'
       AND NOT EXISTS (
         SELECT 1 FROM adaptive_challenge_attempts a
         WHERE a.challenge_session_id = cs.id AND a.outcome = 'running'
           AND a.format IN ('delay_craving', 'breathing')
       )
     LIMIT 1`,
  );
  return r != null;
}
