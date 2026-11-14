export interface QuestDef {
  id: string;
  title: string;
  description: string;
  rewardShards: number;
}

export const QUESTS: QuestDef[] = [
  {
    id: 'first_confirm',
    title: 'Première vérité',
    description: 'Confirmer honnêtement au moins un objectif aujourd\'hui.',
    rewardShards: 2,
  },
  {
    id: 'breathe_once',
    title: 'Souffle du matin',
    description: 'Terminer une session de respiration.',
    rewardShards: 2,
  },
  {
    id: 'explore_grove',
    title: 'Au-delà de la brume',
    description: 'Équiper la lanterne et atteindre la clairière voilée.',
    rewardShards: 3,
  },
];
