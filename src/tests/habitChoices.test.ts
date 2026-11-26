import {
  DEFAULT_WEEKLY_CALL_TARGET,
  intentionRequiresNumericTarget,
  intentionRequiresWeeklyCount,
  resolveHabitPlan,
  MAX_WEEKLY_CALLS,
  MIN_WEEKLY_CALLS,
} from '../domain/content/habitIntentions';
import {
  countWeeklySuccessDays,
  formatWeeklyProgress,
  weekBoundsMondaySunday,
} from '../domain/rules/weeklyTracking';
import { getVersionForDate } from '../data/db/repositories/goalRepo';
import { addDays } from '../domain/rules/dates';

describe('resolveHabitPlan — vape x3', () => {
  test('reduce uses limit with XP', () => {
    const p = resolveHabitPlan('A', 'reduce', 3, null);
    expect(p.kind).toBe('limit');
    expect(p.followWithoutXp).toBe(false);
    expect(p.measureMode).toBe(false);
  });

  test('stop uses abstinence', () => {
    const p = resolveHabitPlan('A', 'stop', null, null);
    expect(p.kind).toBe('abstinence');
    expect(p.followWithoutXp).toBe(false);
  });

  test('measure uses quantity without XP and no default target', () => {
    const p = resolveHabitPlan('A', 'measure', 4, null);
    expect(p.kind).toBe('quantity');
    expect(p.followWithoutXp).toBe(true);
    expect(p.measureMode).toBe(true);
    expect(p.defaultTarget).toBeNull();
  });
});

describe('resolveHabitPlan — alcohol & regulation', () => {
  test('alcohol reduce', () => {
    expect(resolveHabitPlan('B', 'reduce', 2, null).kind).toBe('limit');
  });

  test('regulation measure is neutral quantity without XP', () => {
    const p = resolveHabitPlan('C', 'measure', 1, null);
    expect(p.kind).toBe('quantity');
    expect(p.followWithoutXp).toBe(true);
    expect(p.sensitive).toBe(true);
    expect(p.defaultTarget).toBeNull();
  });

  test('regulation limit uses explicit config title', () => {
    const p = resolveHabitPlan('C', 'reduce', 2, null);
    expect(p.title).toMatch(/Masturbation \/ sexualité personnelle/);
    expect(p.kind).toBe('reduce');
  });
});

describe('resolveHabitPlan — family weekly', () => {
  test('default 2 calls per week, followWithoutXp', () => {
    const p = resolveHabitPlan('F', 'weekly_calls', null, null);
    expect(p.scheduleKind).toBe('weekly');
    expect(p.weeklyTargetCount).toBe(DEFAULT_WEEKLY_CALL_TARGET);
    expect(p.followWithoutXp).toBe(true);
    expect(p.kind).toBe('habit');
  });

  test('weekly count bounds', () => {
    expect(MIN_WEEKLY_CALLS).toBe(1);
    expect(MAX_WEEKLY_CALLS).toBe(7);
    expect(intentionRequiresWeeklyCount('weekly_calls')).toBe(true);
    expect(intentionRequiresNumericTarget('F', 'weekly_calls')).toBe(false);
  });
});

describe('weekBoundsMondaySunday', () => {
  test('Monday start for mid-week', () => {
    expect(weekBoundsMondaySunday('2025-11-26')).toEqual({
      start: '2025-11-24',
      end: '2025-11-30',
    });
  });

  test('Sunday wraps to same week', () => {
    expect(weekBoundsMondaySunday('2025-11-30')).toEqual({
      start: '2025-11-24',
      end: '2025-11-30',
    });
  });

  test('year overlap: first week of January', () => {
    const b = weekBoundsMondaySunday('2026-01-01');
    expect(b.start).toBe('2025-12-29');
    expect(b.end).toBe('2026-01-04');
  });
});

describe('countWeeklySuccessDays', () => {
  test('double success same day counts once', () => {
    const n = countWeeklySuccessDays(
      [
        { localDate: '2025-11-24', status: 'success' },
        { localDate: '2025-11-24', status: 'success' },
        { localDate: '2025-11-25', status: 'success' },
      ],
      '2025-11-24',
      '2025-11-30',
    );
    expect(n).toBe(2);
  });

  test('unknown days are not failures', () => {
    const n = countWeeklySuccessDays(
      [
        { localDate: '2025-11-24', status: 'success' },
        { localDate: '2025-11-25', status: 'unknown' },
        { localDate: '2025-11-26', status: 'miss' },
      ],
      '2025-11-24',
      '2025-11-30',
    );
    expect(n).toBe(1);
  });

  test('progress label', () => {
    expect(formatWeeklyProgress(1, 2)).toBe('1/2 jours avec appel cette semaine');
  });
});

describe('getVersionForDate — deferred activation', () => {
  const v1Row = {
    id: 'v1',
    goal_id: 'g1',
    version: 1,
    tier: 'normal',
    target_value: 5,
    schedule_kind: 'daily',
    weekly_target_count: null,
    notes: null,
    effective_from: '2025-11-01',
    effective_to: '2025-11-26',
  };
  const v2Row = {
    id: 'v2',
    goal_id: 'g1',
    version: 2,
    tier: 'normal',
    target_value: 10,
    schedule_kind: 'daily',
    weekly_target_count: null,
    notes: null,
    effective_from: '2025-11-27',
    effective_to: null,
  };

  test('today keeps closed version; tomorrow uses scheduled version', async () => {
    const db = {
      getFirstAsync: jest.fn(async (_sql: string, _gid: string, localDate: string) => {
        if (localDate <= '2025-11-26') return v1Row;
        return v2Row;
      }),
    };
    const today = await getVersionForDate(db as never, 'g1', '2025-11-26');
    const tomorrow = await getVersionForDate(db as never, 'g1', addDays('2025-11-26', 1));
    expect(today?.targetValue).toBe(5);
    expect(tomorrow?.targetValue).toBe(10);
  });
});