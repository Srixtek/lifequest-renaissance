import type { GoalKind, GoalScheduleKind } from '../models/types';
import type { GoalTemplate } from '../../data/content/goalTemplates';

export type HabitCategory = GoalTemplate['category'];

const CATEGORY_LABELS: Record<HabitCategory, string> = {
  A: 'Vape',
  B: 'Alcool',
  C: 'Régulation personnelle',
  D: 'Activité physique',
  E: 'Temps sans écran',
  F: 'Famille et proches',
};

export type ConsumptionIntention = 'reduce' | 'stop' | 'measure';
export type SportIntention = 'minutes';
export type FamilyIntention = 'weekly_calls';

export type HabitIntentionChoice =
  | ConsumptionIntention
  | SportIntention
  | FamilyIntention;

export interface IntentionOption {
  id: HabitIntentionChoice;
  label: string;
  hint: string;
}

const CONSUMPTION_OPTIONS: IntentionOption[] = [
  { id: 'reduce', label: 'Réduire', hint: 'Fixer un maximum par jour' },
  { id: 'stop', label: 'Arrêter', hint: 'Viser une journée sans consommation déclarée' },
  { id: 'measure', label: 'Mesurer', hint: 'Suivi neutre, sans récompense XP automatique' },
];

export const INTENTION_OPTIONS: Record<HabitCategory, IntentionOption[]> = {
  A: CONSUMPTION_OPTIONS,
  B: CONSUMPTION_OPTIONS,
  C: CONSUMPTION_OPTIONS,
  D: [{ id: 'minutes', label: 'Minutes visées', hint: 'Cible quotidienne en minutes, puis saisie réelle' }],
  E: [{ id: 'minutes', label: 'Minutes visées', hint: 'Cible quotidienne en minutes, puis saisie réelle' }],
  F: [{ id: 'weekly_calls', label: 'Appels réguliers', hint: 'Objectif hebdomadaire, confirmation jour par jour' }],
};

export const DEFAULT_WEEKLY_CALL_TARGET = 2;
export const MIN_WEEKLY_CALLS = 1;
export const MAX_WEEKLY_CALLS = 7;

export interface ResolvedHabitPlan {
  title: string;
  kind: GoalKind;
  unit: string | null;
  followWithoutXp: boolean;
  scheduleKind: GoalScheduleKind;
  weeklyTargetCount: number | null;
  defaultTarget: number | null;
  templateId: string;
  sensitive: boolean;
  alcoholSafety?: boolean;
  nicotineNote?: boolean;
  neutralNote?: string;
  measureMode: boolean;
}

const TEMPLATE_ID: Record<HabitCategory, string> = {
  A: 'vape_sessions',
  B: 'alcohol_limit',
  C: 'freq_regulation',
  D: 'sport_minutes',
  E: 'screen_free',
  F: 'call_family',
};

const DEFAULT_TARGETS: Partial<Record<HabitCategory, number>> = {
  A: 5,
  B: 2,
  C: 1,
  D: 30,
  E: 60,
};

export function resolveHabitPlan(
  category: HabitCategory,
  intention: HabitIntentionChoice,
  targetValue: number | null,
  weeklyTarget: number | null,
): ResolvedHabitPlan {
  const templateId = TEMPLATE_ID[category];
  const catLabel = CATEGORY_LABELS[category];

  if (intention === 'weekly_calls') {
    const w = weeklyTarget ?? DEFAULT_WEEKLY_CALL_TARGET;
    return {
      title: `${catLabel} — appels`,
      kind: 'habit',
      unit: null,
      followWithoutXp: true,
      scheduleKind: 'weekly',
      weeklyTargetCount: w,
      defaultTarget: null,
      templateId,
      sensitive: false,
      measureMode: false,
    };
  }

  if (intention === 'minutes') {
    const target = targetValue ?? DEFAULT_TARGETS[category] ?? 30;
    return {
      title: category === 'D' ? 'Sport ou mouvement' : 'Temps sans écran (déclaré)',
      kind: 'duration',
      unit: 'min',
      followWithoutXp: false,
      scheduleKind: 'daily',
      weeklyTargetCount: null,
      defaultTarget: target,
      templateId,
      sensitive: false,
      measureMode: false,
    };
  }

  const measureMode = intention === 'measure';
  const sensitive = category === 'C';
  const base: Omit<ResolvedHabitPlan, 'title' | 'kind' | 'defaultTarget'> = {
    unit: category === 'A' ? 'séances' : category === 'B' ? 'verres' : 'fois',
    followWithoutXp: measureMode,
    scheduleKind: 'daily',
    weeklyTargetCount: null,
    templateId,
    sensitive,
    measureMode,
    nicotineNote: category === 'A',
    alcoholSafety: category === 'B',
    neutralNote:
      category === 'C'
        ? "La masturbation n'est pas nocive en soi. Cet objectif sert uniquement à une préférence personnelle, sans jugement."
        : undefined,
  };

  if (intention === 'stop') {
    return {
      ...base,
      title: `${catLabel} — journée sans consommation`,
      kind: 'abstinence',
      defaultTarget: null,
    };
  }

  if (measureMode) {
    return {
      ...base,
      title: `${catLabel} — suivi`,
      kind: 'quantity',
      defaultTarget: null,
    };
  }

  const defaultTarget = targetValue ?? DEFAULT_TARGETS[category] ?? 1;
  const kind: GoalKind = category === 'C' ? 'reduce' : 'limit';
  return {
    ...base,
    title: `${catLabel} — maximum quotidien`,
    kind,
    defaultTarget,
  };
}

export function intentionRequiresNumericTarget(
  category: HabitCategory,
  intention: HabitIntentionChoice,
): boolean {
  if (intention === 'stop' || intention === 'weekly_calls' || intention === 'measure') return false;
  return true;
}

export function intentionRequiresWeeklyCount(intention: HabitIntentionChoice): boolean {
  return intention === 'weekly_calls';
}