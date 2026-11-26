import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Body, Button } from './ui';
import { colors, radius, spacing, typography } from './theme';
import type { VapeChallengeFormat } from '@/src/domain/models/adaptiveChallenge';

const FORMAT_ACCENT: Record<VapeChallengeFormat, string> = {
  delay_craving: colors.emeraldBright,
  breathing: colors.glow,
  interval: colors.gold,
  record: colors.copper,
};

const FORMAT_LABEL: Record<VapeChallengeFormat, string> = {
  delay_craving: 'Retarder',
  breathing: 'Respiration',
  interval: 'Intervalle',
  record: 'Record',
};

export function VapeFormatCard({
  format,
  title,
  subtitle,
  hint,
  featured,
  disabled,
  onStart,
}: {
  format: VapeChallengeFormat;
  title: string;
  subtitle: string;
  hint: string;
  featured?: boolean;
  disabled?: boolean;
  onStart: () => void;
}) {
  const accent = FORMAT_ACCENT[format];
  return (
    <View style={[styles.wrap, featured && styles.featured]}>
      <View style={[styles.badge, { borderColor: accent }]}>
        <Text style={[styles.badgeText, { color: accent }]}>{FORMAT_LABEL[format]}</Text>
      </View>
      <Text style={styles.title}>{title}</Text>
      <Body muted>{subtitle}</Body>
      <Text style={styles.hint}>{hint}</Text>
      <Button
        label={featured ? 'Commencer (recommandé)' : 'Commencer'}
        onPress={onStart}
        disabled={disabled}
        variant={featured ? 'primary' : 'secondary'}
        compact
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  featured: {
    borderColor: colors.goldDim,
    backgroundColor: colors.cardHighlight,
  },
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    marginBottom: spacing.xs,
  },
  badgeText: { ...typography.label, fontSize: 10 },
  title: { ...typography.subtitle, color: colors.ink },
  hint: { ...typography.caption, color: colors.emeraldBright, marginTop: spacing.xs, marginBottom: spacing.sm },
});