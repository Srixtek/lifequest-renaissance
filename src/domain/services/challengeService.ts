import type { Db } from '../../data/db/client';
import type { SqlRunner } from '../../data/db/sqlRunner';
import * as repo from '../../data/db/repositories/challengeSessionRepo';
import type { ChallengeSession, ChallengeState, ChallengeType } from '../models/challengeSession';
import { elapsedSecondsFromUtc } from '../rules/challengeDuration';
import { nowIso } from '../rules/dates';
import { createId } from '../../utils/id';

export type StartChallengeResult =
  | { ok: true; session: ChallengeSession }
  | { ok: false; code: 'already_running'; session: ChallengeSession };

export type CloseChallengeResult =
  | { ok: true; session: ChallengeSession }
  | { ok: false; code: 'not_running' | 'not_found' | 'sport_needs_confirm' | 'invalid_end_time' };

type Conn = Db | SqlRunner;

function buildRunning(
  type: ChallengeType,
  targetDurationSec: number | null,
  startedUtc: string,
): ChallengeSession {
  const now = nowIso();
  return {
    id: createId('chlg'),
    type,
    startedUtc,
    endedUtc: null,
    targetDurationSec,
    state: 'running',
    durationSec: 0,
    userConfirmed: false,
    userConfirmedDurationSec: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function displayElapsedSec(session: ChallengeSession, nowMs = Date.now()): number {
  return elapsedSecondsFromUtc(session.startedUtc, session.endedUtc, nowMs);
}

export async function startChallengeSessionOnConn(
  conn: Conn,
  type: ChallengeType,
  targetDurationSec: number | null,
): Promise<StartChallengeResult> {
  const existing = await repo.getRunningByType(conn, type);
  if (existing) {
    return { ok: false, code: 'already_running', session: existing };
  }
  const startedUtc = new Date().toISOString();
  const session = buildRunning(type, targetDurationSec, startedUtc);
  await repo.insertSession(conn, session);
  return { ok: true, session };
}

export async function startChallengeSession(
  db: Db,
  type: ChallengeType,
  targetDurationSec: number | null,
): Promise<StartChallengeResult> {
  let result: StartChallengeResult = { ok: false, code: 'already_running', session: {} as ChallengeSession };
  await db.withExclusiveTransactionAsync(async (tx) => {
    result = await startChallengeSessionOnConn(tx, type, targetDurationSec);
  });
  return result;
}

export async function closeChallengeSessionOnConn(
  conn: Conn,
  sessionId: string,
  state: Exclude<ChallengeState, 'running'>,
  opts?: {
    endedUtc?: string;
    userConfirmedDurationSec?: number | null;
    requireSportConfirm?: boolean;
  },
): Promise<CloseChallengeResult> {
  const current = await repo.getById(conn, sessionId);
  if (!current || current.state !== 'running') {
    return { ok: false, code: current ? 'not_running' : 'not_found' };
  }
  if (
    current.type === 'sport' &&
    opts?.requireSportConfirm !== false &&
    (opts?.userConfirmedDurationSec == null || opts.userConfirmedDurationSec < 0)
  ) {
    return { ok: false, code: 'sport_needs_confirm' };
  }
  const endedUtc = opts?.endedUtc ?? new Date().toISOString();
  const startMs = Date.parse(current.startedUtc);
  const endMs = Date.parse(endedUtc);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return { ok: false, code: 'invalid_end_time' };
  }
  const durationSec = elapsedSecondsFromUtc(current.startedUtc, endedUtc);
  const confirmedSec =
    current.type === 'sport' && opts?.userConfirmedDurationSec != null
      ? Math.max(0, Math.floor(opts.userConfirmedDurationSec))
      : null;
  const userConfirmed = current.type === 'sport' ? confirmedSec != null : state === 'completed';
  await repo.updateSessionClosed(conn, sessionId, {
    endedUtc,
    state,
    durationSec,
    userConfirmed,
    userConfirmedDurationSec: confirmedSec,
    updatedAt: endedUtc,
  });
  const updated = await repo.getById(conn, sessionId);
  if (!updated) {
    return { ok: false, code: 'not_found' };
  }
  return { ok: true, session: updated };
}

export async function closeChallengeSession(
  db: Db,
  sessionId: string,
  state: Exclude<ChallengeState, 'running'>,
  opts?: {
    endedUtc?: string;
    userConfirmedDurationSec?: number | null;
    requireSportConfirm?: boolean;
  },
): Promise<CloseChallengeResult> {
  let result: CloseChallengeResult = { ok: false, code: 'not_found' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    result = await closeChallengeSessionOnConn(tx, sessionId, state, opts);
  });
  return result;
}

export async function interruptVapeChallengeOnConn(
  conn: Conn,
  sessionId: string,
): Promise<CloseChallengeResult> {
  return closeChallengeSessionOnConn(conn, sessionId, 'interrupted', { requireSportConfirm: false });
}

export async function completeVapeChallengeOnConn(
  conn: Conn,
  sessionId: string,
): Promise<CloseChallengeResult> {
  return closeChallengeSessionOnConn(conn, sessionId, 'completed', { requireSportConfirm: false });
}

export async function interruptVapeChallenge(db: Db, sessionId: string): Promise<CloseChallengeResult> {
  return closeChallengeSession(db, sessionId, 'interrupted', { requireSportConfirm: false });
}

export async function completeVapeChallenge(db: Db, sessionId: string): Promise<CloseChallengeResult> {
  return closeChallengeSession(db, sessionId, 'completed', { requireSportConfirm: false });
}

export async function completeScreenChallenge(
  db: Db,
  sessionId: string,
  respected: boolean,
): Promise<CloseChallengeResult> {
  return closeChallengeSession(db, sessionId, respected ? 'completed' : 'interrupted', {
    requireSportConfirm: false,
  });
}

export async function completeSportChallenge(
  db: Db,
  sessionId: string,
  confirmedMinutes: number,
): Promise<CloseChallengeResult> {
  const sec = Math.max(0, Math.floor(confirmedMinutes * 60));
  return closeChallengeSession(db, sessionId, 'completed', {
    userConfirmedDurationSec: sec,
    requireSportConfirm: true,
  });
}

export async function getActiveChallenge(db: Conn, type: ChallengeType): Promise<ChallengeSession | null> {
  return repo.getRunningByType(db, type);
}

export async function listChallengeHistory(db: Conn, type: ChallengeType, limit = 5) {
  return repo.listRecent(db, type, limit);
}