export interface ItemDef {
  id: string;
  name: string;
  description: string;
  slot: 'hand' | 'body' | 'trinket' | null;
  usefulEffect: string | null;
}

export const ITEMS: Record<string, ItemDef> = {
  lantern: {
    id: 'lantern',
    name: 'Lanterne d\'Eloria',
    description: 'Une flamme douce qui révèle les sentiers brumeux.',
    slot: 'hand',
    usefulEffect: 'reveal_mist_path',
  },
  camp_kit: {
    id: 'camp_kit',
    name: 'Kit de campement',
    description: 'Toile, corde et pierre à feu pour améliorer le camp.',
    slot: null,
    usefulEffect: 'camp_upgrade',
  },
  herb_pouch: {
    id: 'herb_pouch',
    name: 'Sacoche d\'herbes',
    description: 'Herbes calmantes pour les pauses respiration.',
    slot: 'trinket',
    usefulEffect: null,
  },
  bastion_victory_banner: {
    id: 'bastion_victory_banner',
    name: 'Bannière du Premier Bastion',
    description: 'Trophée remporté en repoussant le Gardien des Ronces.',
    slot: null,
    usefulEffect: null,
  },
  forest_mist_emblem: {
    id: 'forest_mist_emblem',
    name: 'Emblème de la Forêt des Brumes',
    description: 'Trophée du Souverain des Brumes — campagne d\'Eloria.',
    slot: null,
    usefulEffect: null,
  },
};

export const STARTER_ITEM_ID = 'lantern';
