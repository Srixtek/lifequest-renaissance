import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { colors, spacing, typography } from './theme';

export function ProgressBar({
  progress,
  label,
  height = 10,
}: {
  progress: number;
  label?: string;
  height?: number;
}) {
  const clamped = Math.max(0, Math.min(1, progress));
  const pct = Math.round(clamped * 100);

  return (
    <View style={styles.wrap} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={[styles.track, { height, borderRadius: height / 2 }]}>
        <Svg width="100%" height={height} style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id="xpGrad" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={colors.goldDim} />
              <Stop offset="1" stopColor={colors.gold} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height={height} rx={height / 2} fill={colors.mist} />
          <Rect x="0" y="0" width={`${pct}%`} height={height} rx={height / 2} fill="url(#xpGrad)" />
        </Svg>
      </View>
      {label ? null : <Text style={styles.pct}>{pct} %</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.sm },
  label: { ...typography.caption, color: colors.muted, marginBottom: 4 },
  track: {
    width: '100%',
    backgroundColor: colors.mist,
    overflow: 'hidden',
  },
  pct: { ...typography.caption, color: colors.muted, marginTop: 4, textAlign: 'right' },
});