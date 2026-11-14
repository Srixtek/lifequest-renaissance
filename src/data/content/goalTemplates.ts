import type { GoalKind, GoalTier } from '../../domain/models/types';

export interface GoalTemplate {
  id: string;
  title: string;
  kind: GoalKind;
  unit: string | null;
  defaultTier: GoalTier;
  targetValue: number | null;
  scheduleKind: 'daily' | 'weekly';
  weeklyTargetCount: number | null;
  alcoholSafety?: boolean;
  nicotineNote?: boolean;
  sensitive?: boolean;
}

export const GOAL_TEMPLATES: GoalTemplate[] = [
  {
    id: 'no_vape',
    title: 'Ne pas vapoter aujourd\'hui',
    kind: 'abstinence',
    unit: null,
    defaultTier: 'normal',
    targetValue: 0,
    scheduleKind: 'daily',
    weeklyTargetCount: null,
    nicotineNote: true,
  },
  {
    id: 'breathing5',
    title: 'Respiration 5 min',
    kind: 'duration',
    unit: 'min',
    defaultTier: 'normal',
    targetValue: 5,
    scheduleKind: 'daily',
    weeklyTargetCount: null,
  },
  {
    id: 'alcohol_limit',
    title: 'Limiter l\'alcool',
    kind: 'limit',
    unit: 'verres',
    defaultTier: 'normal',
    targetValue: 2,
    scheduleKind: 'daily',
    weeklyTargetCount: null,
    alcoholSafety: true,
  },
  {
    id: 'walk',
    title: 'Marcher',
    kind: 'duration',
    unit: 'min',
    defaultTier: 'minimal',
    targetValue: 5,
    scheduleKind: 'weekly',
    weeklyTargetCount: 3,
  },
  {
    id: 'sleep_window',
    title: 'Se coucher avant minuit',
    kind: 'habit',
    unit: null,
    defaultTier: 'normal',
    targetValue: null,
    scheduleKind: 'daily',
    weeklyTargetCount: null,
  },
];
