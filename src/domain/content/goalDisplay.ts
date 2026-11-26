import type { GoalDefinition } from '../models/types';

/** Titre affiché dans l'UI publique (habitudes, suivi). */
export function publicGoalTitle(goal: GoalDefinition): string {
  if (goal.sensitive || goal.templateId === 'freq_regulation') {
    return goal.title.replace(/^Masturbation \/ sexualité personnelle/, 'Régulation personnelle');
  }
  return goal.title;
}