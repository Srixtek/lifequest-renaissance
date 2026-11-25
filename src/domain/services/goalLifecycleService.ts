import type { Db } from '../../data/db/client';
import type { SqlRunner } from '../../data/db/sqlRunner';
import * as goalRepo from '../../data/db/repositories/goalRepo';
import type { GoalDefinition, GoalTier, GoalVersion } from '../models/types';
import type { ResolvedHabitPlan } from '../content/habitIntentions';
import { addDays, nowIso } from '../rules/dates';
import { createId } from '../../utils/id';

type Conn = Db | SqlRunner;

export async function createHabitGoal(
  db: Conn,
  plan: ResolvedHabitPlan,
  targetValue: number | null,
  tier: GoalTier,
): Promise<string> {
  const goalId = createId('goal');
  const createdAt = nowIso();
  await goalRepo.insertGoal(
    db,
    {
      id: goalId,
      title: plan.title,
      kind: plan.kind,
      unit: plan.unit,
      weight: 1,
      status: 'active',
      templateId: plan.templateId,
      sensitive: plan.sensitive,
      followWithoutXp: plan.followWithoutXp,
      createdAt,
    },
    {
      id: createId('gver'),
      goalId,
      version: 1,
      tier,
      targetValue,
      scheduleKind: plan.scheduleKind,
      weeklyTargetCount: plan.weeklyTargetCount,
      notes: null,
      effectiveFrom: createdAt.slice(0, 10),
      effectiveTo: null,
    },
  );
  return goalId;
}

export async function archiveAndRecreateForModeChange(
  db: Db,
  existing: GoalDefinition,
  plan: ResolvedHabitPlan,
  targetValue: number | null,
  tier: GoalTier,
): Promise<{ newGoalId: string }> {
  let newGoalId = '';
  await db.withExclusiveTransactionAsync(async (tx) => {
    await goalRepo.setGoalStatus(tx, existing.id, 'archived');
    newGoalId = await createHabitGoal(tx, plan, targetValue, tier);
  });
  return { newGoalId };
}

export interface VersionPatch {
  targetValue?: number;
  weeklyTargetCount?: number;
}

export async function scheduleVersionUpdate(
  db: Db,
  goalId: string,
  todayLocal: string,
  patch: VersionPatch,
): Promise<{ effectiveFrom: string }> {
  const effectiveFrom = addDays(todayLocal, 1);

  await db.withExclusiveTransactionAsync(async (tx) => {
    const applyingToday = await goalRepo.getVersionForDate(tx, goalId, todayLocal);
    if (!applyingToday) throw new Error('Version active introuvable');

    const open = await goalRepo.getCurrentVersion(tx, goalId);

    // Second (or later) change the same local day: adjust the already-scheduled future version.
    if (open && open.effectiveFrom > todayLocal) {
      await goalRepo.patchGoalVersion(tx, open.id, patch);
      return;
    }

    if (open && open.effectiveTo == null && open.effectiveFrom <= todayLocal) {
      await goalRepo.closeVersion(tx, open.id, todayLocal);
    }

    const targetValue =
      patch.targetValue !== undefined ? patch.targetValue : applyingToday.targetValue;
    const weeklyTargetCount =
      patch.weeklyTargetCount !== undefined
        ? patch.weeklyTargetCount
        : applyingToday.weeklyTargetCount;

    const version: GoalVersion = {
      id: createId('gver'),
      goalId,
      version: applyingToday.version + 1,
      tier: applyingToday.tier,
      targetValue,
      scheduleKind: applyingToday.scheduleKind,
      weeklyTargetCount,
      notes: null,
      effectiveFrom,
      effectiveTo: null,
    };
    await goalRepo.insertGoalVersion(tx, version);
  });

  return { effectiveFrom };
}