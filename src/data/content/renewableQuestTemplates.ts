import type { ChallengeType } from '@/src/domain/models/challengeSession';
import type { EnemyId } from './kingdom';

export type RenewableQuestCategory = 'habitudes' | 'royaume' | 'exploits' | 'legendes';

export type RenewableProofKind =
  | 'habit_declaration'
  | 'breathing_timer'
  | 'inline_challenge'
  | 'combat_victory'
  | 'forge_upgrade'
  | 'adaptive_vape_complete';

export interface RenewableQuestTemplate {
  id: string;
  category: Exclude<RenewableQuestCategory, 'legendes'>;
  title: string;
  description: string;
  objective: string;
  rewardGold: number;
  proof: RenewableProofKind;
  difficulty: 'facile' | 'normal' | 'engagé';
  durationLabel: string;
  nextStep: string;
  challengeType?: ChallengeType;
  targetDurationSec?: number;
  targetEnemyId?: EnemyId;
  requiresGoalTemplateId?: string;
  requiresForgeLevelAtLeast?: number;
  sensitive?: boolean;
}

export const RENEWABLE_GOLD_DAILY_CAP = 50;
export const MAX_ACTIVE_RENEWABLE = 3;
export const MAX_RECOMMENDED_OFFERS = 3;

export const RENEWABLE_TEMPLATES: RenewableQuestTemplate[] = [
  {
    id: 'rnw_declare_habit',
    category: 'habitudes',
    title: 'Vérité du jour',
    description: 'Une déclaration honnête sur une habitude suffit à avancer.',
    objective: 'Déclarer une habitude (réussite, partiel ou écart) après acceptation.',
    rewardGold: 8,
    proof: 'habit_declaration',
    difficulty: 'facile',
    durationLabel: '~2 min',
    nextStep: 'Habitudes → déclarer ton suivi du jour.',
  },
  {
    id: 'rnw_breathe_3',
    category: 'habitudes',
    title: 'Souffle de 3 minutes',
    description: 'Pose l\'écran, respire avec Eloria trois minutes complètes.',
    objective: 'Terminer 3 min de respiration guidée depuis la carte.',
    rewardGold: 10,
    proof: 'breathing_timer',
    difficulty: 'facile',
    durationLabel: '3 min',
    nextStep: 'Démarrer le chrono sur la carte, puis « Succès » à l\'objectif.',
    targetDurationSec: 180,
  },
  {
    id: 'rnw_sport_20',
    category: 'habitudes',
    title: 'Corps en mouvement',
    description: 'Bouge vingt minutes — marche, étirements ou sport léger.',
    objective: 'Chronométrer 20 min d\'activité physique confirmées.',
    rewardGold: 12,
    proof: 'inline_challenge',
    challengeType: 'sport',
    targetDurationSec: 1200,
    difficulty: 'engagé',
    durationLabel: '20 min',
    nextStep: 'Lancer le chrono sport sur la carte.',
  },
  {
    id: 'rnw_no_screen_30',
    category: 'habitudes',
    title: 'Écran en pause',
    description: 'Trente minutes sans écran volontaire — lecture, marche, silence.',
    objective: 'Tenir 30 min sans écran (chrono sur la carte).',
    rewardGold: 12,
    proof: 'inline_challenge',
    challengeType: 'no_screen',
    targetDurationSec: 1800,
    difficulty: 'normal',
    durationLabel: '30 min',
    nextStep: 'Démarrer le défi sans écran depuis la carte.',
  },
  {
    id: 'rnw_vape_delay',
    category: 'habitudes',
    title: 'Intervalle vape',
    description: 'Repousser la prochaine session : le défi adaptatif du camp.',
    objective: 'Réussir un défi vape adaptatif après acceptation.',
    rewardGold: 10,
    proof: 'adaptive_vape_complete',
    requiresGoalTemplateId: 'vape_sessions',
    sensitive: true,
    difficulty: 'normal',
    durationLabel: 'variable',
    nextStep: 'Camp → défi vape adaptatif, puis reviens réclamer.',
  },
  {
    id: 'rnw_active_habit',
    category: 'habitudes',
    title: 'Habitude active',
    description: 'Confirme une habitude que tu suis déjà.',
    objective: 'Déclarer une habitude active après acceptation.',
    rewardGold: 8,
    proof: 'habit_declaration',
    difficulty: 'facile',
    durationLabel: '~2 min',
    nextStep: 'Habitudes → une déclaration sincère.',
  },
  {
    id: 'rnw_beat_thorn',
    category: 'royaume',
    title: 'Gardien des épines',
    description: 'Affronte le Gardien des épines à l\'arène du bastion.',
    objective: 'Remporter une victoire contre le Gardien après acceptation.',
    rewardGold: 15,
    proof: 'combat_victory',
    targetEnemyId: 'thorn_guardian',
    difficulty: 'normal',
    durationLabel: '~5 min',
    nextStep: 'Bastion → Arène, choisir le Gardien, gagner.',
  },
  {
    id: 'rnw_beat_wolf',
    category: 'royaume',
    title: 'Loup des brumes',
    description: 'Traque le Loup des brumes dans l\'arène.',
    objective: 'Victoire contre le Loup après acceptation.',
    rewardGold: 18,
    proof: 'combat_victory',
    targetEnemyId: 'mist_wolf',
    difficulty: 'engagé',
    durationLabel: '~8 min',
    nextStep: 'Bastion → Arène → Loup des brumes.',
  },
  {
    id: 'rnw_forge_upgrade',
    category: 'royaume',
    title: 'Étincelle à la forge',
    description: 'Investis ton or pour renforcer la forge du bastion.',
    objective: 'Améliorer la forge après avoir accepté la quête.',
    rewardGold: 10,
    proof: 'forge_upgrade',
    difficulty: 'normal',
    durationLabel: '—',
    nextStep: 'Bastion → Forge → confirmer l\'amélioration.',
  },
  {
    id: 'rnw_sport_quick',
    category: 'exploits',
    title: 'Sprint d\'élan',
    description: 'Dix minutes de mouvement pour relancer la journée.',
    objective: 'Sport chronométré 10 min confirmées sur la carte.',
    rewardGold: 8,
    proof: 'inline_challenge',
    challengeType: 'sport',
    targetDurationSec: 600,
    difficulty: 'facile',
    durationLabel: '10 min',
    nextStep: 'Chrono sport intégré sur la carte.',
  },
  {
    id: 'rnw_breathe_calm',
    category: 'exploits',
    title: 'Minute de calme',
    description: 'Une minute de respiration pour te recentrer.',
    objective: '1 min de respiration terminée via le chrono carte.',
    rewardGold: 6,
    proof: 'breathing_timer',
    targetDurationSec: 60,
    difficulty: 'facile',
    durationLabel: '1 min',
    nextStep: 'Démarrer le chrono respiration sur la carte.',
  },
  {
    id: 'rnw_screenless_short',
    category: 'exploits',
    title: 'Détox courte',
    description: 'Quinze minutes loin des écrans.',
    objective: '15 min sans écran via chrono carte.',
    rewardGold: 8,
    proof: 'inline_challenge',
    challengeType: 'no_screen',
    targetDurationSec: 900,
    difficulty: 'facile',
    durationLabel: '15 min',
    nextStep: 'Lancer le chrono sans écran.',
  },
];

export const RENEWABLE_BY_ID: Record<string, RenewableQuestTemplate> = Object.fromEntries(
  RENEWABLE_TEMPLATES.map((t) => [t.id, t]),
);

export const CATEGORY_LABELS: Record<RenewableQuestCategory, string> = {
  habitudes: 'Habitudes',
  royaume: 'Royaume',
  exploits: 'Exploits',
  legendes: 'Légendes',
};