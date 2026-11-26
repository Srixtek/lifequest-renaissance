import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { colors, spacing, typography } from './theme';

export function BreathingRing({ phase }: { phase: 'inspire' | 'expire' }) {
  const scale = phase === 'inspire' ? 1 : 0.72;
  const size = 120;
  const r = (size / 2) * scale - 8;

  return (
    <View style={styles.wrap} accessibilityLabel={phase === 'inspire' ? 'Phase inspire' : 'Phase expire'}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Defs>
          <RadialGradient id="breathGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={colors.glow} stopOpacity={phase === 'inspire' ? 0.55 : 0.25} />
            <Stop offset="1" stopColor={colors.glow} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size / 2 - 2} fill="url(#breathGlow)" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={colors.emeraldBright}
          strokeWidth={3}
          opacity={0.9}
        />
        <Circle cx={size / 2} cy={size / 2} r={r - 12} fill={colors.mist} opacity={0.5} />
      </Svg>
      <Text style={styles.label}>{phase === 'inspire' ? 'Inspire' : 'Expire'}</Text>
      <Text style={styles.sub}>{phase === 'inspire' ? '4 secondes' : '6 secondes'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', marginVertical: spacing.md },
  label: { ...typography.subtitle, color: colors.goldBright, marginTop: spacing.sm },
  sub: { ...typography.caption, color: colors.muted },
});