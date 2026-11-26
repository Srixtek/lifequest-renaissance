/** Shared real-unit SVG geometry for the KingdomScene 2D art. */
export function bastionSceneGeometry(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 90) {
    throw new Error('Invalid bastion scene dimensions');
  }
  return {
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    groundY: height - 62,
    labelY: height - 18,
    labelFontSize: 11,
  };
}
