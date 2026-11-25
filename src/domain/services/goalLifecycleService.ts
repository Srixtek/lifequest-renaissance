import type { Db } from '../../data/db/client';
import * as goalRepo from '../../data/db/repositories/goalRepo';
import type { GoalDefinition, GoalTier, GoalVersion } from '../models/types';
import type { ResolvedHabitPlan } from '../content/habitIntentions';
import { addDays, nowIso } from '../rules/dates';
import { createId } from '../../utils/id';

export async function createHabitGoal(
  db: Db,
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
  await goalRepo.setGoalStatus(db, existing.id, 'archived');
  const newGoalId = await createHabitGoal(db, plan, targetValue, tier);
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
  const current = await goalRepo.getCurrentVersion(db, goalId);
  if (!current) throw new Error('Version active introuvable');
  const effectiveFrom = addDays(todayLocal, 1);
  await goalRepo.closeVersion(db, current.id, todayLocal);
  const nextVersion = current.version + 1;
  const version: GoalVersion = {
    id: createId('gver'),
    goalId,
    version: nextVersion,
    tier: current.tier,
    targetValue: patch.targetValue !== undefined ? patch.targetValue : current.targetValue,
    scheduleKind: current.scheduleKind,
    weeklyTargetCount:
      patch.weeklyTargetCount !== undefined ? patch.weeklyTargetCount : current.weeklyTargetCount,
    notes: null,
    effectiveFrom,
    effectiveTo: null,
  };
  await goalRepo.insertGoalVersion(db, version);
  return { effectiveFrom };
}