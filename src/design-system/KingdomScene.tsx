import React from 'react';
import { Image, Pressable, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { KENNEY } from '../data/content/kingdomAssets';
import { colors, spacing, typography } from './theme';

export type KingdomZone = 'forge' | 'combat' | 'forest' | 'camp';

type Props = {
  forgeLevel: number;
  onZone: (zone: KingdomZone) => void;
  height?: number;
};

const PIXEL = 3;

export function KingdomScene({ forgeLevel, onZone, height = 240 }: Props) {
  const forgeGlow = forgeLevel >= 2 ? colors.goldBright : forgeLevel >= 1 ? colors.gold : colors.muted;
  const emberOpacity = forgeLevel >= 2 ? 1 : forgeLevel >= 1 ? 0.85 : 0.4;

  return (
    <View style={[styles.wrap, { height }]}>
      <View style={[StyleSheet.absoluteFill, styles.groundRow]}>
        {Array.from({ length: 24 }).map((_, i) => (
          <Image key={`g${i}`} source={KENNEY.terrainGrass} style={styles.grassTile} resizeMode="stretch" />
        ))}
      </View>
      <Svg width="100%" height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <LinearGradient id="skyB" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#12262A" />
            <Stop offset="1" stopColor={colors.bg} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height={height * 0.55} fill="url(#skyB)" />
      </Svg>

      <Sprite source={KENNEY.terrainTree} style={{ left: '4%', bottom: height * 0.28, opacity: 0.9 }} />
      <Sprite source={KENNEY.terrainTree} style={{ right: '6%', bottom: height * 0.3, opacity: 0.85 }} />

      <Sprite source={KENNEY.buildingCamp} style={{ left: '38%', bottom: height * 0.22 }} scale={4} />
      <View style={[styles.forgeCluster, { right: '14%', bottom: height * 0.2 }]}>
        <Sprite source={KENNEY.buildingWall} scale={3.5} />
        <Sprite source={KENNEY.forgeAnvil} scale={3.2} style={{ marginTop: -8 * PIXEL }} />
        {forgeLevel >= 1 ? (
          <View
            style={[
              styles.ember,
              { opacity: emberOpacity, borderColor: forgeGlow, backgroundColor: colors.ember },
            ]}
          />
        ) : null}
        {forgeLevel >= 2 ? <Sprite source={KENNEY.buildingWall} scale={2.5} style={{ marginTop: -6 * PIXEL }} /> : null}
      </View>

      <View style={[styles.arenaCluster, { left: '18%', bottom: height * 0.18 }]}>
        <Image source={KENNEY.arenaFloor} style={{ width: 16 * PIXEL * 4, height: 16 * PIXEL * 2 }} />
        <Sprite source={KENNEY.terrainPath} style={{ position: 'absolute', bottom: -4 }} scale={2.5} />
      </View>

      <View style={styles.forestSlot}>
        <Text style={styles.lockedTag}>Forêt — bientôt</Text>
      </View>

      <Pressable
        style={[styles.zone, styles.forest]}
        onPress={() => onZone('forest')}
        accessibilityLabel="Forêt — bientôt"
      />
      <Pressable style={[styles.zone, styles.camp]} onPress={() => onZone('camp')} accessibilityLabel="Camp">
        <Text style={styles.zoneTag}>Camp</Text>
      </Pressable>
      <Pressable style={[styles.zone, styles.forge]} onPress={() => onZone('forge')} accessibilityLabel="Forge">
        <Text style={[styles.zoneTag, forgeLevel > 0 && styles.zoneActive]}>Forge</Text>
      </Pressable>
      <Pressable style={[styles.zone, styles.combat]} onPress={() => onZone('combat')} accessibilityLabel="Combat">
        <Text style={[styles.zoneTag, styles.zoneCombat]}>Arène</Text>
      </Pressable>
    </View>
  );
}

function Sprite({
  source,
  style,
  scale = 3,
}: {
  source: ImageSourcePropType;
  style?: object;
  scale?: number;
}) {
  const s = 16 * PIXEL * (scale / 3);
  return <Image source={source} style={[{ width: s, height: s }, style]} />;
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
  groundRow: { flexDirection: 'row', alignItems: 'flex-end', bottom: 0, height: 48 },
  grassTile: { flex: 1, height: 24, opacity: 0.9 },
  forgeCluster: { position: 'absolute', alignItems: 'center' },
  arenaCluster: { position: 'absolute', alignItems: 'center' },
  ember: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: -6,
    borderWidth: 1,
  },
  forestSlot: {
    position: 'absolute',
    left: 8,
    top: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'rgba(11,24,22,0.75)',
    borderRadius: 8,
  },
  lockedTag: { ...typography.caption, color: colors.muted },
  zone: {
    position: 'absolute',
    justifyContent: 'flex-end',
    paddingBottom: 6,
    alignItems: 'center',
  },
  forest: { left: '0%', top: '35%', width: '18%', height: '48%' },
  combat: { left: '14%', top: '38%', width: '28%', height: '48%' },
  camp: { left: '36%', top: '36%', width: '30%', height: '52%' },
  forge: { left: '62%', top: '38%', width: '24%', height: '48%' },
  zoneTag: { ...typography.caption, color: colors.muted, fontWeight: '700' },
  zoneActive: { color: colors.gold },
  zoneCombat: { color: colors.goldBright },
});