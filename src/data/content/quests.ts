export type QuestProofKind =
  | 'habit_declaration'
  | 'breathing_session'
  | 'time_challenge'
  | 'reach_node';

export interface QuestDef {
  id: string;
  title: string;
  description: string;
  objective: string;
  /** Or fixe, versé une seule fois à la réclamation. Aucune XP ni éclat. */
  rewardGold: number;
  proof: QuestProofKind;
  /** Nœud de carte à atteindre (proof === 'reach_node'). */
  targetNode?: string;
  /**
   * Quête mise hors service : plus jamais proposée ni comptée dans le carnet. Si elle était déjà
   * réclamée, elle reste visible dans l'historique ; si elle était acceptée et déjà prête, elle reste
   * réclamable (or légitimement gagné). Jamais supprimée de la base.
   */
  retired?: boolean;
}

export const MAX_ACCEPTED_QUESTS = 3;

export const QUESTS: QuestDef[] = [
  {
    id: 'first_confirm',
    title: 'Première vérité',
    description:
      'Dire honnêtement où tu en es compte déjà. Réussite, partiel ou écart : toute déclaration sincère ouvre la voie.',
    objective: 'Déclarer une habitude (réussie, partielle ou écart) après avoir accepté la quête.',
    rewardGold: 10,
    proof: 'habit_declaration',
  },
  {
    id: 'breathe_once',
    title: "Souffle d'Eloria",
    description: "Prends un moment pour respirer avec le camp, sans te presser.",
    objective: 'Terminer une séance de respiration jusqu\'au bout (démarrée après l\'acceptation).',
    rewardGold: 10,
    proof: 'breathing_session',
  },
  {
    id: 'time_tamed',
    title: 'Le temps apprivoisé',
    description: 'Le temps t\'appartient : bouge un peu, ou pose les écrans un moment.',
    objective:
      'Terminer une session de sport avec durée confirmée, OU un défi sans écran déclaré respecté (démarré après l\'acceptation).',
    rewardGold: 15,
    proof: 'time_challenge',
  },
  {
    id: 'explore_grove',
    title: 'Au-delà de la brume',
    description: 'Un sentier se perd dans la brume. Quand tu seras prêt, va voir ce qui t\'attend derrière.',
    objective: 'Atteindre la Clairière voilée (hidden_grove) depuis la Lisière brumeuse, après l\'acceptation.',
    rewardGold: 20,
    proof: 'reach_node',
    targetNode: 'hidden_grove',
    retired: true,
  },
];

export const ACTIVE_QUESTS: QuestDef[] = QUESTS.filter((q) => !q.retired);
export const RETIRED_QUEST_IDS: string[] = QUESTS.filter((q) => q.retired).map((q) => q.id);

export const QUEST_BY_ID: Record<string, QuestDef> = Object.fromEntries(QUESTS.map((q) => [q.id, q]));

/** Étapes concrètes affichées sur la carte quand la quête est disponible ou en cours. */
export const QUEST_HOW_TO: Record<string, string> = {
  first_confirm:
    'Accepter la quête, puis ouvre Habitudes et déclare une habitude (réussite, partiel ou écart).',
  breathe_once:
    'Accepter la quête, puis Camp → Respiration (ou outil Respiration) et termine la séance jusqu\'au bout.',
  time_tamed:
    'Accepter la quête, puis lance un défi chronométré (sport ou sans écran) depuis les outils du camp.',
  explore_grove:
    'Quête historique : l\'Ancien sentier n\'est plus accessible.',
};
