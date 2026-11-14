export interface MapNode {
  id: string;
  title: string;
  description: string;
  requiresItemEffect?: string;
  choices: Array<{ id: string; label: string; to: string; grantItem?: string; grantShards?: number; setFlag?: string }>;
}

export const MAP_NODES: Record<string, MapNode> = {
  camp_gate: {
    id: 'camp_gate',
    title: 'Porte du camp',
    description: 'Le campement d\'Eloria s\'éveille. Un sentier part vers la brume.',
    choices: [
      { id: 'to_path', label: 'Suivre le sentier', to: 'mist_edge' },
      { id: 'stay', label: 'Rester au camp', to: 'camp_gate' },
    ],
  },
  mist_edge: {
    id: 'mist_edge',
    title: 'Lisière brumeuse',
    description: 'La brume cache un passage. Une lanterne aiderait.',
    choices: [
      { id: 'back', label: 'Revenir au camp', to: 'camp_gate' },
      { id: 'enter', label: 'Tenter le passage', to: 'hidden_grove' },
    ],
  },
  hidden_grove: {
    id: 'hidden_grove',
    title: 'Clairière voilée',
    description: 'Sans lumière, tu n\'aperçois que des formes. Équipe la lanterne pour voir.',
    requiresItemEffect: 'reveal_mist_path',
    choices: [
      { id: 'back', label: 'Revenir', to: 'mist_edge' },
      { id: 'gather', label: 'Cueillir des herbes', to: 'hidden_grove', grantItem: 'herb_pouch', grantShards: 1, setFlag: 'grove_gathered' },
      { id: 'kit', label: 'Récupérer un kit de camp', to: 'hidden_grove', grantItem: 'camp_kit', grantShards: 2, setFlag: 'found_camp_kit' },
    ],
  },
};
