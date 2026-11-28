import type { WeeklyQuestCard } from './weeklyQuestService';
import type { DailyCategoryTarget } from './dailyQuestNavigation';

/** « Aller à l'activité » : ouvre le journal Sport / Proches / Divers correspondant. */
export function resolveWeeklyTarget(card: Pick<WeeklyQuestCard, 'template'>): DailyCategoryTarget {
  switch (card.template.proof) {
    case 'weekly_walks':
      return 'sport';
    case 'weekly_calls':
      return 'proches';
    default:
      return 'divers';
  }
}
