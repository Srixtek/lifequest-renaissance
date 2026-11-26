/** Kenney tiles are 16×16 px. Bastion buildings use `kingdomSceneLayout` (16×N dp). */
export const SOURCE_TILE = 16;
export const PIXEL_UNIT = 3;

/** Display size in dp for combat UI sprites (legacy scale = 48 dp at 1.0). */
export function pixelDim(scale = 1): number {
  return Math.round(SOURCE_TILE * PIXEL_UNIT * scale);
}