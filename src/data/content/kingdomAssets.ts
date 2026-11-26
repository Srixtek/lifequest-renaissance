import type { ClassId } from '../../domain/models/types';
import type { ImageSourcePropType } from 'react-native';
import type { EnemyId } from './kingdom';

/** Kenney CC0 sprites embarqués — voir docs/ART_CREDITS.md */
export const KENNEY = {
  terrainGrass: require('../../../assets/kingdom/kenney/terrain_grass.png'),
  terrainPath: require('../../../assets/kingdom/kenney/terrain_path.png'),
  terrainTree: require('../../../assets/kingdom/kenney/terrain_tree.png'),
  buildingCamp: require('../../../assets/kingdom/kenney/building_camp.png'),
  buildingWall: require('../../../assets/kingdom/kenney/building_wall.png'),
  forgeAnvil: require('../../../assets/kingdom/kenney/forge_anvil.png'),
  arenaFloor: require('../../../assets/kingdom/kenney/arena_floor.png'),
  combatBackdrop: require('../../../assets/kingdom/kenney/combat_backdrop.png'),
  heroRanger: require('../../../assets/kingdom/kenney/hero_ranger.png'),
  heroGuardian: require('../../../assets/kingdom/kenney/hero_guardian.png'),
  heroSage: require('../../../assets/kingdom/kenney/hero_sage.png'),
  heroArtisan: require('../../../assets/kingdom/kenney/hero_artisan.png'),
  enemyThorn: require('../../../assets/kingdom/kenney/enemy_thorn_guardian.png'),
  enemyWolf: require('../../../assets/kingdom/kenney/enemy_mist_wolf.png'),
} as const;

export function heroSprite(classId: ClassId): ImageSourcePropType {
  switch (classId) {
    case 'rodeur':
      return KENNEY.heroRanger;
    case 'gardien':
      return KENNEY.heroGuardian;
    case 'sage':
      return KENNEY.heroSage;
    case 'artisan':
      return KENNEY.heroArtisan;
    default:
      return KENNEY.heroRanger;
  }
}

export function enemySprite(enemyId: EnemyId): ImageSourcePropType {
  return enemyId === 'mist_wolf' ? KENNEY.enemyWolf : KENNEY.enemyThorn;
}

export const QUEST_EMBLEM: Record<string, ImageSourcePropType> = {
  first_confirm: KENNEY.buildingCamp,
  breathe_once: KENNEY.heroSage,
  time_tamed: KENNEY.terrainPath,
  explore_grove: KENNEY.terrainTree,
};