/** Forge du bastion — indépendante de camp_level. */
export const FORGE_BUILDING_ID = 'forge';
export const FORGE_MAX_LEVEL = 2;
export const FORGE_UPGRADE_COST: Record<1 | 2, number> = { 1: 10, 2: 20 };
export const FORGE_DAMAGE_PER_LEVEL = 1;

export const THORN_GUARDIAN_ID = 'thorn_guardian';
export const THORN_GUARDIAN_NAME = 'Gardien des Ronces';

export const HERO_BASE_HP = 28;
export const HERO_BASE_DAMAGE = 5;
export const ENEMY_BASE_HP = 24;
export const ENEMY_NORMAL_DAMAGE = 4;
export const ENEMY_POWER_DAMAGE = 8;
export const DEFEND_DAMAGE_FACTOR = 0.45;
export const GUARDIAN_DEFEND_FACTOR = 0.25;
export const SKILL_COOLDOWN_TURNS = 3;

export const FIRST_WIN_ITEM_ID = 'bastion_victory_banner';

export const FORGE_LEVEL_LABELS: Record<number, string> = {
  0: 'Forge abandonnée',
  1: 'Forge restaurée',
  2: 'Forge renforcée',
};