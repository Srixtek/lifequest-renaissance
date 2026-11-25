import { baselineReady, coverageLabel, type GoalStats } from '../domain/services/statsService';

function make(partial: Partial<GoalStats> & Pick<GoalStats, 'covered' | 'window'>): GoalStats {
  return {
    goalId: 'g',
    title: 't',
    points: [],
    coverageRatio: partial.covered / partial.window,
    successCount: 0,
    followWithoutXp: false,
    ...partial,
  };
}

describe('stats coverage', () => {
  test('label shows denominator', () => {
    const s = make({ covered: 3, window: 7 });
    expect(coverageLabel(s)).toContain('3/7');
  });

  test('measure mode does not inflate success count', () => {
    const s = make({
      covered: 4,
      window: 7,
      followWithoutXp: true,
      successCount: 0,
      points: [
        { date: '2025-11-01', status: 'partial', value: 3 },
        { date: '2025-11-02', status: 'unknown', value: null },
      ],
    });
    expect(s.successCount).toBe(0);
    expect(coverageLabel(s)).toContain('4/7');
  });

  test('baseline requires 14d window and 70%', () => {
    expect(baselineReady(make({ covered: 7, window: 7 }))).toBe(false);
    expect(baselineReady(make({ covered: 10, window: 14 }))).toBe(true);
    expect(baselineReady(make({ covered: 6, window: 14 }))).toBe(false);
  });
});
