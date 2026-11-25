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
  neutralNote?: string;
  category: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
}

/** Six optional preset categories — Mission 001 */
export const GOAL_TEMPLATES: GoalTemplate[] = [
  {
    id: 'vape_sessions',
    title: 'Vape — séances déclarées',
    kind: 'limit',
    unit: 'séances',
    defaultTier: 'normal',
    targetValue: 5,
    scheduleKind: 'daily',
    weeklyTargetCount: null,
    nicotineNote: true,
    category: 'A',
  },
  {
    id: 'alcohol_limit',
    title: 'Alcool — verres déclarés',
    kind: 'limit',
    unit: 'verres',
    defaultTier: 'normal',
    targetValue: 2,
    scheduleKind: 'daily',
    weeklyTargetCount: null,
    alcoholSafety: true,
    category: 'B',
  },
  {
    id: 'freq_regulation',
    title: 'Réguler une fréquence (perso.)',
    kind: 'reduce',
    unit: 'fois',
    defaultTier: 'normal',
    targetValue: 1,
    scheduleKind: 'daily',
    weeklyTargetCount: null,
    sensitive: true,
    neutralNote:
      'La masturbation n\'est pas nocive en soi. Cet objectif sert uniquement à une préférence personnelle, sans jugement.',
    category: 'C',
  },
  {
    id: 'sport_minutes',
    title: 'Sport ou mouvement',
    kind: 'duration',
    unit: 'min',
    defaultTier: 'normal',
    targetValue: 30,
    scheduleKind: 'daily',
    weeklyTargetCount: null,
    category: 'D',
  },
  {
    id: 'screen_free',
    title: 'Temps sans écran (déclaré)',
    kind: 'duration',
    unit: 'min',
    defaultTier: 'minimal',
    targetValue: 60,
    scheduleKind: 'daily',
    weeklyTargetCount: null,
    category: 'E',
  },
  {
    id: 'call_family',
    title: 'Appeler un proche',
    kind: 'habit',
    unit: null,
    defaultTier: 'normal',
    targetValue: null,
    scheduleKind: 'daily',
    weeklyTargetCount: null,
    category: 'F',
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
    category: 'D',
  },
];

export const GOAL_KIND_LABELS: Record<GoalKind, string> = {
  habit: 'Habitude (oui/non)',
  abstinence: 'Abstinence déclarée',
  limit: 'Limite (max)',
  reduce: 'Réduction',
  duration: 'Durée / minutes',
  quantity: 'Quantité',
};