import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { colors } from '../theme';
import { ep } from './eloriaPalette';

type Props = { height: number };

/** Arène nocturne — fond de combat illustré. */
export function CombatArenaArt({ height }: Props) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height={height} viewBox="0 0 320 140" preserveAspectRatio="xMidYMid slice">
        <Defs>
          <LinearGradient id="arenaSky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#1A2E35" />
            <Stop offset="0.6" stopColor="#0F1F22" />
            <Stop offset="1" stopColor={colors.bg} />
          </LinearGradient>
          <LinearGradient id="arenaFloor" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={ep.stone} stopOpacity="0.5" />
            <Stop offset="1" stopColor={ep.stoneDark} stopOpacity="0.9" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="320" height="140" fill="url(#arenaSky)" />
        <Path d="M40 24 L55 58 L70 24 Z" fill="#243D38" opacity="0.7" />
        <Path d="M250 20 L268 52 L286 20 Z" fill="#1E3530" opacity="0.75" />
        <Path d="M200 18 L218 48 L236 18 Z" fill="#2A4A44" opacity="0.5" />
        {[[60, 28], [180, 22], [260, 30]].map(([x, y], i) => (
          <Circle key={i} cx={x} cy={y} r={1} fill={colors.goldBright} opacity={0.4} />
        ))}
        <Ellipse cx="160" cy="118" rx="145" ry="22" fill="url(#arenaFloor)" />
        <Path
          d="M30 108 Q160 98 290 108"
          stroke={colors.goldDim}
          strokeWidth="1"
          fill="none"
          opacity="0.45"
        />
        <Path d="M120 95 L140 70 L160 95 L180 70 L200 95" stroke={colors.lineBright} strokeWidth="0.8" fill="none" opacity="0.35" />
        <Rect x="148" y="62" width="24" height="34" rx="2" fill="#354A46" opacity="0.55" />
        <Path d="M152 62 L160 48 L168 62" fill="#3F5852" opacity="0.6" />
      </Svg>
    </View>
  );
}