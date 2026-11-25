import type { GoalDefinition } from '../domain/models/types';
import { confirmGoalDay } from '../domain/services/trackingService';
import * as goalRepo from '../data/db/repositories/goalRepo';
import * as dailyRewardRepo from '../data/db/repositories/dailyRewardRepo';
import * as xpRepo from '../data/db/repositories/xpRepo';
import * as rpgRepo from '../data/db/repositories/rpgRepo';

jest.mock('../data/db/repositories/goalRepo');
jest.mock('../data/db/repositories/dailyRewardRepo');
jest.mock('../data/db/repositories/xpRepo');
jest.mock('../data/db/repositories/rpgRepo');

const GOAL_ID = 'g-test';
const LOCAL_DATE = '2026-11-25';

const baseGoal: GoalDefinition = {
  id: GOAL_ID,
  title: 'Test habit',
  kind: 'habit',
  unit: null,
  weight: 1,
  status: 'active',
  templateId: null,
  sensitive: false,
  followWithoutXp: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

type GoalRow = dailyRewardRepo.DailyRewardGoalRow;

function makeDb() {
  const tx = {} as never;
  return {
    withExclusiveTransactionAsync: jest.fn(async (fn: (t: unknown) => Promise<void>) => fn(tx)),
  };
}

function defaultMocks() {
  (goalRepo.listGoals as jest.Mock).mockResolvedValue([baseGoal]);
  (goalRepo.getCurrentVersion as jest.Mock).mockResolvedValue(null);
  (goalRepo.getVersionForDate as jest.Mock).mockResolvedValue(null);
  (goalRepo.getTracking as jest.Mock).mockResolvedValue(null);
  (goalRepo.upsertTracking as jest.Mock).mockResolvedValue(undefined);
  (dailyRewardRepo.detectAndMarkLegacyDay as jest.Mock).mockResolvedValue(false);
  (dailyRewardRepo.getDay as jest.Mock).mockResolvedValue(null);
  (dailyRewardRepo.createSnapshot as jest.Mock).mockResolvedValue(undefined);
  (rpgRepo.addShards as jest.Mock).mockResolvedValue(true);
  (xpRepo.insertXp as jest.Mock).mockResolvedValue('inserted');
  (xpRepo.refreshCharacterFromLedger as jest.Mock).mockResolvedValue(undefined);
  (dailyRewardRepo.applyCreditedCenti as jest.Mock).mockResolvedValue(undefined);
  (dailyRewardRepo.getGoalRow as jest.Mock).mockResolvedValue(null);
}

describe('confirmGoalDay — service behaviour', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    defaultMocks();
  });

  test('success → unknown → success — net XP restored', async () => {
    const db = makeDb();
    const potentialCenti = 2000;
    let credited = 0;
    let revision = 0;

    const goalRow = (): GoalRow => ({
      localDate: LOCAL_DATE,
      goalId: GOAL_ID,
      weight: 1,
      potentialCenti,
      creditedCenti: credited,
      revision,
    });

    (dailyRewardRepo.getDay as jest.Mock).mockImplementation(async () =>
      credited > 0 || revision > 0 ? { localDate: LOCAL_DATE, ruleVersion: '0.2.0', snapshotAt: '', legacy: false } : null,
    );

    (dailyRewardRepo.getGoalRow as jest.Mock).mockImplementation(async () => {
      if (revision === 0 && credited === 0) {
        return { ...goalRow(), potentialCenti, creditedCenti: 0, revision: 0 };
      }
      return goalRow();
    });

    (dailyRewardRepo.applyCreditedCenti as jest.Mock).mockImplementation(
      async (_tx, _d, _g, newCenti: number, newRev: number) => {
        credited = newCenti;
        revision = newRev;
      },
    );

    const r1 = await confirmGoalDay(db as never, GOAL_ID, LOCAL_DATE, 'success');
    expect(r1.xpDeltaCenti).toBe(potentialCenti);

    (dailyRewardRepo.createSnapshot as jest.Mock).mockClear();

    const r2 = await confirmGoalDay(db as never, GOAL_ID, LOCAL_DATE, 'unknown');
    expect(r2.xpDeltaCenti).toBe(-potentialCenti);
    expect(r2.shardsGranted).toBe(0);
    expect(dailyRewardRepo.createSnapshot).not.toHaveBeenCalled();

    const r3 = await confirmGoalDay(db as never, GOAL_ID, LOCAL_DATE, 'success');
    expect(r3.xpDeltaCenti).toBe(potentialCenti);
    expect(credited).toBe(potentialCenti);
  });

  test('first unknown — no snapshot, shard, or XP', async () => {
    const db = makeDb();
    const r = await confirmGoalDay(db as never, GOAL_ID, LOCAL_DATE, 'unknown');
    expect(r.xpGranted).toBe(0);
    expect(r.shardsGranted).toBe(0);
    expect(dailyRewardRepo.createSnapshot).not.toHaveBeenCalled();
    expect(xpRepo.insertXp).not.toHaveBeenCalled();
    expect(rpgRepo.addShards).not.toHaveBeenCalled();
  });

  test('repeat identical success — no double reward', async () => {
    const db = makeDb();
    const potentialCenti = 2000;
    (dailyRewardRepo.getGoalRow as jest.Mock).mockResolvedValue({
      localDate: LOCAL_DATE,
      goalId: GOAL_ID,
      weight: 1,
      potentialCenti,
      creditedCenti: potentialCenti,
      revision: 1,
    });

    const r = await confirmGoalDay(db as never, GOAL_ID, LOCAL_DATE, 'success');
    expect(r.rewardUnchanged).toBe(true);
    expect(xpRepo.insertXp).not.toHaveBeenCalled();
  });

  test('legacy day — no v3 reward changes on unknown', async () => {
    const db = makeDb();
    (dailyRewardRepo.detectAndMarkLegacyDay as jest.Mock).mockResolvedValue(true);
    (dailyRewardRepo.getGoalRow as jest.Mock).mockResolvedValue({
      localDate: LOCAL_DATE,
      goalId: GOAL_ID,
      weight: 1,
      potentialCenti: 2000,
      creditedCenti: 2000,
      revision: 1,
    });

    const r = await confirmGoalDay(db as never, GOAL_ID, LOCAL_DATE, 'unknown');
    expect(r.legacyDay).toBe(true);
    expect(xpRepo.insertXp).not.toHaveBeenCalled();
    expect(dailyRewardRepo.applyCreditedCenti).not.toHaveBeenCalled();
  });

  test('write failure — credited centi not applied after insertXp throws', async () => {
    const db = makeDb();
    (dailyRewardRepo.getGoalRow as jest.Mock).mockResolvedValue({
      localDate: LOCAL_DATE,
      goalId: GOAL_ID,
      weight: 1,
      potentialCenti: 2000,
      creditedCenti: 0,
      revision: 0,
    });
    (xpRepo.insertXp as jest.Mock).mockRejectedValue(new Error('disk full'));

    await expect(confirmGoalDay(db as never, GOAL_ID, LOCAL_DATE, 'success')).rejects.toThrow('disk full');
    expect(dailyRewardRepo.applyCreditedCenti).not.toHaveBeenCalled();
    expect(xpRepo.refreshCharacterFromLedger).not.toHaveBeenCalled();
  });
});