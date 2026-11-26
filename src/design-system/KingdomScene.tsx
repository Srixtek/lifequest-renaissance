import React, { useMemo } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ImageSourcePropType,
  type ImageStyle,
} from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { KENNEY } from '../data/content/kingdomAssets';
import { computeKingdomSceneLayout } from './kingdomSceneLayout';
import { colors, spacing, typography } from './theme';

export type KingdomZone = 'forge' | 'combat' | 'forest' | 'camp';

type Props = {
  forgeLevel: number;
  onZone: (zone: KingdomZone) => void;
  height?: number;
};

const GROUND_TILE = 26;
const GROUND_ROW_H = 32;

export function KingdomScene({ forgeLevel, onZone, height = 248 }: Props) {
  const { width: screenWidth } = useWindowDimensions();
  const layout = useMemo(() => computeKingdomSceneLayout(screenWidth, height), [screenWidth, height]);
  const { buildingSpriteDp, propSpriteDp, treeSpriteDp, columns, hitboxes } = layout;

  const forgeGlow = forgeLevel >= 2 ? colors.goldBright : forgeLevel >= 1 ? colors.gold : colors.muted;
  const forgeOpacity = forgeLevel === 0 ? 0.82 : 1;
  const emberStrength = forgeLevel >= 2 ? 1 : forgeLevel >= 1 ? 0.75 : 0;
  const emberSize = Math.round(propSpriteDp * 0.55);

  const centerAt = (centerX: number, bottom: number, children: React.ReactNode) => (
    <View
      style={{
        position: 'absolute',
        left: centerX,
        bottom,
        transform: [{ translateX: -buildingSpriteDp / 2 }],
        width: buildingSpriteDp,
        alignItems: 'center',
      }}
    >
      {children}
    </View>
  );

  return (
    <View style={[styles.wrap, { height }]} accessibilityRole="image" accessibilityLabel="Bastion d'Eloria">
      <View style={[StyleSheet.absoluteFill, styles.groundRow, { height: GROUND_ROW_H }]}>
        {Array.from({ length: 12 }).map((_, i) => (
          <Image
            key={`g${i}`}
            source={i % 5 === 0 ? KENNEY.terrainPath : KENNEY.terrainGrass}
            style={{ width: GROUND_TILE, height: GROUND_TILE, opacity: i % 2 === 0 ? 0.92 : 0.78 }}
          />
        ))}
      </View>
      <Svg width="100%" height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <LinearGradient id="skyB" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#12262A" />
            <Stop offset="1" stopColor={colors.bg} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height={height * 0.52} fill="url(#skyB)" />
      </Svg>

      <View style={{ position: 'absolute', left: 4, bottom: height * 0.26, opacity: 0.85 }}>
        <KenneySprite source={KENNEY.terrainTree} size={treeSpriteDp} />
      </View>
      <View style={{ position: 'absolute', right: 4, bottom: height * 0.28, opacity: 0.75 }}>
        <KenneySprite source={KENNEY.terrainTree} size={Math.round(treeSpriteDp * 0.9)} />
      </View>

      {centerAt(
        columns.combat.centerX,
        height * 0.17,
        <>
          <KenneySprite source={KENNEY.arenaFloor} size={buildingSpriteDp} />
          <KenneySprite
            source={KENNEY.terrainPath}
            size={propSpriteDp}
            style={{ position: 'absolute', bottom: -6, opacity: 0.9 }}
          />
          <Text style={[styles.zoneTag, styles.zoneCombat]}>Arène</Text>
        </>,
      )}

      {centerAt(
        columns.camp.centerX,
        height * 0.19,
        <>
          <KenneySprite source={KENNEY.buildingCamp} size={buildingSpriteDp} />
          <Text style={[styles.zoneTag, styles.zoneCamp]}>Camp</Text>
        </>,
      )}

      {centerAt(
        columns.forge.centerX,
        height * 0.17,
        <View style={{ opacity: forgeOpacity, alignItems: 'center', width: buildingSpriteDp }}>
          <KenneySprite source={KENNEY.buildingWall} size={buildingSpriteDp} />
          <KenneySprite
            source={KENNEY.forgeAnvil}
            size={propSpriteDp}
            style={{ marginTop: -Math.round(propSpriteDp * 0.35) }}
          />
          {forgeLevel >= 1 ? (
            <Svg width={emberSize} height={emberSize} style={{ marginTop: -Math.round(emberSize * 0.7) }}>
              <Circle
                cx={emberSize / 2}
                cy={emberSize / 2}
                r={emberSize * 0.36}
                fill={forgeGlow}
                opacity={emberStrength}
              />
            </Svg>
          ) : null}
          {forgeLevel >= 2 ? (
            <KenneySprite
              source={KENNEY.buildingWall}
              size={Math.round(propSpriteDp * 0.92)}
              style={{ marginTop: -Math.round(propSpriteDp * 0.25) }}
            />
          ) : null}
          <Text style={[styles.zoneTag, forgeLevel > 0 && styles.zoneActive]}>Forge</Text>
        </View>,
      )}

      <View style={styles.forestSlot} pointerEvents="none" accessibilityElementsHidden>
        <Text style={styles.lockedTag}>Forêt — bientôt</Text>
      </View>

      <Pressable
        style={[styles.hit, hitboxes.combat]}
        onPress={() => onZone('combat')}
        accessibilityRole="button"
        accessibilityLabel="Arène de combat"
      />
      <Pressable
        style={[styles.hit, hitboxes.camp]}
        onPress={() => onZone('camp')}
        accessibilityRole="button"
        accessibilityLabel="Camp"
      />
      <Pressable
        style={[styles.hit, hitboxes.forge]}
        onPress={() => onZone('forge')}
        accessibilityRole="button"
        accessibilityLabel="Forge"
      />
    </View>
  );
}

function KenneySprite({
  source,
  size,
  style,
}: {
  source: ImageSourcePropType;
  size: number;
  style?: ImageStyle;
}) {
  return <Image source={source} style={[{ width: size, height: size }, style]} />;
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: spacing.md,
    position: 'relative',
    backgroundColor: '#0B1816',
    borderWidth: 1,
    borderColor: colors.line,
  },
  groundRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignContent: 'flex-end',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: 4,
  },
  forestSlot: {
    position: 'absolute',
    left: 6,
    top: 10,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: 'rgba(11,24,22,0.55)',
  },
  lockedTag: { ...typography.caption, color: colors.muted, fontSize: 11 },
  hit: {
    position: 'absolute',
    minHeight: 48,
    minWidth: 48,
  },
  zoneTag: {
    ...typography.caption,
    color: colors.muted,
    fontWeight: '700',
    marginTop: 2,
    fontSize: 11,
  },
  zoneCamp: { color: colors.ink },
  zoneActive: { color: colors.gold },
  zoneCombat: { color: colors.goldBright },
});