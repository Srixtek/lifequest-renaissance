import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';
import type { EnemyId } from '../../data/content/kingdom';
import type { ClassId } from '../../domain/models/types';
import { colors } from '../theme';
import { useReduceMotion } from '../useReduceMotion';

type Props = {
  kind: 'hero' | 'enemy';
  classId?: ClassId;
  enemyId?: EnemyId;
  size?: number;
  pulse?: boolean;
};

/** Silhouettes illustrées — un style par classe et par ennemi. */
export function CombatFighterArt({ kind, classId, enemyId, size = 72, pulse }: Props) {
  const reduce = useReduceMotion();
  const bob = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduce || !pulse) {
      bob.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [bob, pulse, reduce]);

  const translateY = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -3] });

  return (
    <Animated.View style={[styles.wrap, { width: size, height: size, transform: [{ translateY }] }]}>
      <Svg width={size} height={size} viewBox="0 0 64 64">
        <Ellipse cx="32" cy="58" rx="22" ry="5" fill="#000" opacity="0.35" />
        {kind === 'hero' && classId ? <HeroFigure classId={classId} /> : null}
        {kind === 'enemy' && enemyId ? <EnemyFigure enemyId={enemyId} /> : null}
      </Svg>
    </Animated.View>
  );
}

function HeroFigure({ classId }: { classId: ClassId }) {
  switch (classId) {
    case 'rodeur':
      return (
        <G>
          <Path d="M32 12 L38 22 L32 18 L26 22 Z" fill={colors.emeraldBright} />
          <Path d="M28 22 L36 22 L38 48 L26 48 Z" fill="#2A5A4E" stroke={colors.goldDim} strokeWidth="0.5" />
          <Path d="M24 28 L18 40 M40 28 L46 38" stroke={colors.copper} strokeWidth="2" strokeLinecap="round" />
          <Path d="M42 26 L52 20 L50 32" stroke={colors.gold} strokeWidth="1.5" fill="none" />
        </G>
      );
    case 'gardien':
      return (
        <G>
          <Path d="M24 18 H40 V28 H24 Z" fill={colors.copperDim} stroke={colors.gold} strokeWidth="0.6" />
          <Path d="M26 28 L38 28 L40 50 L22 50 Z" fill="#3D4F55" stroke={colors.lineBright} strokeWidth="0.5" />
          <Rect x="20" y="30" width="6" height="22" rx="1" fill={colors.copper} />
          <Rect x="38" y="30" width="6" height="22" rx="1" fill={colors.copper} />
          <Path d="M18 22 L22 30 L18 38" fill={colors.goldDim} />
        </G>
      );
    case 'sage':
      return (
        <G>
          <Circle cx="32" cy="18" r="8" fill={colors.mist} stroke={colors.gold} strokeWidth="0.6" />
          <Path d="M26 26 L38 26 L36 50 L28 50 Z" fill="#3A2E5A" stroke={colors.glow} strokeWidth="0.5" />
          <Path d="M32 32 L32 44" stroke={colors.glow} strokeWidth="2" />
          <Circle cx="32" cy="46" r="4" fill={colors.glow} opacity="0.75" />
        </G>
      );
  case 'artisan':
      return (
        <G>
          <Rect x="26" y="16" width="12" height="10" rx="2" fill={colors.copper} />
          <Path d="M26 26 L38 26 L40 48 L24 48 Z" fill="#4A3D32" stroke={colors.copperDim} strokeWidth="0.5" />
          <Path d="M44 34 L54 30 L52 42 L42 44" fill={colors.copperDim} stroke={colors.goldDim} strokeWidth="0.5" />
        </G>
      );
    default:
      return null;
  }
}

function EnemyFigure({ enemyId }: { enemyId: EnemyId }) {
  if (enemyId.startsWith('forest_')) {
    return (
      <G>
        <Path
          d="M32 12 Q18 20 16 38 Q18 52 32 54 Q46 50 48 34 Q46 18 32 12"
          fill="#354A58"
          stroke={colors.glow}
          strokeWidth="0.7"
        />
        <Circle cx="26" cy="32" r="2.2" fill={colors.warn} />
        <Circle cx="38" cy="32" r="2.2" fill={colors.warn} />
        <Path d="M12 36 Q8 42 14 44" stroke={colors.mist} strokeWidth="1" fill="none" opacity="0.6" />
      </G>
    );
  }
  if (enemyId === 'mist_wolf') {
    return (
      <G>
        <Path
          d="M14 40 Q22 28 32 32 Q42 26 50 36 Q48 44 38 48 Q28 52 18 48 Q12 44 14 40"
          fill="#3A4A5A"
          stroke={colors.glow}
          strokeWidth="0.6"
          opacity="0.95"
        />
        <Circle cx="22" cy="38" r="2" fill={colors.glow} />
        <Circle cx="30" cy="36" r="2" fill={colors.glow} />
        <Path d="M50 34 L58 30 L56 40" fill="#4A5A6A" />
        <Path d="M32 48 Q28 54 24 52" stroke={colors.muted} strokeWidth="1.2" fill="none" opacity="0.5" />
      </G>
    );
  }
  return (
    <G>
      <Path
        d="M32 14 Q20 22 18 36 Q16 48 26 52 Q32 54 38 50 Q48 42 46 28 Q44 16 32 14"
        fill="#2D4A3E"
        stroke={colors.emerald}
        strokeWidth="0.8"
      />
      <Path d="M20 24 L14 32 L18 34" fill="#1E3530" />
      <Path d="M44 24 L50 32 L46 34" fill="#1E3530" />
      <Circle cx="28" cy="30" r="2.5" fill={colors.warn} />
      <Circle cx="36" cy="30" r="2.5" fill={colors.warn} />
      <Path d="M28 38 Q32 42 36 38" stroke={colors.copper} strokeWidth="1" fill="none" />
    </G>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
});