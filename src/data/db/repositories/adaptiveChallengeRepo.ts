import type { Db } from '../client';
import type { SqlRunner } from '../sqlRunner';
import type {
  AdaptiveChallengeAttempt,
  AdaptiveChallengeRecord,
  AdaptiveChallengeState,
  AdaptiveAttemptOutcome,
  AdaptiveHabitCategory,
  VapeChallengeFormat,
} from '../../../domain/models/adaptiveChallenge';

type Conn = Db | SqlRunner;

function mapState(r: Record<string, unknown>): AdaptiveChallengeState {
  return {
    habitCategory: r.habit_category as AdaptiveHabitCategory,
    tierIndex: Number(r.tier_index),
    tierManual: !!r.tier_manual,
    updatedAt: String(r.updated_at),
  };
}

function mapAttempt(r: Record<string, unknown>): AdaptiveChallengeAttempt {
  return {
    id: String(r.id),
    habitCategory: r.habit_category as AdaptiveHabitCategory,
    format: r.format as VapeChallengeFormat,
    tierIndex: Number(r.tier_index),
    outcome: r.outcome as AdaptiveAttemptOutcome,
    challengeSessionId: r.challenge_session_id != null ? String(r.challenge_session_id) : null,
    targetDurationSec: r.target_duration_sec != null ? Number(r.target_duration_sec) : null,
    declaredDurationSec: r.declared_duration_sec != null ? Number(r.declared_duration_sec) : null,
    startedAt: String(r.started_at),
    endedAt: r.ended_at != null ? String(r.ended_at) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function mapRecord(r: Record<string, unknown>): AdaptiveChallengeRecord {
  return {
    habitCategory: r.habit_category as AdaptiveHabitCategory,
    format: r.format as VapeChallengeFormat,
    bestDurationSec: Number(r.best_duration_sec),
    attemptId: r.attempt_id != null ? String(r.attempt_id) : null,
    achievedAt: String(r.achieved_at),
  };
}

export async function getOrInitState(db: Conn, category: AdaptiveHabitCategory): Promise<AdaptiveChallengeState> {
  const row = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM adaptive_challenge_state WHERE habit_category = ?`,
    category,
  );
  if (row) return mapState(row);
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO adaptive_challenge_state (habit_category, tier_index, tier_manual, updated_at)
     VALUES (?, 0, 0, ?)`,
    category,
    now,
  );
  return { habitCategory: category, tierIndex: 0, tierManual: false, updatedAt: now };
}

export async function updateStateTier(
  db: Conn,
  category: AdaptiveHabitCategory,
  tierIndex: number,
  tierManual: boolean,
  updatedAt: string,
): Promise<void> {
  await db.runAsync(
    `UPDATE adaptive_challenge_state SET tier_index = ?, tier_manual = ?, updated_at = ? WHERE habit_category = ?`,
    tierIndex,
    tierManual ? 1 : 0,
    updatedAt,
    category,
  );
}

export async function getRunningAttempt(
  db: Conn,
  category: AdaptiveHabitCategory,
): Promise<AdaptiveChallengeAttempt | null> {
  const row = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM adaptive_challenge_attempts WHERE habit_category = ? AND outcome = 'running' LIMIT 1`,
    category,
  );
  return row ? mapAttempt(row) : null;
}

export async function getAttemptById(db: Conn, id: string): Promise<AdaptiveChallengeAttempt | null> {
  const row = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM adaptive_challenge_attempts WHERE id = ?`,
    id,
  );
  return row ? mapAttempt(row) : null;
}

export async function insertAttempt(db: Conn, attempt: AdaptiveChallengeAttempt): Promise<void> {
  await db.runAsync(
    `INSERT INTO adaptive_challenge_attempts
     (id, habit_category, format, tier_index, outcome, challenge_session_id, target_duration_sec,
      declared_duration_sec, started_at, ended_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    attempt.id,
    attempt.habitCategory,
    attempt.format,
    attempt.tierIndex,
    attempt.outcome,
    attempt.challengeSessionId,
    attempt.targetDurationSec,
    attempt.declaredDurationSec,
    attempt.startedAt,
    attempt.endedAt,
    attempt.createdAt,
    attempt.updatedAt,
  );
}

export async function closeAttempt(
  db: Conn,
  id: string,
  patch: {
    outcome: Exclude<AdaptiveAttemptOutcome, 'running'>;
    declaredDurationSec: number | null;
    endedAt: string;
    updatedAt: string;
  },
): Promise<boolean> {
  const r = await db.runAsync(
    `UPDATE adaptive_challenge_attempts
     SET outcome = ?, declared_duration_sec = ?, ended_at = ?, updated_at = ?
     WHERE id = ? AND outcome = 'running'`,
    patch.outcome,
    patch.declaredDurationSec,
    patch.endedAt,
    patch.updatedAt,
    id,
  );
  return Number(r.changes) > 0;
}

export async function listRecentAttempts(
  db: Conn,
  category: AdaptiveHabitCategory,
  limit = 20,
): Promise<AdaptiveChallengeAttempt[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM adaptive_challenge_attempts
     WHERE habit_category = ? AND outcome != 'running'
     ORDER BY COALESCE(ended_at, updated_at) DESC
     LIMIT ?`,
    category,
    limit,
  );
  return rows.map(mapAttempt);
}

export async function listInformedOutcomes(db: Conn, category: AdaptiveHabitCategory, limit = 12): Promise<
  Array<'success' | 'failure' | 'unknown'>
> {
  const rows = await db.getAllAsync<{ outcome: string }>(
    `SELECT outcome FROM adaptive_challenge_attempts
     WHERE habit_category = ? AND outcome IN ('success', 'failure', 'unknown')
     ORDER BY COALESCE(ended_at, updated_at) DESC
     LIMIT ?`,
    category,
    limit,
  );
  return rows.map((r) => r.outcome as 'success' | 'failure' | 'unknown');
}

export async function getRecord(
  db: Conn,
  category: AdaptiveHabitCategory,
  format: VapeChallengeFormat,
): Promise<AdaptiveChallengeRecord | null> {
  const row = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM adaptive_challenge_records WHERE habit_category = ? AND format = ?`,
    category,
    format,
  );
  return row ? mapRecord(row) : null;
}

export async function upsertRecordIfBetter(
  db: Conn,
  record: AdaptiveChallengeRecord,
): Promise<'updated' | 'kept'> {
  const existing = await getRecord(db, record.habitCategory, record.format);
  if (existing && existing.bestDurationSec >= record.bestDurationSec) return 'kept';
  const now = record.achievedAt;
  if (existing) {
    await db.runAsync(
      `UPDATE adaptive_challenge_records
       SET best_duration_sec = ?, attempt_id = ?, achieved_at = ?
       WHERE habit_category = ? AND format = ?`,
      record.bestDurationSec,
      record.attemptId,
      now,
      record.habitCategory,
      record.format,
    );
  } else {
    await db.runAsync(
      `INSERT INTO adaptive_challenge_records (habit_category, format, best_duration_sec, attempt_id, achieved_at)
       VALUES (?, ?, ?, ?, ?)`,
      record.habitCategory,
      record.format,
      record.bestDurationSec,
      record.attemptId,
      now,
    );
  }
  return 'updated';
}