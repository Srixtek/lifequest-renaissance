import * as goalRepo from '../data/db/repositories/goalRepo';
import { scheduleVersionUpdate } from '../domain/services/goalLifecycleService';

jest.mock('../data/db/repositories/goalRepo');
jest.mock('../utils/id', () => ({
  createId: (p: string) => `${p}-mock`,
}));

describe('scheduleVersionUpdate', () => {
  const today = '2025-11-26';
  const baseVersion = {
    id: 'v1',
    goalId: 'g1',
    version: 1,
    tier: 'normal' as const,
    targetValue: 5,
    scheduleKind: 'daily' as const,
    weeklyTargetCount: null,
    notes: null,
    effectiveFrom: '2025-11-01',
    effectiveTo: null,
  };
  const futureVersion = {
    ...baseVersion,
    id: 'v2',
    version: 2,
    targetValue: 8,
    effectiveFrom: '2025-11-27',
  };

  let tx: Record<string, unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    tx = {};
    (goalRepo.getVersionForDate as jest.Mock).mockResolvedValue(baseVersion);
    (goalRepo.getCurrentVersion as jest.Mock).mockResolvedValue(baseVersion);
    (goalRepo.closeVersion as jest.Mock).mockResolvedValue(undefined);
    (goalRepo.insertGoalVersion as jest.Mock).mockResolvedValue(undefined);
    (goalRepo.patchGoalVersion as jest.Mock).mockResolvedValue(undefined);
  });

  test('first change closes today and schedules tomorrow', async () => {
    const db = {
      withExclusiveTransactionAsync: jest.fn(async (fn: (t: unknown) => Promise<void>) => fn(tx)),
    };
    const r = await scheduleVersionUpdate(db as never, 'g1', today, { targetValue: 3 });
    expect(r.effectiveFrom).toBe('2025-11-27');
    expect(goalRepo.closeVersion).toHaveBeenCalledWith(tx, 'v1', today);
    expect(goalRepo.insertGoalVersion).toHaveBeenCalled();
    expect(goalRepo.patchGoalVersion).not.toHaveBeenCalled();
  });

  test('second change same day patches future version only', async () => {
    (goalRepo.getCurrentVersion as jest.Mock).mockResolvedValue(futureVersion);
    const db = {
      withExclusiveTransactionAsync: jest.fn(async (fn: (t: unknown) => Promise<void>) => fn(tx)),
    };
    await scheduleVersionUpdate(db as never, 'g1', today, { targetValue: 2 });
    expect(goalRepo.patchGoalVersion).toHaveBeenCalledWith(tx, 'v2', { targetValue: 2 });
    expect(goalRepo.closeVersion).not.toHaveBeenCalled();
    expect(goalRepo.insertGoalVersion).not.toHaveBeenCalled();
  });
});