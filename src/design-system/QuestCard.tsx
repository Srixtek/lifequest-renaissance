import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors, radius, spacing, typography } from './theme';
import { CategoryIcon } from './icons';
import type { GoalTemplate } from '@/src/data/content/goalTemplates';
import type { TrackingStatus } from '@/src/domain/models/types';
import { ProgressBar } from './ProgressBar';

const STATUS_COLORS: Record<TrackingStatus, string> = {
  unknown: colors.muted,
  success: colors.success,
  partial: colors.warn,
  miss: colors.danger,
  paused: colors.muted,
};

const STATUS_LABELS: Record<TrackingStatus, string> = {
  unknown: 'Non renseigné',
  success: 'Accompli',
  partial: 'Partiel',
  miss: 'Écart',
  paused: 'En pause',
};

export function QuestCard({
  title,
  category,
  status,
  targetLabel,
  valueLabel,
  progress,
  onPress,
  children,
}: {
  title: string;
  category?: GoalTemplate['category'];
  status: TrackingStatus;
  targetLabel?: string;
  valueLabel?: string;
  progress?: number;
  onPress?: () => void;
  children?: React.ReactNode;
}) {
  const statusColor = STATUS_COLORS[status] ?? colors.muted;

  const content = (
    <>
      <View style={styles.header}>
        {category ? (
          <View style={styles.iconWrap}>
            <CategoryIcon category={category} size={26} />
          </View>
        ) : null}
        <View style={styles.headerText}>
          <Text style={styles.title}>{title}</Text>
          {targetLabel ? <Text style={styles.meta}>{targetLabel}</Text> : null}
        </View>
        <View style={[styles.badge, { borderColor: statusColor }]}>
          <Text style={[styles.badgeText, { color: statusColor }]}>{STATUS_LABELS[status]}</Text>
        </View>
      </View>
      {valueLabel ? <Text style={styles.value}>Aujourd'hui : {valueLabel}</Text> : null}
      {progress != null ? <ProgressBar progress={progress} height={8} /> : null}
      {children}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        style={({ pressed }) => [styles.card, pressed && { opacity: 0.92 }]}
      >
        <CardFrame />
        {content}
      </Pressable>
    );
  }

  return (
    <View style={styles.card}>
      <CardFrame />
      {content}
    </View>
  );
}

function CardFrame() {
  return (
    <Svg width="100%" height={8} viewBox="0 0 300 8" preserveAspectRatio="none" style={styles.frame}>
      <Path d="M0 6 Q150 0 300 6" stroke={colors.goldDim} strokeWidth="1" fill="none" opacity={0.5} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  frame: { position: 'absolute', top: 0, left: 0, right: 0 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.mist,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1 },
  title: { ...typography.subtitle, color: colors.ink },
  meta: { ...typography.caption, color: colors.muted, marginTop: 2 },
  badge: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeText: { fontSize: 11, fontWeight: '600' },
  value: { ...typography.caption, color: colors.muted, marginTop: spacing.sm },
});

export function AdventureQuestCard({
  title,
  description,
  onPress,
}: {
  title: string;
  description: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [stylesAdv.wrap, pressed && { opacity: 0.9 }]}
    >
      <Text style={stylesAdv.title}>{title}</Text>
      <Text style={stylesAdv.body}>{description}</Text>
      <Text style={stylesAdv.cta}>Explorer →</Text>
    </Pressable>
  );
}

const stylesAdv = StyleSheet.create({
  wrap: {
    marginTop: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.goldDim,
    backgroundColor: colors.mist,
  },
  title: { ...typography.title, color: colors.gold, fontSize: 20 },
  body: { ...typography.body, color: colors.ink, marginTop: spacing.sm },
  cta: { ...typography.caption, color: colors.gold, marginTop: spacing.md, fontWeight: '700' },
});

export function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <View style={stylesEmpty.wrap}>
      <Text style={stylesEmpty.title}>{title}</Text>
      <Text style={stylesEmpty.hint}>{hint}</Text>
    </View>
  );
}

const stylesEmpty = StyleSheet.create({
  wrap: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    alignItems: 'center',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    borderStyle: 'dashed',
  },
  title: { ...typography.subtitle, color: colors.ink, textAlign: 'center' },
  hint: { ...typography.caption, color: colors.muted, marginTop: spacing.sm, textAlign: 'center' },
});