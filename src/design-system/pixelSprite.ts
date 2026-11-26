/** Kenney tiles are 16×16 px — scale by integer steps for crisp RN display (no bilinear stretch). */
export const SOURCE_TILE = 16;
export const PIXEL_UNIT = 3;

/** Display size in dp for a 16×16 source sprite at the given logical scale (1 = 48 dp). */
export function pixelDim(scale = 1): number {
  return Math.round(SOURCE_TILE * PIXEL_UNIT * scale);
}