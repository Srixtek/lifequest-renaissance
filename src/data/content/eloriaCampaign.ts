import type { EnemyDef } from './kingdom';

export const ELORIA_CAMPAIGN_ZONE = 'La Forêt des Brumes';
export const CAMPAIGN_TROPHY_ITEM_ID = 'forest_mist_emblem';
export const CAMPAIGN_TROPHY_NAME = 'Emblème de la Forêt des Brumes';

export const CAMPAIGN_STAGE_GOLD = 3;
export const CAMPAIGN_BOSS_GOLD = 15;

export function campaignFirstWinKey(stageId: string): string {
  return `campaign:stage:${stageId}:first_win`;
}

export interface CampaignStageDef {
  id: string;
  number: number;
  name: string;
  description: string;
  enemyId: string;
  archetype: string;
  difficulty: 'facile' | 'normal' | 'élevé' | 'boss';
  firstWinGold: number;
}

/** Ennemis dédiés à la campagne (ids stables, distincts de l'arène historique). */
export const CAMPAIGN_ENEMY_IDS = [
  'forest_mossling',
  'forest_thornscout',
  'forest_mistwisp',
  'forest_barkguard',
  'forest_howler',
  'forest_rootbinder',
  'forest_gloomstalker',
  'forest_fogwarden',
  'forest_ancientbramble',
  'forest_mist_sovereign',
] as const;

export type CampaignEnemyId = (typeof CAMPAIGN_ENEMY_IDS)[number];

export interface BossPhaseShift {
  hpRatio: number;
  intentPattern: ReadonlyArray<'normal' | 'heavy' | 'brace'>;
  announceLog: string;
}

export type CampaignEnemyDef = EnemyDef & { bossPhaseShift?: BossPhaseShift };

export const CAMPAIGN_ENEMY_DEFS: Record<CampaignEnemyId, CampaignEnemyDef> = {
  forest_mossling: {
    id: 'forest_mossling',
    name: 'Mousse rampante',
    baseHp: 18,
    normalDamage: 3,
    heavyDamage: 6,
    intentPattern: ['normal', 'normal', 'heavy'],
  },
  forest_thornscout: {
    id: 'forest_thornscout',
    name: 'Éclaireur épineux',
    baseHp: 20,
    normalDamage: 3,
    heavyDamage: 7,
    intentPattern: ['normal', 'brace', 'heavy', 'normal'],
  },
  forest_mistwisp: {
    id: 'forest_mistwisp',
    name: 'Feu follet',
    baseHp: 19,
    normalDamage: 4,
    heavyDamage: 7,
    intentPattern: ['heavy', 'normal', 'normal', 'brace'],
  },
  forest_barkguard: {
    id: 'forest_barkguard',
    name: 'Garde d’écorce',
    baseHp: 24,
    normalDamage: 3,
    heavyDamage: 6,
    intentPattern: ['brace', 'brace', 'normal', 'heavy'],
  },
  forest_howler: {
    id: 'forest_howler',
    name: 'Hurleur des brumes',
    baseHp: 22,
    normalDamage: 5,
    heavyDamage: 9,
    intentPattern: ['normal', 'heavy', 'normal', 'heavy'],
  },
  forest_rootbinder: {
    id: 'forest_rootbinder',
    name: 'Lieur de racines',
    baseHp: 25,
    normalDamage: 4,
    heavyDamage: 8,
    intentPattern: ['normal', 'brace', 'heavy', 'brace'],
  },
  forest_gloomstalker: {
    id: 'forest_gloomstalker',
    name: 'Traqueur sombre',
    baseHp: 26,
    normalDamage: 5,
    heavyDamage: 9,
    intentPattern: ['heavy', 'normal', 'brace', 'heavy'],
  },
  forest_fogwarden: {
    id: 'forest_fogwarden',
    name: 'Veilleur de brume',
    baseHp: 27,
    normalDamage: 4,
    heavyDamage: 8,
    intentPattern: ['brace', 'normal', 'heavy', 'normal', 'heavy'],
  },
  forest_ancientbramble: {
    id: 'forest_ancientbramble',
    name: 'Roncière ancienne',
    baseHp: 30,
    normalDamage: 5,
    heavyDamage: 10,
    intentPattern: ['normal', 'heavy', 'brace', 'heavy', 'normal'],
  },
  forest_mist_sovereign: {
    id: 'forest_mist_sovereign',
    name: 'Souverain des Brumes',
    baseHp: 18,
    normalDamage: 3,
    heavyDamage: 6,
    intentPattern: ['normal', 'heavy', 'brace', 'normal'],
    bossPhaseShift: {
      hpRatio: 0.45,
      intentPattern: ['normal', 'heavy', 'brace', 'heavy'],
      announceLog:
        'Le Souverain des Brumes change de rythme — il enchaîne désormais frappe lourde et bris d’élan !',
    },
  },
};

