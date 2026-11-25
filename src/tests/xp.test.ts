import {
  DAILY_XP_BUDGET,
  DAILY_XP_BUDGET_CENTI,
  allocateXpCenti,
  completionRatio,
  earnedXp,
  idempotencyKeyDailyGoal,
  idempotencyKeyDailyGoalRevision,
  levelFromTotalXp,
  potentialXpForGoals,
} from '../domain/rules/xp';

describe('XP rules', () => {
  test('daily budget split equally across goals', () => {
    const pot = potentialXpForGoals([
      { id: 'a', weight: 1, followWithoutXp: false },
      { id: 'b', weight: 1, followWithoutXp: false },
    ]);
    expect(pot.a).toBeCloseTo(25);
    expect(pot.b).toBeCloseTo(25);
    expect(pot.a + pot.b).toBeCloseTo(DAILY_XP_BUDGET);
  });

  test('more goals still cap at 50', () => {
    const goals = Array.from({ length: 5 }, (_, i) => ({
      id: `g${i}`,
      weight: 1,
      followWithoutXp: false,
    }));
    const pot = potentialXpForGoals(goals);
    const sum = Object.values(pot).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(50);
    expect(pot.g0).toBeCloseTo(10);
  });

  test('followWithoutXp excluded from pool', () => {
    const pot = potentialXpForGoals([
      { id: 'a', weight: 1, followWithoutXp: true },
      { id: 'b', weight: 1, followWithoutXp: false },
    ]);
    expect(pot.a).toBeUndefined();
    expect(pot.b).toBeCloseTo(50);
  });

  test('unknown and miss grant 0 completion', () => {
    expect(completionRatio('unknown', 'habit', null, null)).toBe(0);
    expect(completionRatio('miss', 'abstinence', null, null)).toBe(0);
    expect(completionRatio('success', 'abstinence', null, null)).toBe(1);
  });

  test('earnedXp respects ratio', () => {
    expect(earnedXp(25, 1)).toBe(25);
    expect(earnedXp(25, 0.5)).toBe(12.5);
    expect(earnedXp(25, 0)).toBe(0);
  });

  test('level curve', () => {
    expect(levelFromTotalXp(0)).toBe(1);
    expect(levelFromTotalXp(99)).toBe(1);
    expect(levelFromTotalXp(100)).toBe(2);
  });

  test('idempotency key stable', () => {
    expect(idempotencyKeyDailyGoal('g1', '2026-11-10')).toBe('daily-goal:g1:2026-11-10');
  });

  test('centi allocation sums to budget', () => {
    const centi = allocateXpCenti([
      { id: 'a', weight: 1, followWithoutXp: false },
      { id: 'b', weight: 1, followWithoutXp: false },
    ]);
    expect(Object.values(centi).reduce((a, b) => a + b, 0)).toBe(DAILY_XP_BUDGET_CENTI);
  });

  test('revision idempotency key', () => {
    expect(idempotencyKeyDailyGoalRevision('g1', '2026-11-10', 3)).toBe(
      'daily-goal-v3:g1:2026-11-10:r3',
    );
  });

  test('zero target partial ratio', () => {
    expect(completionRatio('partial', 'quantity', 0, 0)).toBe(1);
    expect(completionRatio('partial', 'quantity', 1, 0)).toBe(0);
  });
});
