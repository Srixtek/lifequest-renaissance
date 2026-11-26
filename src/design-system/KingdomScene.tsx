import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { colors, spacing, typography } from './theme';

export type KingdomZone = 'forge' | 'combat' | 'forest' | 'camp';

type Props = {
  forgeLevel: number;
  onZone: (zone: KingdomZone) => void;
  height?: number;
};

export function KingdomScene({ forgeLevel, onZone, height = 220 }: Props) {
  const forgeGlow = forgeLevel >= 2 ? colors.goldBright : forgeLevel >= 1 ? colors.gold : colors.muted;
  return (
    <View style={[styles.wrap, { height }]}>
      <Svg width="100%" height={height} viewBox="0 0 360 220">
        <Defs>
          <LinearGradient id="skyB" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#12262A" />
            <Stop offset="1" stopColor={colors.bg} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="360" height="220" fill="url(#skyB)" />
        <Path d="M0 175 Q90 165 180 172 T360 175 L360 220 L0 220 Z" fill="#0B1816" />
        {/* forêt inactive */}
        <Path d="M10 175 L28 78 L46 175 Z" fill="#14342E" opacity={0.85} />
        <Path d="M300 175 L320 70 L340 175 Z" fill="#163832" opacity={0.85} />
        <Rect x="0" y="150" width="95" height="70" fill="transparent" />
        {/* camp central */}
        <Path d="M140 175 L180 118 L220 175 Z" fill="#2A5A4A" stroke={colors.goldDim} strokeWidth="0.8" />
        <Rect x="172" y="150" width="16" height="24" rx="2" fill={colors.copperDim} />
        <Circle cx="180" cy="142" r="10" fill={colors.ember} opacity={0.5} />
        {/* forge */}
        <Rect x="228" y="138" width="44" height="36" rx="4" fill="#4A3728" stroke={forgeGlow} strokeWidth={1.4} />
        <Rect x="238" y="148" width="24" height="16" rx="2" fill={forgeLevel > 0 ? colors.ember : '#2A1810'} />
        {forgeLevel >= 2 ? <Rect x="234" y="132" width="32" height="6" rx="2" fill={colors.copper} /> : null}
        {/* arène */}
        <EllipseArena />
        <Path
          d="M24 175 Q55 168 76 175"
          stroke={colors.emeraldDim}
          strokeWidth="2"
          fill="none"
          opacity={0.35}
        />
      </Svg>
      <Pressable
        style={[styles.zone, styles.forest]}
        onPress={() => onZone('forest')}
        accessibilityLabel="Forêt — bientôt"
      >
        <Text style={styles.zoneTag}>Forêt</Text>
      </Pressable>
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

function EllipseArena() {
  return (
    <>
      <Path
        d="M68 160 Q120 145 148 160 Q120 175 68 160 Z"
        fill="#1A3530"
        stroke={colors.goldDim}
        strokeWidth="0.7"
      />
      <Circle cx="108" cy="157" r="5" fill={colors.copperDim} />
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', borderRadius: 16, overflow: 'hidden', marginBottom: spacing.md, position: 'relative' },
  zone: {
    position: 'absolute',
    justifyContent: 'flex-end',
    paddingBottom: 6,
    alignItems: 'center',
  },
  forest: { left: 0, top: 55, width: 95, height: 120 },
  camp: { left: 125, top: 80, width: 110, height: 100 },
  forge: { right: 52, top: 95, width: 80, height: 90 },
  combat: { left: 52, top: 95, width: 110, height: 90 },
  zoneTag: { ...typography.caption, color: colors.muted, fontWeight: '700' },
  zoneActive: { color: colors.gold },
  zoneCombat: { color: colors.goldBright },
});