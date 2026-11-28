import type { DailyQuestCard } from './dailyQuestService';

export type DailyCategoryTarget = 'sport' | 'proches' | 'divers';

export type DailyOpenRoute =
  | { kind: 'category'; target: DailyCategoryTarget }
  | { kind: 'adventure'; tab: 'quests'; instanceId?: string };

/** Où envoyer le joueur depuis « Aller à l'activité » (chrono respiration → carte Aventure ciblée). */
export function resolveDailyOpenRoute(card: DailyQuestCard): DailyOpenRoute {
  switch (card.template.proof) {
    case 'sport_session':
      return { kind: 'category', target: 'sport' };
    case 'proches_call':
      return { kind: 'category', target: 'proches' };
    case 'divers_activity':
      return { kind: 'category', target: 'divers' };
    case 'breathing_timer':
      return { kind: 'adventure', tab: 'quests', instanceId: card.instanceId ?? undefined };
    default:
      return { kind: 'adventure', tab: 'quests' };
  }
}