import type { GoalDefinition, HabitCategoryId } from '../../domain/models/types';

export interface HabitCategoryDef {
  id: HabitCategoryId;
  label: string;
  /** Symbole lisible sans la couleur. */
  symbol: string;
  color: string;
  /** Phrase courte affichée quand la catégorie n'a aucun objectif actif. */
  emptyHint: string;
}

/** Catalogue centralisé et typé : l'ordre est celui de la grille Habitudes. */
export const HABIT_CATEGORIES: readonly HabitCategoryDef[] = [
  { id: 'vape', label: 'Vape', symbol: '💨', color: '#C75C5C', emptyHint: 'Aucun objectif vape pour le moment.' },
  { id: 'alcool', label: 'Alcool', symbol: '🍷', color: '#4F86C6', emptyHint: 'Aucun objectif alcool pour le moment.' },
  { id: 'sport', label: 'Sport', symbol: '🏃', color: '#4DAF6A', emptyHint: 'Aucun objectif sport pour le moment.' },
  { id: 'proches', label: 'Proches', symbol: '🤝', color: '#9A74C9', emptyHint: 'Aucun objectif avec tes proches pour le moment.' },
  { id: 'personnel', label: 'Personnel', symbol: '🧭', color: '#7F8FA3', emptyHint: 'Aucun objectif personnel pour le moment.' },
  { id: 'sans_ecran', label: 'Sans écran', symbol: '📵', color: '#D69A3C', emptyHint: 'Aucun objectif sans écran pour le moment.' },
  { id: 'divers', label: 'Divers', symbol: '✨', color: '#8FA89F', emptyHint: 'Aucune autre habitude pour le moment.' },
];

export const DEFAULT_HABIT_CATEGORY: HabitCategoryId = 'divers';

export const HABIT_CATEGORY_BY_ID: Record<HabitCategoryId, HabitCategoryDef> = Object.fromEntries(
  HABIT_CATEGORIES.map((c) => [c.id, c]),
) as Record<HabitCategoryId, HabitCategoryDef>;

/** Classement des modèles guidés existants. */
export const TEMPLATE_CATEGORY: Record<string, HabitCategoryId> = {
  vape_sessions: 'vape',
  alcohol_limit: 'alcool',
  sport_minutes: 'sport',
  call_family: 'proches',
  freq_regulation: 'personnel',
  screen_free: 'sans_ecran',
  breathing5: 'divers',
};

export function isHabitCategoryId(value: unknown): value is HabitCategoryId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(HABIT_CATEGORY_BY_ID, value);
}

export function categoryForTemplate(templateId: string | null | undefined): HabitCategoryId {
  return (templateId && TEMPLATE_CATEGORY[templateId]) || DEFAULT_HABIT_CATEGORY;
}

/** Catégorie persistée en priorité, puis modèle, puis « Divers » (anciennes habitudes perso). */
export function categoryForGoal(
  goal: Pick<GoalDefinition, 'categoryId' | 'templateId'>,
): HabitCategoryId {
  if (isHabitCategoryId(goal.categoryId)) return goal.categoryId;
  return categoryForTemplate(goal.templateId);
}

export function groupGoalsByCategory<T extends Pick<GoalDefinition, 'categoryId' | 'templateId'>>(
  goals: readonly T[],
): Record<HabitCategoryId, T[]> {
  const out = Object.fromEntries(HABIT_CATEGORIES.map((c) => [c.id, [] as T[]])) as Record<HabitCategoryId, T[]>;
  for (const g of goals) out[categoryForGoal(g)].push(g);
  return out;
}

/** Libellé court du nombre d'objectifs actifs. */
export function activeCountLabel(count: number): string {
  if (count <= 0) return 'Aucun objectif';
  return count === 1 ? '1 objectif' : `${count} objectifs`;
}
