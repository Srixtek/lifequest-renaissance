import { spacing } from './theme';
import { SOURCE_TILE } from './pixelSprite';

/** Horizontal padding from `Screen` (`spacing.lg` each side). */
export const SCREEN_HORIZONTAL_PADDING = spacing.lg * 2;

const COLUMN_GAP = 6;
const HIT_TOP_RATIO = 0.34;
const HIT_HEIGHT_RATIO = 0.52;
const BUILDING_COLUMN_FILL = 0.82;

export type RectDp = { left: number; top: number; width: number; height: number };

export type ColumnSlot = { left: number; width: number; centerX: number };

export type KingdomSceneLayout = {
  screenWidth: number;
  sceneWidth: number;
  columnGap: number;
  columns: { combat: ColumnSlot; camp: ColumnSlot; forge: ColumnSlot };
  buildingSpriteDp: number;
  propSpriteDp: number;
  treeSpriteDp: number;
  hitboxes: { combat: RectDp; camp: RectDp; forge: RectDp };
};

export function sceneContentWidth(screenWidth: number): number {
  return Math.max(260, screenWidth - SCREEN_HORIZONTAL_PADDING);
}

/** Largest crisp size (16×N dp) that fits in a bastion column. */
export function crispBuildingSizeDp(columnWidth: number): number {
  const max = Math.floor(columnWidth * BUILDING_COLUMN_FILL);
  let chosen = SOURCE_TILE * 2;
  for (let mult = 2; mult <= 6; mult++) {
    const candidate = SOURCE_TILE * mult;
    if (candidate <= max) chosen = candidate;
  }
  return chosen;
}

function columnSlot(left: number, width: number): ColumnSlot {
  return { left, width, centerX: left + width / 2 };
}

export function computeKingdomSceneLayout(screenWidth: number, sceneHeight = 248): KingdomSceneLayout {
  const sceneWidth = sceneContentWidth(screenWidth);
  const colW = (sceneWidth - COLUMN_GAP * 2) / 3;
  const buildingSpriteDp = crispBuildingSizeDp(colW);
  const propSpriteDp = Math.round(buildingSpriteDp * 0.84);
  const treeSpriteDp = Math.round(buildingSpriteDp * 0.5);

  const combat = columnSlot(0, colW);
  const camp = columnSlot(colW + COLUMN_GAP, colW);
  const forge = columnSlot(2 * (colW + COLUMN_GAP), colW);

  const hitTop = sceneHeight * HIT_TOP_RATIO;
  const hitH = sceneHeight * HIT_HEIGHT_RATIO;

  return {
    screenWidth,
    sceneWidth,
    columnGap: COLUMN_GAP,
    columns: { combat, camp, forge },
    buildingSpriteDp,
    propSpriteDp,
    treeSpriteDp,
    hitboxes: {
      combat: { left: combat.left, top: hitTop, width: combat.width, height: hitH },
      camp: { left: camp.left, top: hitTop, width: camp.width, height: hitH },
      forge: { left: forge.left, top: hitTop, width: forge.width, height: hitH },
    },
  };
}

export function rectsOverlap(a: RectDp, b: RectDp): boolean {
  const aRight = a.left + a.width;
  const bRight = b.left + b.width;
  const aBottom = a.top + a.height;
  const bBottom = b.top + b.height;
  if (aRight <= b.left || bRight <= a.left) return false;
  if (aBottom <= b.top || bBottom <= a.top) return false;
  return true;
}

export function hitboxesAreDisjoint(layout: KingdomSceneLayout): boolean {
  const { combat, camp, forge } = layout.hitboxes;
  return !rectsOverlap(combat, camp) && !rectsOverlap(combat, forge) && !rectsOverlap(camp, forge);
}

/** Horizontal extent of a building centered in a column (for overlap checks with art). */
export function buildingSpan(layout: KingdomSceneLayout, slot: keyof KingdomSceneLayout['columns']): {
  left: number;
  right: number;
} {
  const col = layout.columns[slot];
  const half = layout.buildingSpriteDp / 2;
  return { left: col.centerX - half, right: col.centerX + half };
}

export function buildingSpansDisjoint(layout: KingdomSceneLayout): boolean {
  const a = buildingSpan(layout, 'combat');
  const b = buildingSpan(layout, 'camp');
  const c = buildingSpan(layout, 'forge');
  return a.right <= b.left && b.right <= c.left;
}