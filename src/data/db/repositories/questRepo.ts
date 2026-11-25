import type { Db } from '../client';
import type { SqlRunner } from '../sqlRunner';

type Conn = Db | SqlRunner;

export type QuestRowStatus = 'accepted' | 'claimed' | 'abandoned';

export interface QuestRow {
  id: string;
  questId: string;
  status: QuestRowStatus | string;
  acceptedAt: string | null;
  claimedAt: string | null;
  abandonedAt: string | null;
}

function mapRow(r: Record<string, unknown>): QuestRow {
  return {
    id: String(r.id),
    questId: String(r.quest_id),
    status: String(r.status),
    acceptedAt: r.accepted_at != null ? String(r.accepted_at) : null,
    claimedAt: r.claimed_at != null ? String(r.claimed_at) : null,
    abandonedAt: r.abandoned_at != null ? String(r.abandoned_at) : null,
  };
}

export async function listRows(db: Conn): Promise<QuestRow[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>('SELECT * FROM quest_instances');
  return rows.map(mapRow);
}

export async function getRow(db: Conn, questId: string): Promise<QuestRow | null> {
  const r = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM quest_instances WHERE quest_id = ?',
    questId,
  );
  return r ? mapRow(r) : null;
}

export async function countAccepted(db: Conn): Promise<number> {
  const r = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) AS c FROM quest_instances WHERE status = 'accepted'`,
  );
  return Number(r?.c ?? 0);
}

export async function insertAccepted(db: Conn, id: string, questId: string, acceptedAt: string): Promise<void> {
  await db.runAsync(
    `INSERT INTO quest_instances (id, quest_id, status, progress_json, completed_at, accepted_at, claimed_at, abandoned_at)
     VALUES (?, ?, 'accepted', NULL, NULL, ?, NULL, NULL)`,
    id,
    questId,
    acceptedAt,
  );
}

/** Ré-acceptation après abandon : la fenêtre de preuve repart de zéro (règle non rétroactive). */
export async function reacceptAbandoned(db: Conn, questId: string, acceptedAt: string): Promise<boolean> {
  const r = await db.runAsync(
    `UPDATE quest_instances
     SET status = 'accepted', accepted_at = ?, abandoned_at = NULL
     WHERE quest_id = ? AND status = 'abandoned'`,
    acceptedAt,
    questId,
  );
  return r.changes === 1;
}

export async function markAbandoned(db: Conn, questId: string, abandonedAt: string): Promise<boolean> {
  const r = await db.runAsync(
    `UPDATE quest_instances SET status = 'abandoned', abandoned_at = ?
     WHERE quest_id = ? AND status = 'accepted'`,
    abandonedAt,
    questId,
  );
  return r.changes === 1;
}

export async function markClaimed(
  db: Conn,
  questId: string,
  claimedAt: string,
  progressJson: string,
): Promise<boolean> {
  const r = await db.runAsync(
    `UPDATE quest_instances
     SET status = 'claimed', claimed_at = ?, completed_at = ?, progress_json = ?
     WHERE quest_id = ? AND status = 'accepted'`,
    claimedAt,
    claimedAt,
    progressJson,
    questId,
  );
  return r.changes === 1;
}
