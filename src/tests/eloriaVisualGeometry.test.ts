import {
  buildingSpansDisjoint,
  computeKingdomSceneLayout,
  computeKingdomSceneLayoutFromWidth,
  hitboxesAreDisjoint,
} from '../design-system/kingdomSceneLayout';
import { bastionSceneGeometry } from '../design-system/art/bastionSceneGeometry';
import { computeCombatVisualLayout } from '../design-system/combatVisualLayout';

const WIDTHS = [320, 360, 400];

describe.each(WIDTHS)('007A-R: screen %i dp', (screenWidth) => {
  const sceneHeight = 268;
  const layout = computeKingdomSceneLayout(screenWidth, sceneHeight);
  const geo = bastionSceneGeometry(layout.sceneWidth, sceneHeight);

  it('maps SVG exactly to scene pixels, without viewBox crop/stretch', () => {
    expect(geo.width).toBe(layout.sceneWidth);
    expect(geo.height).toBe(sceneHeight);
    expect(geo.viewBox).toBe(`0 0 ${layout.sceneWidth} ${sceneHeight}`);
    expect(computeKingdomSceneLayoutFromWidth(layout.sceneWidth, sceneHeight).hitboxes).toEqual(layout.hitboxes);
  });

  it('centers each drawn building inside its clickable column', () => {
    for (const key of ['combat', 'camp', 'forge'] as const) {
      const drawingCenterX = layout.columns[key].centerX;
      const hit = layout.hitboxes[key];
      expect(drawingCenterX).toBeCloseTo(hit.left + hit.width / 2, 5);
      expect(drawingCenterX).toBeGreaterThan(0);
      expect(drawingCenterX).toBeLessThan(layout.sceneWidth);
      expect(geo.labelY).toBeGreaterThan(0);
      expect(geo.labelY + 2).toBeLessThan(sceneHeight);
      expect(geo.labelY).toBeLessThanOrEqual(hit.top + hit.height);
      expect(geo.groundY - 48).toBeGreaterThan(hit.top);
    }
  });

  it('has disjoint art spans and hitboxes', () => {
    expect(buildingSpansDisjoint(layout)).toBe(true);
    expect(hitboxesAreDisjoint(layout)).toBe(true);
  });

  it('fits the two combat characters in a plausible mobile stage', () => {
    const innerStageWidth = screenWidth - 48 - 32 - 4;
    const combat = computeCombatVisualLayout(innerStageWidth);
    expect(combat.fighterSize).toBeGreaterThanOrEqual(72);
    expect(combat.fighterSize).toBeLessThanOrEqual(90);
    expect(combat.requiredHorizontalSpace).toBeLessThanOrEqual(innerStageWidth);
    expect(combat.stageHeight).toBeLessThan(200);
  });
});
