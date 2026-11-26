import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import type { ClassId } from '../../domain/models/types';
import { colors } from '../theme';

type Props = { classId: ClassId; size?: number };

/** Portrait de fiche personnage — silhouette classe en médaillon. */
export function HeroPortraitArt({ classId, size = 96 }: Props) {
  return (
    <View style={[styles.frame, { width: size, height: size, borderRadius: size * 0.14 }]}>
      <Svg width={size} height={size} viewBox="0 0 96 96">
        <Defs>
          <LinearGradient id="portraitBg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.cardHighlight} />
            <Stop offset="1" stopColor={colors.forest} />
          </LinearGradient>
        </Defs>
        <Rect x="4" y="4" width="88" height="88" rx="12" fill="url(#portraitBg)" stroke={colors.goldDim} strokeWidth="1.2" />
        <Circle cx="48" cy="48" r="34" fill={colors.mist} opacity="0.45" />
        <ClassSilhouette classId={classId} />
      </Svg>
    </View>
  );
}

function ClassSilhouette({ classId }: { classId: ClassId }) {
  const cx = 48;
  const base = 72;
  switch (classId) {
    case 'rodeur':
      return (
        <>
          <Path d={`M${cx} 22 L${cx + 8} 36 L${cx} 32 L${cx - 8} 36 Z`} fill={colors.emeraldBright} />
          <Path d={`M${cx - 10} 36 H${cx + 10} L${cx + 12} ${base} H${cx - 12} Z`} fill="#2A5A4E" />
          <Path d={`M${cx + 14} 40 L${cx + 26} 52`} stroke={colors.gold} strokeWidth="2" />
        </>
      );
    case 'gardien':
      return (
        <>
          <Path d={`M${cx - 12} 28 H${cx + 12} V40 H${cx - 12} Z`} fill={colors.copper} stroke={colors.gold} strokeWidth="0.8" />
          <Path d={`M${cx - 11} 40 H${cx + 11} L${cx + 13} ${base} H${cx - 13} Z`} fill="#3D4F55" />
          <Rect x={cx - 18} y="44" width="6" height="22" fill={colors.copperDim} />
          <Rect x={cx + 12} y="44" width="6" height="22" fill={colors.copperDim} />
        </>
      );
    case 'sage':
      return (
        <>
          <Circle cx={cx} cy="32" r="12" fill={colors.mist} stroke={colors.gold} strokeWidth="0.8" />
          <Path d={`M${cx - 10} 44 H${cx + 10} L${cx + 8} ${base} H${cx - 8} Z`} fill="#3A2E5A" />
          <Circle cx={cx} cy="58" r="6" fill={colors.glow} opacity="0.8" />
        </>
      );
    case 'artisan':
      return (
        <>
          <Rect x={cx - 8} y="26" width="16" height="12" rx="2" fill={colors.copper} />
          <Path d={`M${cx - 10} 38 H${cx + 10} L${cx + 12} ${base} H${cx - 12} Z`} fill="#4A3D32" />
          <Path d={`M${cx + 12} 46 L${cx + 28} 42 L${cx + 26} 56 L${cx + 10} 58`} fill={colors.copperDim} />
        </>
      );
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.lineBright,
    backgroundColor: colors.card,
  },
});