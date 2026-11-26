import type { Db } from '../../data/db/client';
import * as profileRepo from '../../data/db/repositories/profileRepo';
import * as goalRepo from '../../data/db/repositories/goalRepo';
import * as rpgRepo from '../../data/db/repositories/rpgRepo';
import type { ClassId, GoalTier, Profile } from '../models/types';
import { GOAL_TEMPLATES } from '../../data/content/goalTemplates';
import { STARTER_ITEM_ID } from '../../data/content/items';
import {
  intentionRequiresNumericTarget,
  resolveHabitPlan,
  type HabitIntentionChoice,
} from '../content/habitIntentions';
import { createHabitGoal } from './goalLifecycleService';
import { validateCreationTarget } from '../rules/trackingStatus';
import { nowIso } from '../rules/dates';
import { createId } from '../../utils/id';

export interface SensitiveOnboardingChoice {
  intention: HabitIntentionChoice;
  targetValue: number | null;
}

export interface OnboardingInput {
  pseudo: string;
  classId: ClassId;
  tone: 'fantasy' | 'sobre';
  templateIds: string[];
  /** Réglage explicite pour freq_regulation — pas de limite implicite. */
  sensitiveRegulation?: SensitiveOnboardingChoice | null;
  dayStartHour?: number;
}

export async function completeOnboarding(db: Db, input: OnboardingInput): Promise<Profile> {
  const existing = await profileRepo.getProfile(db);
  if (existing?.onboardingDone) return existing;

  const profile: Profile = {
    id: existing?.id ?? createId('profile'),
    pseudo: input.pseudo.trim() || 'Voyageur',
    classId: input.classId,
    tone: input.tone,
    dayStartHour: input.dayStartHour ?? 4,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    createdAt: existing?.createdAt ?? nowIso(),
    onboardingDone: true,
  };

  await db.withTransactionAsync(async () => {
    await profileRepo.upsertProfile(db, profile);
    await rpgRepo.grantItem(db, STARTER_ITEM_ID);

    for (const tid of input.templateIds) {
      const t = GOAL_TEMPLATES.find((x) => x.id === tid);
      if (!t) continue;
      if (t.id === 'freq_regulation') {
        const choice = input.sensitiveRegulation;
        if (!choice) continue;
        const plan = resolveHabitPlan('C', choice.intention, choice.targetValue, null);
        let target: number | null = plan.defaultTarget;
        if (choice.intention === 'measure') target = null;
        else if (intentionRequiresNumericTarget('C', choice.intention) && choice.targetValue != null) {
          const check = validateCreationTarget(plan.kind, String(choice.targetValue));
          if (check.ok) target = check.value;
        }
        await createHabitGoal(db, plan, target, t.defaultTier as GoalTier);
        continue;
      }
      const goalId = createId('goal');
      const createdAt = nowIso();
      await goalRepo.insertGoal(
        db,
        {
          id: goalId,
          title: t.title,
          kind: t.kind,
          unit: t.unit,
          weight: 1,
          status: 'active',
          templateId: t.id,
          sensitive: !!t.sensitive,
          followWithoutXp: false,
          createdAt,
        },
        {
          id: createId('gver'),
          goalId,
          version: 1,
          tier: t.defaultTier as GoalTier,
          targetValue: t.targetValue,
          scheduleKind: t.scheduleKind,
          weeklyTargetCount: t.weeklyTargetCount,
          notes: null,
          effectiveFrom: createdAt.slice(0, 10),
          effectiveTo: null,
        },
      );
    }
  });

  return profile;
}
