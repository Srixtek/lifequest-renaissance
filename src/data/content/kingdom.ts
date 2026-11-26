/** Forge du bastion — indépendante de camp_level. */
export const FORGE_BUILDING_ID = 'forge';
export const FORGE_MAX_LEVEL = 2;
export const FORGE_UPGRADE_COST: Record<1 | 2, number> = { 1: 10, 2: 20 };
export const FORGE_DAMAGE_PER_LEVEL = 1;

export const THORN_GUARDIAN_ID = 'thorn_guardian';
export const THORN_GUARDIAN_NAME = 'Gardien des Ronces';
export const MIST_WOLF_ID = 'mist_wolf';
export const MIST_WOLF_NAME = 'Loup des Brumes';

export type EnemyId = typeof THORN_GUARDIAN_ID | typeof MIST_WOLF_ID;

export const CONCENTRATION_MAX = 3;
export const CONCENTRATION_START = 1;
export const SKILL_CONCENTRATION_COST = 2;
export const DEFEND_CONCENTRATION_GAIN = 1;

export const HERO_BASE_HP = 28;
export const HERO_BASE_DAMAGE = 5;

export const DEFEND_DAMAGE_FACTOR = 0.45;
export const GUARDIAN_DEFEND_FACTOR = 0.25;
/** Atténuation quand l'ennemi se prépare (brace). */
export const ENEMY_BRACE_DAMAGE_FACTOR = 0.35;
export const ENEMY_BRACE_CHIP_DAMAGE = 1;

export interface EnemyDef {
  id: EnemyId;
  name: string;
  baseHp: number;
  normalDamage: number;
  heavyDamage: number;
  intentPattern: ReadonlyArray<'normal' | 'heavy' | 'brace'>;
}

export const ENEMY_DEFS: Record<EnemyId, EnemyDef> = {
  [THORN_GUARDIAN_ID]: {
    id: THORN_GUARDIAN_ID,
    name: THORN_GUARDIAN_NAME,
    baseHp: 24,
    normalDamage: 4,
    heavyDamage: 8,
    intentPattern: ['normal', 'heavy', 'brace', 'normal'],
  },
  [MIST_WOLF_ID]: {
    id: MIST_WOLF_ID,
    name: MIST_WOLF_NAME,
    baseHp: 18,
    normalDamage: 3,
    heavyDamage: 6,
    intentPattern: ['normal', 'normal', 'heavy', 'normal'],
  },
};

export const FIRST_WIN_ITEM_ID = 'bastion_victory_banner';

export const FORGE_LEVEL_LABELS: Record<number, string> = {
  0: 'Forge abandonnée',
  1: 'Forge restaurée',
  2: 'Forge renforcée',
};

/** Intentions héritées de 006A — « power » migré en « heavy ». */
export function normalizeEnemyIntent(raw: string): 'normal' | 'heavy' | 'brace' {
  if (raw === 'power' || raw === 'heavy') return 'heavy';
  if (raw === 'brace' || raw === 'defend') return 'brace';
  return 'normal';
}