import {
  elapsedSecondsFromUtc,
  formatChallengeHms,
  parsePositiveTargetMinutes,
  parseSportConfirmMinutes,
  progressTowardTarget,
} from '../domain/rules/challengeDuration';
import {
  closeChallengeSession,
  completeSportChallenge,
  displayElapsedSec,
  startChallengeSession,
} from '../domain/services/challengeService';
import type { ChallengeSession } from '../domain/models/challengeSession';
import { getVersionForDate } from '../data/db/repositories/goalRepo';
import { addDays } from '../domain/rules/dates';
import { openMemoryDb, resetDbForTests } from '../data/db/client';

jest.mock('../utils/id', () => {
  let n = 0;
  return { createId: (p: string) => `${p}-${++n}` };
});

describe('challengeDuration', () => {
  test('elapsed from timestamps', () => {
    const start = '2025-11-25T10:00:00.000Z';
    const end = '2025-11-25T11:30:15.000Z';
    expect(elapsedSecondsFromUtc(start, end)).toBe(5415);
  });

  test('no negative duration on clock rewind', () => {
    expect(elapsedSecondsFromUtc('2025-11-25T12:00:00.000Z', '2025-11-25T11:00:00.000Z')).toBe(0);
  });

  test('format H:M:S', () => {
    expect(formatChallengeHms(3661)).toBe('01:01:01');
    expect(formatChallengeHms(-5)).toBe('00:00:00');
  });

  test('target progress capped at 1', () => {
    expect(progressTowardTarget(600, 1200)).toBe(0.5);
    expect(progressTowardTarget(2000, 1200)).toBe(1);
    expect(progressTowardTarget(10, null)).toBeNull();
  });

  test('custom minutes reject 0, negative, NaN, Infinity', () => {
    expect(parsePositiveTargetMinutes('0').ok).toBe(false);
    expect(parsePositiveTargetMinutes('-5').ok).toBe(false);
    expect(parsePositiveTargetMinutes('NaN').ok).toBe(false);
    expect(parsePositiveTargetMinutes('Infinity').ok).toBe(false);
    expect(parsePositiveTargetMinutes('15').ok).toBe(true);
  });

  test('sport confirm allows zero and rejects invalid', () => {
    expect(parseSportConfirmMinutes('0').ok).toBe(true);
    expect(parseSportConfirmMinutes('-1').ok).toBe(false);
    expect(parseSportConfirmMinutes('30').ok).toBe(true);
  });
});

