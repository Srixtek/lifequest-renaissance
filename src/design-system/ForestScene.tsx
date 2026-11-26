import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  LinearGradient,
  Path,
  Rect,
  Stop,
} from 'react-native-svg';
import { colors } from './theme';

/** Scène de camp nocturne — illustration d'accueil. */
export function ForestScene({ height = 168 }: { height?: number }) {
  return (
    <View style={[styles.wrap, { height }]} accessibilityElementsHidden importantForAccessibility="no">
      <Svg width="100%" height={height} viewBox="0 0 360 168" preserveAspectRatio="xMidYMid slice">
        <Defs>
          <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#152E2A" />
            <Stop offset="0.55" stopColor="#0E221E" />
            <Stop offset="1" stopColor={colors.bg} />
          </LinearGradient>
          <LinearGradient id="glow" x1="0.5" y1="0" x2="0.5" y2="1">
            <Stop offset="0" stopColor={colors.gold} stopOpacity="0.35" />
            <Stop offset="1" stopColor={colors.copper} stopOpacity="0" />
          </LinearGradient>
          <LinearGradient id="fire" x1="0" y1="1" x2="0" y2="0">
            <Stop offset="0" stopColor={colors.copperDim} stopOpacity="0.1" />
            <Stop offset="1" stopColor={colors.ember} stopOpacity="0.45" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="360" height="168" fill="url(#sky)" />
        {/* étoiles / lucioles */}
        {[
          [40, 22],
          [95, 14],
          [210, 18],
          [280, 26],
          [320, 12],
        ].map(([x, y], i) => (
          <Circle key={i} cx={x} cy={y} r={1.2} fill={colors.goldBright} opacity={0.35 + (i % 3) * 0.15} />
        ))}
        <Ellipse cx="180" cy="110" rx="130" ry="50" fill="url(#glow)" />
        <Circle cx="298" cy="30" r="16" fill={colors.gold} opacity={0.28} />
        <Circle cx="298" cy="30" r="22" fill={colors.gold} opacity={0.08} />
        {/* arbres lointains */}
        <Path d="M20 155 L38 72 L56 155 Z" fill="#122E29" />
        <Path d="M55 155 L74 58 L93 155 Z" fill="#14352F" />
        <Path d="M265 155 L284 62 L303 155 Z" fill="#122E29" />
        <Path d="M310 155 L328 70 L346 155 Z" fill="#163A34" />
        {/* arbres proches */}
        <Path d="M105 158 L132 38 L159 158 Z" fill="#1A453E" />
        <Path d="M195 158 L224 32 L253 158 Z" fill="#1E4F47" />
        <Path d="M118 158 L132 95 L146 158 Z" fill="#24564D" opacity={0.7} />
        {/* camp & feu */}
        <Path d="M148 158 L180 108 L212 158 Z" fill="#2A5A4A" stroke={colors.goldDim} strokeWidth="0.6" />
        <Rect x="171" y="138" width="18" height="20" rx="2" fill={colors.copperDim} />
        <Ellipse cx="180" cy="150" rx="28" ry="8" fill="url(#fire)" />
        <Path
          d="M177 145 Q180 132 183 145 Q180 138 177 145"
          fill={colors.ember}
          opacity={0.85}
        />
        {/* sol */}
        <Path d="M0 158 Q90 148 180 154 T360 158 L360 168 L0 168 Z" fill="#0A1816" />
        <Path
          d="M0 162 Q120 156 180 159 T360 162"
          stroke={colors.emeraldDim}
          strokeWidth="0.5"
          fill="none"
          opacity={0.4}
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    marginHorizontal: -4,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    overflow: 'hidden',
  },
});