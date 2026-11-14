import { DAILY_XP_BUDGET, earnedXp, potentialXpForGoals } from '../domain/rules/xp';

/** Simulation profiles — section 10.5 lite */
describe('fairness simulation', () => {
  function dayXp(goalCount: number, ratio: number) {
    const goals = Array.from({ length: goalCount }, (_, i) => ({
      id: `g${i}`,
      weight: 1,
      followWithoutXp: false,
    }));
    const pot = potentialXpForGoals(goals);
    return Object.values(pot).reduce((s, p) => s + earnedXp(p, ratio), 0);
  }

  test('1 vs 5 daily goals same perfect day total', () => {
    expect(dayXp(1, 1)).toBeCloseTo(DAILY_XP_BUDGET);
    expect(dayXp(5, 1)).toBeCloseTo(DAILY_XP_BUDGET);
  });

  test('partial 50% scales', () => {
    expect(dayXp(2, 0.5)).toBeCloseTo(25);
  });

  test('splitting into micro-tasks does not raise daily cap', () => {
    expect(dayXp(10, 1)).toBeCloseTo(DAILY_XP_BUDGET);
  });
});
