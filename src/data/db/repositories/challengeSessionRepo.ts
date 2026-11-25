import type { Db } from '../client';
import type { SqlRunner } from '../sqlRunner';
import type {
  ChallengeSession,
  ChallengeState,
  ChallengeType,
} from '../../../domain/models/challengeSession';

type Conn = Db | SqlRunner;

function mapRow(r: Record<string, unknown>): ChallengeSession {
  return {
    id: String(r.id),
    type: r.type as ChallengeType,
    startedUtc: String(r.started_utc),
    endedUtc: r.ended_utc != null ? String(r.ended_utc) : null,
    targetDurationSec: r.target_duration_sec != null ? Number(r.target_duration_sec) : null,
    state: r.state as ChallengeState,
    durationSec: Number(r.duration_sec ?? 0),
    userConfirmed: !!r.user_confirmed,
    userConfirmedDurationSec:
      r.user_confirmed_duration_sec != null ? Number(r.user_confirmed_duration_sec) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export async function getRunningByType(db: Conn, type: ChallengeType): Promise<ChallengeSession | null> {
  const row = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM challenge_sessions WHERE type = ? AND state = 'running' LIMIT 1`,
    type,
  );
  return row ? mapRow(row) : null;
}

export async function getById(db: Conn, id: string): Promise<ChallengeSession | null> {
  const row = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM challenge_sessions WHERE id = ?`,
    id,
  );
  return row ? mapRow(row) : null;
}

export async function insertSession(
  db: Conn,
  session: ChallengeSession,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO challenge_sessions
     (id, type, started_utc, ended_utc, target_duration_sec, state, duration_sec,
      user_confirmed, user_confirmed_duration_sec, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    session.id,
    session.type,
    session.startedUtc,
    session.endedUtc,
    session.targetDurationSec,
    session.state,
    session.durationSec,
    session.userConfirmed ? 1 : 0,
    session.userConfirmedDurationSec,
    session.createdAt,
    session.updatedAt,
  );
}

export async function updateSessionClosed(
  db: Conn,
  id: string,
  patch: {
    endedUtc: string;
    state: ChallengeState;
    durationSec: number;
    userConfirmed: boolean;
    userConfirmedDurationSec: number | null;
    updatedAt: string;
  },
): Promise<void> {
  await db.runAsync(
    `UPDATE challenge_sessions
     SET ended_utc = ?, state = ?, duration_sec = ?, user_confirmed = ?,
         user_confirmed_duration_sec = ?, updated_at = ?
     WHERE id = ? AND state = 'running'`,
    patch.endedUtc,
    patch.state,
    patch.durationSec,
    patch.userConfirmed ? 1 : 0,
    patch.userConfirmedDurationSec,
    patch.updatedAt,
    id,
  );
}

export async function listRecent(
  db: Conn,
  type: ChallengeType,
  limit = 5,
): Promise<ChallengeSession[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM challenge_sessions
     WHERE type = ? AND state != 'running'
     ORDER BY COALESCE(ended_utc, updated_at) DESC
     LIMIT ?`,
    type,
    limit,
  );
  return rows.map(mapRow);
}