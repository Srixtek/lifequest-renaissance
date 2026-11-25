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

/** Local multi-layer forest + camp illustration for the home header. */
export function ForestScene({ height = 140 }: { height?: number }) {
  return (
    <View style={[styles.wrap, { height }]} accessibilityElementsHidden importantForAccessibility="no">
      <Svg width="100%" height={height} viewBox="0 0 360 140" preserveAspectRatio="xMidYMid slice">
        <Defs>
          <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#0E2A26" />
            <Stop offset="1" stopColor="#0B1C1A" />
          </LinearGradient>
          <LinearGradient id="glow" x1="0.5" y1="0" x2="0.5" y2="1">
            <Stop offset="0" stopColor={colors.gold} stopOpacity="0.25" />
            <Stop offset="1" stopColor={colors.gold} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="360" height="140" fill="url(#sky)" />
        <Ellipse cx="180" cy="95" rx="120" ry="40" fill="url(#glow)" />
        <Circle cx="300" cy="28" r="14" fill={colors.gold} opacity={0.35} />
        {/* back trees */}
        <Path d="M30 120 L45 55 L60 120 Z" fill="#14352F" />
        <Path d="M70 120 L88 48 L106 120 Z" fill="#163A34" />
        <Path d="M250 120 L268 50 L286 120 Z" fill="#14352F" />
        <Path d="M300 120 L318 58 L336 120 Z" fill="#163A34" />
        {/* mid trees */}
        <Path d="M120 125 L142 40 L164 125 Z" fill="#1A453E" />
        <Path d="M195 125 L218 35 L241 125 Z" fill="#1E4F47" />
        {/* camp */}
        <Path d="M155 125 L180 88 L205 125 Z" fill="#2A5A4A" stroke={colors.goldDim} strokeWidth="0.5" />
        <Rect x="172" y="108" width="16" height="17" rx="2" fill={colors.gold} opacity={0.7} />
        <Ellipse cx="180" cy="118" rx="22" ry="4" fill="#E0A45A" opacity={0.2} />
        {/* front ground */}
        <Path d="M0 130 Q90 122 180 128 T360 130 L360 140 L0 140 Z" fill="#0F2420" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    marginHorizontal: -4,
    borderRadius: 12,
    overflow: 'hidden',
  },
});