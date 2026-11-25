import type { GoalTemplate } from '@/src/data/content/goalTemplates';

export const CATEGORY_LABELS: Record<GoalTemplate['category'], string> = {
  A: 'Vape',
  B: 'Alcool',
  C: 'Régulation personnelle',
  D: 'Activité physique',
  E: 'Temps sans écran',
  F: 'Famille et proches',
};

export const CATEGORY_SHORT: Record<GoalTemplate['category'], string> = {
  A: 'Vape',
  B: 'Alcool',
  C: 'Régulation',
  D: 'Sport',
  E: 'Sans écran',
  F: 'Famille',
};