export const ELORIA_CAMPAIGN_STAGES: CampaignStageDef[] = [
  {
    id: 'eloria_forest_01',
    number: 1,
    name: 'Sentier couvert',
    description: 'Une mousse agressive barre le chemin.',
    enemyId: 'forest_mossling',
    archetype: 'attaquant classique',
    difficulty: 'facile',
    firstWinGold: CAMPAIGN_STAGE_GOLD,
  },
  {
    id: 'eloria_forest_02',
    number: 2,
    name: 'Fourré d’épines',
    description: 'Un éclaireur guette entre les buissons.',
    enemyId: 'forest_thornscout',
    archetype: 'défensif',
    difficulty: 'facile',
    firstWinGold: CAMPAIGN_STAGE_GOLD,
  },
  {
    id: 'eloria_forest_03',
    number: 3,
    name: 'Clairière brumeuse',
    description: 'Un feu follet zigzague dans la brume.',
    enemyId: 'forest_mistwisp',
    archetype: 'agressif',
    difficulty: 'normal',
    firstWinGold: CAMPAIGN_STAGE_GOLD,
  },
  {
    id: 'eloria_forest_04',
    number: 4,
    name: 'Tronc blindé',
    description: 'Un gardien d’écorce encaisse chaque coup.',
    enemyId: 'forest_barkguard',
    archetype: 'défensif',
    difficulty: 'normal',
    firstWinGold: CAMPAIGN_STAGE_GOLD,
  },
  {
    id: 'eloria_forest_05',
    number: 5,
    name: 'Vallée des échos',
    description: 'Les hurlements annoncent une embuscade.',
    enemyId: 'forest_howler',
    archetype: 'agressif',
    difficulty: 'normal',
    firstWinGold: CAMPAIGN_STAGE_GOLD,
  },
  {
    id: 'eloria_forest_06',
    number: 6,
    name: 'Racines enchevêtrées',
    description: 'Des racines tentent de t’immobiliser.',
    enemyId: 'forest_rootbinder',
    archetype: 'technique',
    difficulty: 'normal',
    firstWinGold: CAMPAIGN_STAGE_GOLD,
  },
  {
    id: 'eloria_forest_07',
    number: 7,
    name: 'Sous-bois obscur',
    description: 'Une silhouette fond dans l’ombre.',
    enemyId: 'forest_gloomstalker',
    archetype: 'agressif',
    difficulty: 'élevé',
    firstWinGold: CAMPAIGN_STAGE_GOLD,
  },
  {
    id: 'eloria_forest_08',
    number: 8,
    name: 'Lisière voilée',
    description: 'Le veilleur contrôle la brume autour de toi.',
    enemyId: 'forest_fogwarden',
    archetype: 'défensif',
    difficulty: 'élevé',
    firstWinGold: CAMPAIGN_STAGE_GOLD,
  },
  {
    id: 'eloria_forest_09',
    number: 9,
    name: 'Antre des ronces',
    description: 'La roncière ancienne protège l’approche du trône.',
    enemyId: 'forest_ancientbramble',
    archetype: 'technique',
    difficulty: 'élevé',
    firstWinGold: CAMPAIGN_STAGE_GOLD,
  },
  {
    id: 'eloria_forest_10',
    number: 10,
    name: 'Trône de brume',
    description: 'Le Souverain des Brumes règne sur la forêt.',
    enemyId: 'forest_mist_sovereign',
    archetype: 'boss',
    difficulty: 'boss',
    firstWinGold: CAMPAIGN_BOSS_GOLD,
  },
];

export function stageById(stageId: string): CampaignStageDef | undefined {
  return ELORIA_CAMPAIGN_STAGES.find((s) => s.id === stageId);
}

export function stageByNumber(n: number): CampaignStageDef | undefined {
  return ELORIA_CAMPAIGN_STAGES.find((s) => s.number === n);
}