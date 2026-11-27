import type { Db } from '../../data/db/client';
import * as goalRepo from '../../data/db/repositories/goalRepo';
import { isHabitCategoryId, DEFAULT_HABIT_CATEGORY } from '../../data/content/habitCategories';
import { createId } from '../../utils/id';
import { nowIso } from '../rules/dates';
import { validateCreationTarget } from '../rules/trackingStatus';
import type { GoalKind, GoalTier, HabitCategoryId } from '../models/types';

export interface CustomGoalInput {
  title: string;
  kind: GoalKind;
  unit?: string | null;
  /** Saisie brute de l'objectif (validée selon le type de suivi). */
  targetRaw: string;
  tier: GoalTier;
  categoryId: HabitCategoryId;
}

export type CustomGoalResult =
  | { ok: true; goalId: string; title: string; categoryId: HabitCategoryId }
  | { ok: false; error: string };

/** Création libre d'une habitude : validation + insertion atomique (définition + version 1). */
export async function createCustomGoal(db: Db, input: CustomGoalInput): Promise<CustomGoalResult> {
  const title = input.title.trim();
  if (!title) return { ok: false, error: 'Donne un nom à l\'habitude.' };
  const targetCheck = validateCreationTarget(input.kind, input.targetRaw);
  if (!targetCheck.ok) return { ok: false, error: targetCheck.error };

  const categoryId = isHabitCategoryId(input.categoryId) ? input.categoryId : DEFAULT_HABIT_CATEGORY;
  const goalId = createId('goal');
  const createdAt = nowIso();
  const unit = input.unit?.trim() || null;

  await db.withExclusiveTransactionAsync(async (tx) => {
    await goalRepo.insertGoal(
      tx,
      {
        id: goalId,
        title,
        kind: input.kind,
        unit,
        weight: 1,
        status: 'active',
        templateId: null,
        sensitive: false,
        followWithoutXp: false,
        categoryId,
        createdAt,
      },
      {
        id: createId('gver'),
        goalId,
        version: 1,
        tier: input.tier,
        targetValue: targetCheck.value,
        scheduleKind: 'daily',
        weeklyTargetCount: null,
        notes: null,
        effectiveFrom: createdAt.slice(0, 10),
        effectiveTo: null,
      },
    );
  });
  return { ok: true, goalId, title, categoryId };
}
