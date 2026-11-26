import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { Button } from './ui';
import { colors, radius, spacing, typography } from './theme';

export function NextChallengeCard({
  title,
  subtitle,
  targetLine,
  ctaLabel,
  onPress,
  empty,
}: {
  title: string;
  subtitle?: string;
  targetLine?: string;
  ctaLabel: string;
  onPress: () => void;
  empty?: boolean;
}) {
  return (
    <View style={[styles.wrap, empty && styles.empty]}>
      <Ornament />
      <Text style={styles.kicker}>Ton prochain défi</Text>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}
      {targetLine ? (
        <View style={styles.targetPill}>
          <Text style={styles.targetText}>{targetLine}</Text>
        </View>
      ) : null}
      <Button label={ctaLabel} onPress={onPress} />
    </View>
  );
}

function Ornament() {
  return (
    <Svg width="100%" height={24} viewBox="0 0 320 24" style={styles.ornament}>
      <Defs>
        <LinearGradient id="nc" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={colors.goldDim} stopOpacity="0" />
          <Stop offset="0.5" stopColor={colors.goldBright} stopOpacity="0.8" />
          <Stop offset="1" stopColor={colors.goldDim} stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Path d="M0 12 Q160 4 320 12" stroke="url(#nc)" strokeWidth="1.5" fill="none" />
      <Rect x="150" y="10" width="20" height="4" rx="2" fill={colors.copper} opacity={0.6} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.goldDim,
    backgroundColor: colors.cardHighlight,
  },
  empty: { borderColor: colors.line, backgroundColor: colors.card },
  ornament: { marginBottom: spacing.sm },
  kicker: { ...typography.label, color: colors.gold },
  title: { ...typography.hero, color: colors.ink, fontSize: 22, marginTop: spacing.xs },
  sub: { ...typography.body, color: colors.muted, marginTop: spacing.xs },
  targetPill: {
    alignSelf: 'flex-start',
    marginTop: spacing.md,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.glowSoft,
    borderWidth: 1,
    borderColor: colors.emeraldDim,
  },
  targetText: { ...typography.caption, color: colors.emeraldBright, fontWeight: '600' },
});