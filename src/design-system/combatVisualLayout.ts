/** Pure responsive geometry, based on the actual inner combat stage width. */
export function computeCombatVisualLayout(sceneWidth: number) {
  if (!Number.isFinite(sceneWidth) || sceneWidth <= 0) throw new Error('Invalid combat scene width');
  const fighterSize = Math.max(60, Math.min(90, Math.floor(sceneWidth * 0.34)));
  const stageHeight = fighterSize + 72;
  return { sceneWidth, fighterSize, stageHeight, requiredHorizontalSpace: fighterSize * 2 + 48 };
}