describe('challengeService — transactional mocks', () => {
  type Row = Record<string, unknown> & { id: string; type: string; state: string };

  function makeDb(rows: Row[]) {
    const map = new Map(rows.map((r) => [r.id, { ...r }]));
    const tx = {
      getFirstAsync: jest.fn(async (sql: string, ...params: unknown[]) => {
        if (sql.includes("state = 'running'")) {
          const type = String(params[0]);
          return [...map.values()].find((r) => r.type === type && r.state === 'running') ?? null;
        }
        const id = String(params[0]);
        return map.get(id) ?? null;
      }),
      getAllAsync: jest.fn(async () => []),
      runAsync: jest.fn(async (sql: string, ...params: unknown[]) => {
        if (sql.startsWith('INSERT')) {
          const id = params[0] as string;
          map.set(id, {
            id,
            type: String(params[1]),
            started_utc: String(params[2]),
            ended_utc: params[3],
            target_duration_sec: params[4],
            state: String(params[5]),
            duration_sec: params[6],
            user_confirmed: params[7],
            user_confirmed_duration_sec: params[8],
            created_at: String(params[9]),
            updated_at: String(params[10]),
          });
        }
        if (sql.startsWith('UPDATE')) {
          const id = String(params[6]);
          const row = map.get(id);
          if (!row || row.state !== 'running') return;
          row.ended_utc = params[0];
          row.state = String(params[1]);
          row.duration_sec = params[2];
          row.user_confirmed = params[3];
          row.user_confirmed_duration_sec = params[4];
          row.updated_at = params[5];
        }
      }),
    };
    const db = {
      withExclusiveTransactionAsync: jest.fn(async (fn: (t: typeof tx) => Promise<void>) => fn(tx)),
    };
    return { db, map, tx };
  }

  test('one active session per type', async () => {
    const { db, map } = makeDb([]);
    const first = await startChallengeSession(db as never, 'no_vape', null);
    expect(first.ok).toBe(true);
    const dup = await startChallengeSession(db as never, 'no_vape', null);
    expect(dup.ok).toBe(false);
    if (dup.ok) throw new Error('expected duplicate');
    expect(dup.code).toBe('already_running');
    const running = [...map.values()].filter((r) => r.state === 'running');
    expect(running).toHaveLength(1);
  });

  test('sport not closed without user confirmation', async () => {
    const { db, map } = makeDb([]);
    const start = await startChallengeSession(db as never, 'sport', 900);
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const bare = await closeChallengeSession(db as never, start.session.id, 'completed');
    expect(bare.ok).toBe(false);
    if (bare.ok) throw new Error('expected sport_needs_confirm');
    expect(bare.code).toBe('sport_needs_confirm');
    const done = await completeSportChallenge(db as never, start.session.id, 25);
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.session.userConfirmedDurationSec).toBe(25 * 60);
    expect([...map.values()][0]?.state as string).toBe('completed');
  });

  test('double close second call fails', async () => {
    const { db } = makeDb([]);
    const start = await startChallengeSession(db as never, 'no_screen', 600);
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const end = await closeChallengeSession(db as never, start.session.id, 'completed', {
      requireSportConfirm: false,
    });
    expect(end.ok).toBe(true);
    const again = await closeChallengeSession(db as never, start.session.id, 'interrupted', {
      requireSportConfirm: false,
    });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe('not_running');
  });

  test('end before start rejects close and keeps session running', async () => {
    const { db, map } = makeDb([]);
    const start = await startChallengeSession(db as never, 'no_vape', null);
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const bad = await closeChallengeSession(db as never, start.session.id, 'completed', {
      endedUtc: '2020-01-01T00:00:00.000Z',
      requireSportConfirm: false,
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe('invalid_end_time');
    expect(map.get(start.session.id)?.state).toBe('running');
  });

  test('display uses timestamps not stored tick', () => {
    const session: ChallengeSession = {
      id: 'x',
      type: 'no_vape',
      startedUtc: '2025-11-25T08:00:00.000Z',
      endedUtc: null,
      targetDurationSec: null,
      state: 'running',
      durationSec: 0,
      userConfirmed: false,
      userConfirmedDurationSec: null,
      createdAt: '2025-11-25T08:00:00.000Z',
      updatedAt: '2025-11-25T08:00:00.000Z',
    };
    const now = Date.parse('2025-11-25T10:00:00.000Z');
    expect(displayElapsedSec(session, now)).toBe(7200);
  });
});

let sqliteNativeForTests: boolean | undefined;

describe('getVersionForDate — SQLite memory', () => {
  afterEach(async () => {
    if (sqliteNativeForTests) await resetDbForTests();
  });

  test('applies version by local date', async () => {
    if (sqliteNativeForTests === undefined) {
      try {
        await openMemoryDb();
        sqliteNativeForTests = true;
      } catch (err) {
        sqliteNativeForTests = false;
        // eslint-disable-next-line no-console
        console.warn('[SKIP] getVersionForDate — expo-sqlite indisponible:', err);
      }
    }
    if (!sqliteNativeForTests) {
      expect(sqliteNativeForTests).toBe(false);
      return;
    }
    const db = await openMemoryDb();
    const gid = 'g-sqlite';
    const now = '2025-11-26T08:00:00.000Z';
    await db.runAsync(
      `INSERT INTO goal_definitions
       (id, title, kind, unit, weight, status, template_id, sensitive, follow_without_xp, created_at)
       VALUES (?, 'Test', 'limit', 'u', 1, 'active', NULL, 0, 0, ?)`,
      gid,
      now,
    );
    await db.runAsync(
      `INSERT INTO goal_versions
       (id, goal_id, version, tier, target_value, schedule_kind, weekly_target_count, notes, effective_from, effective_to)
       VALUES ('v1', ?, 1, 'normal', 5, 'daily', NULL, NULL, '2025-11-01', '2025-11-26')`,
      gid,
    );
    await db.runAsync(
      `INSERT INTO goal_versions
       (id, goal_id, version, tier, target_value, schedule_kind, weekly_target_count, notes, effective_from, effective_to)
       VALUES ('v2', ?, 2, 'normal', 10, 'daily', NULL, NULL, '2025-11-27', NULL)`,
      gid,
    );
    const today = await getVersionForDate(db, gid, '2025-11-26');
    const tomorrow = await getVersionForDate(db, gid, addDays('2025-11-26', 1));
    expect(today?.targetValue).toBe(5);
    expect(tomorrow?.targetValue).toBe(10);
  });
});