import React from 'react';
import { Image, Pressable, StyleSheet, Text, View, type ImageSourcePropType, type ImageStyle } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { KENNEY } from '../data/content/kingdomAssets';
import { pixelDim } from './pixelSprite';
import { colors, spacing, typography } from './theme';

export type KingdomZone = 'forge' | 'combat' | 'forest' | 'camp';

type Props = {
  forgeLevel: number;
  onZone: (zone: KingdomZone) => void;
  height?: number;
};

const GROUND_TILE = pixelDim(0.55);
const GROUND_ROW_H = pixelDim(0.65);

export function KingdomScene({ forgeLevel, onZone, height = 248 }: Props) {
  const forgeGlow = forgeLevel >= 2 ? colors.goldBright : forgeLevel >= 1 ? colors.gold : colors.muted;
  const forgeOpacity = forgeLevel === 0 ? 0.82 : 1;
  const emberStrength = forgeLevel >= 2 ? 1 : forgeLevel >= 1 ? 0.75 : 0;

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

      <View style={{ position: 'absolute', left: '3%', bottom: height * 0.26, opacity: 0.88 }}>
        <KenneySprite source={KENNEY.terrainTree} scale={2.4} />
      </View>
      <View style={{ position: 'absolute', right: '4%', bottom: height * 0.28, opacity: 0.8 }}>
        <KenneySprite source={KENNEY.terrainTree} scale={2.2} />
      </View>

      <View style={[styles.buildingSlot, { left: '39%', bottom: height * 0.2 }]}>
        <KenneySprite source={KENNEY.buildingCamp} scale={3.4} />
        <Text style={[styles.zoneTag, styles.zoneCamp]}>Camp</Text>
      </View>

      <View style={[styles.buildingSlot, { right: '10%', bottom: height * 0.18, opacity: forgeOpacity }]}>
        <KenneySprite source={KENNEY.buildingWall} scale={3} />
        <KenneySprite source={KENNEY.forgeAnvil} scale={2.9} style={{ marginTop: -pixelDim(0.35) }} />
        {forgeLevel >= 1 ? (
          <Svg width={pixelDim(0.9)} height={pixelDim(0.9)} style={{ marginTop: -pixelDim(0.55) }}>
            <Circle cx={pixelDim(0.45)} cy={pixelDim(0.45)} r={pixelDim(0.32)} fill={forgeGlow} opacity={emberStrength} />
          </Svg>
        ) : null}
        {forgeLevel >= 2 ? (
          <KenneySprite source={KENNEY.buildingWall} scale={2.4} style={{ marginTop: -pixelDim(0.3) }} />
        ) : null}
        <Text style={[styles.zoneTag, forgeLevel > 0 && styles.zoneActive]}>Forge</Text>
      </View>

      <View style={[styles.buildingSlot, { left: '16%', bottom: height * 0.17 }]}>
        <KenneySprite source={KENNEY.arenaFloor} scale={2.85} />
        <KenneySprite
          source={KENNEY.terrainPath}
          scale={2.2}
          style={{ position: 'absolute', bottom: -pixelDim(0.15), opacity: 0.9 }}
        />
        <Text style={[styles.zoneTag, styles.zoneCombat]}>Arène</Text>
      </View>

      <View style={styles.forestSlot} pointerEvents="none" accessibilityElementsHidden>
        <Text style={styles.lockedTag}>Forêt — bientôt</Text>
      </View>

      <Pressable
        style={[styles.hit, styles.hitCamp]}
        onPress={() => onZone('camp')}
        accessibilityRole="button"
        accessibilityLabel="Camp"
      />
      <Pressable
        style={[styles.hit, styles.hitForge]}
        onPress={() => onZone('forge')}
        accessibilityRole="button"
        accessibilityLabel="Forge"
      />
      <Pressable
        style={[styles.hit, styles.hitCombat]}
        onPress={() => onZone('combat')}
        accessibilityRole="button"
        accessibilityLabel="Arène de combat"
      />
    </View>
  );
}

function KenneySprite({
  source,
  style,
  scale = 1,
}: {
  source: ImageSourcePropType;
  style?: ImageStyle;
  scale?: number;
}) {
  const size = pixelDim(scale);
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
  buildingSlot: {
    position: 'absolute',
    alignItems: 'center',
    minWidth: pixelDim(3.6),
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
  hitCamp: { left: '34%', top: '32%', width: '30%', height: '54%' },
  hitCombat: { left: '10%', top: '34%', width: '26%', height: '50%' },
  hitForge: { left: '58%', top: '34%', width: '28%', height: '50%' },
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