import {
  DAILY_XP_BUDGET,
  DAILY_XP_BUDGET_CENTI,
  allocateXpCenti,
  centiToXp,
  completionRatio,
  earnedXpCenti,
  idempotencyKeyDailyCheckin,
  idempotencyKeyDailyGoalRevision,
  isExplicitTrackingStatus,
  potentialXpForGoals,
} from '../domain/rules/xp';

function goalsN(n: number, weight = 1) {
  return Array.from({ length: n }, (_, i) => ({
    id: `g${String(i).padStart(2, '0')}`,
    weight,
    followWithoutXp: false,
  }));
}

function dayXpTotal(goalCount: number, ratio: number, weight = 1) {
  const g = goalsN(goalCount, weight);
  const centi = allocateXpCenti(g);
  return Object.values(centi).reduce((s, p) => s + earnedXpCenti(p, ratio), 0);
}

describe('XP engine v0.2 — deterministic rules', () => {
  test('1 goal success = 50 XP', () => {
    expect(dayXpTotal(1, 1)).toBe(DAILY_XP_BUDGET_CENTI);
    expect(centiToXp(dayXpTotal(1, 1))).toBe(DAILY_XP_BUDGET);
  });

  test('5 goals success = 50 XP total', () => {
    expect(centiToXp(dayXpTotal(5, 1))).toBe(DAILY_XP_BUDGET);
  });

  test('10 goals success = 50 XP total', () => {
    expect(centiToXp(dayXpTotal(10, 1))).toBe(DAILY_XP_BUDGET);
  });

  test('different weights sum to exactly 50 XP', () => {
    const g = [
      { id: 'a', weight: 1, followWithoutXp: false },
      { id: 'b', weight: 3, followWithoutXp: false },
      { id: 'c', weight: 2, followWithoutXp: false },
    ];
    const centi = allocateXpCenti(g);
    expect(Object.values(centi).reduce((a, b) => a + b, 0)).toBe(DAILY_XP_BUDGET_CENTI);
    expect(centiToXp(Object.values(centi).reduce((a, b) => a + b, 0))).toBe(DAILY_XP_BUDGET);
  });

  test('allocation independent of input order', () => {
    const g1 = [
      { id: 'z', weight: 2, followWithoutXp: false },
      { id: 'a', weight: 1, followWithoutXp: false },
    ];
    const g2 = [
      { id: 'a', weight: 1, followWithoutXp: false },
      { id: 'z', weight: 2, followWithoutXp: false },
    ];
    expect(allocateXpCenti(g1)).toEqual(allocateXpCenti(g2));
  });

  test('repeated validation — zero delta when ratio unchanged', () => {
    const pot = 5000;
    const first = earnedXpCenti(pot, 1);
    const second = earnedXpCenti(pot, 1);
    expect(second - first).toBe(0);
  });

  test('success → miss → success yields correct net centi', () => {
    const pot = 2500;
    let credited = 0;
    const apply = (ratio: number) => {
      const expected = earnedXpCenti(pot, ratio);
      const delta = expected - credited;
      credited = expected;
      return delta;
    };
    expect(apply(1)).toBe(2500);
    expect(apply(0)).toBe(-2500);
    expect(apply(1)).toBe(2500);
    expect(credited).toBe(2500);
  });

  test('goal added after snapshot — not in allocation map', () => {
    const snapshot = allocateXpCenti(goalsN(2));
    expect(snapshot.g99).toBeUndefined();
  });

  test('pause/archived goals excluded when not in snapshot list', () => {
    const activeOnly = allocateXpCenti([{ id: 'a', weight: 1, followWithoutXp: false }]);
    expect(Object.keys(activeOnly)).toHaveLength(1);
  });

  test('zero max target: value 0 success, positive miss', () => {
    expect(completionRatio('partial', 'limit', 0, 0)).toBe(1);
    expect(completionRatio('partial', 'limit', 2, 0)).toBe(0);
    expect(earnedXpCenti(1000, completionRatio('partial', 'limit', 2, 0))).toBe(0);
  });

  test('miss gives participation eligibility but 0 XP', () => {
    expect(isExplicitTrackingStatus('miss')).toBe(true);
    expect(earnedXpCenti(5000, completionRatio('miss', 'habit', null, null))).toBe(0);
  });

  test('unknown is not explicit', () => {
    expect(isExplicitTrackingStatus('unknown')).toBe(false);
  });

  test('daily checkin key stable', () => {
    expect(idempotencyKeyDailyCheckin('2026-11-10')).toBe('daily-checkin:2026-11-10');
  });

  test('revision idempotency keys differ per revision', () => {
    expect(idempotencyKeyDailyGoalRevision('g1', '2026-11-10', 1)).not.toBe(
      idempotencyKeyDailyGoalRevision('g1', '2026-11-10', 2),
    );
  });

  test('legacy float potentials still sum to 50', () => {
    const pot = potentialXpForGoals(goalsN(7));
    const sum = Object.values(pot).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(DAILY_XP_BUDGET, 5);
  });
});

describe('XP engine — ledger simulation', () => {
  test('no duplicate delta when revision key already used', () => {
    const keys = new Set<string>();
    const record = (rev: number) => {
      const k = idempotencyKeyDailyGoalRevision('g1', '2026-11-11', rev);
      if (keys.has(k)) return 'duplicate';
      keys.add(k);
      return 'inserted';
    };
    expect(record(1)).toBe('inserted');
    expect(record(1)).toBe('duplicate');
    expect(record(2)).toBe('inserted');
  });
});