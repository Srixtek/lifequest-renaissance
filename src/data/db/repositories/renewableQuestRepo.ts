import type { Db } from '../client';
import type { SqlRunner } from '../sqlRunner';

type Conn = Db | SqlRunner;

export type RenewableInstanceStatus = 'offered' | 'active' | 'ready' | 'claimed' | 'failed';

export interface RenewableQuestRow {
  id: string;
  templateId: string;
  category: string;
  status: RenewableInstanceStatus;
  acceptedAt: string | null;
  claimedAt: string | null;
  failedAt: string | null;
  challengeSessionId: string | null;
  progressJson: string | null;
  rewardGold: number;
  createdAt: string;
  updatedAt: string;
}

function mapRow(r: Record<string, unknown>): RenewableQuestRow {
  return {
    id: String(r.id),
    templateId: String(r.template_id),
    category: String(r.category),
    status: String(r.status) as RenewableInstanceStatus,
    acceptedAt: r.accepted_at != null ? String(r.accepted_at) : null,
    claimedAt: r.claimed_at != null ? String(r.claimed_at) : null,
    failedAt: r.failed_at != null ? String(r.failed_at) : null,
    challengeSessionId: r.challenge_session_id != null ? String(r.challenge_session_id) : null,
    progressJson: r.progress_json != null ? String(r.progress_json) : null,
    rewardGold: Number(r.reward_gold ?? 0),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export async function listInstances(db: Conn): Promise<RenewableQuestRow[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM renewable_quest_instances ORDER BY created_at`,
  );
  return rows.map(mapRow);
}

export async function getInstance(db: Conn, id: string): Promise<RenewableQuestRow | null> {
  const r = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM renewable_quest_instances WHERE id = ?',
    id,
  );
  return r ? mapRow(r) : null;
}

export async function countActive(db: Conn): Promise<number> {
  const r = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) AS c FROM renewable_quest_instances WHERE status IN ('active', 'ready')`,
  );
  return Number(r?.c ?? 0);
}

export async function insertOffered(
  db: Conn,
  id: string,
  templateId: string,
  category: string,
  rewardGold: number,
  now: string,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO renewable_quest_instances
     (id, template_id, category, status, accepted_at, claimed_at, failed_at, challenge_session_id, progress_json, reward_gold, created_at, updated_at)
     VALUES (?, ?, ?, 'offered', NULL, NULL, NULL, NULL, NULL, ?, ?, ?)`,
    id,
    templateId,
    category,
    rewardGold,
    now,
    now,
  );
}

export async function markActive(
  db: Conn,
  id: string,
  acceptedAt: string,
  progressJson: string | null,
  challengeSessionId: string | null,
): Promise<boolean> {
  const r = await db.runAsync(
    `UPDATE renewable_quest_instances
     SET status = 'active', accepted_at = ?, progress_json = ?, challenge_session_id = ?, updated_at = ?
     WHERE id = ? AND status IN ('offered', 'failed')`,
    acceptedAt,
    progressJson,
    challengeSessionId,
    acceptedAt,
    id,
  );
  return r.changes === 1;
}

export async function markReady(db: Conn, id: string, progressJson: string | null, at: string): Promise<boolean> {
  const r = await db.runAsync(
    `UPDATE renewable_quest_instances SET status = 'ready', progress_json = ?, updated_at = ? WHERE id = ? AND status = 'active'`,
    progressJson,
    at,
    id,
  );
  return r.changes === 1;
}

export async function markFailed(db: Conn, id: string, at: string): Promise<boolean> {
  const r = await db.runAsync(
    `UPDATE renewable_quest_instances SET status = 'failed', failed_at = ?, updated_at = ? WHERE id = ? AND status = 'active'`,
    at,
    at,
    id,
  );
  return r.changes === 1;
}

export async function markClaimed(db: Conn, id: string, claimedAt: string, progressJson: string): Promise<boolean> {
  const r = await db.runAsync(
    `UPDATE renewable_quest_instances SET status = 'claimed', claimed_at = ?, progress_json = ?, updated_at = ?
     WHERE id = ? AND status = 'ready'`,
    claimedAt,
    progressJson,
    claimedAt,
    id,
  );
  return r.changes === 1;
}

export async function updateProgress(
  db: Conn,
  id: string,
  progressJson: string,
  challengeSessionId: string | null,
  at: string,
): Promise<void> {
  await db.runAsync(
    `UPDATE renewable_quest_instances SET progress_json = ?, challenge_session_id = COALESCE(?, challenge_session_id), updated_at = ?
     WHERE id = ? AND status IN ('active', 'ready')`,
    progressJson,
    challengeSessionId,
    at,
    id,
  );
}

export async function insertHistory(
  db: Conn,
  id: string,
  instanceId: string,
  templateId: string,
  category: string,
  completedAt: string,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO renewable_quest_history (id, instance_id, template_id, category, completed_at) VALUES (?, ?, ?, ?, ?)`,
    id,
    instanceId,
    templateId,
    category,
    completedAt,
  );
}

export async function lastCompletedTemplateIds(db: Conn, category: string, limit = 3): Promise<string[]> {
  const rows = await db.getAllAsync<{ template_id: string }>(
    `SELECT template_id FROM renewable_quest_history WHERE category = ? ORDER BY completed_at DESC LIMIT ?`,
    category,
    limit,
  );
  return rows.map((r) => r.template_id);
}