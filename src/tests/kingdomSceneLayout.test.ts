import {
  buildingSpansDisjoint,
  computeKingdomSceneLayout,
  crispBuildingSizeDp,
  hitboxesAreDisjoint,
  sceneContentWidth,
  SCREEN_HORIZONTAL_PADDING,
} from '../design-system/kingdomSceneLayout';
import { SOURCE_TILE } from '../design-system/pixelSprite';

describe('kingdomSceneLayout', () => {
  it('sceneContentWidth subtracts screen horizontal padding', () => {
    expect(SCREEN_HORIZONTAL_PADDING).toBe(48);
    expect(sceneContentWidth(320)).toBe(272);
    expect(sceneContentWidth(360)).toBe(312);
  });

  it('crispBuildingSizeDp snaps to 16×N dp within column budget', () => {
    expect(computeKingdomSceneLayout(320).buildingSpriteDp).toBe(64);
    expect(computeKingdomSceneLayout(360).buildingSpriteDp).toBe(80);
    expect(crispBuildingSizeDp(40)).toBe(SOURCE_TILE * 2);
  });

  describe.each([320, 360])('viewport %idp', (screenWidth) => {
    it('fits building sprites inside column width', () => {
      const layout = computeKingdomSceneLayout(screenWidth);
      for (const key of ['combat', 'camp', 'forge'] as const) {
        const col = layout.columns[key];
        expect(layout.buildingSpriteDp).toBeLessThanOrEqual(col.width);
        expect(layout.buildingSpriteDp % SOURCE_TILE).toBe(0);
      }
    });

    it('keeps hitboxes disjoint', () => {
      const layout = computeKingdomSceneLayout(screenWidth);
      expect(hitboxesAreDisjoint(layout)).toBe(true);
    });

    it('keeps centered building art disjoint horizontally', () => {
      const layout = computeKingdomSceneLayout(screenWidth);
      expect(buildingSpansDisjoint(layout)).toBe(true);
    });
  });
});