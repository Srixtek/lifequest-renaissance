import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FantasyPanel } from './FantasyPanel';
import { ProgressBar } from './ProgressBar';
import { Button } from './ui';
import { colors, spacing, typography } from './theme';
import type { RenewableBoardEntry } from '@/src/domain/services/renewableQuestService';
import { categoryLabel } from '@/src/domain/services/renewableQuestService';
import type { RenewableQuestCategory } from '@/src/data/content/renewableQuestTemplates';
import { displayElapsedSec } from '@/src/domain/services/challengeService';
import { formatChallengeHms, progressTowardTarget } from '@/src/domain/rules/challengeDuration';

const BADGE: Record<string, { label: string; color: string }> = {
  offered: { label: 'Disponible', color: colors.muted },
  active: { label: 'En cours', color: colors.ember },
  ready: { label: 'Prête', color: colors.gold },
  failed: { label: 'Échec', color: colors.warn },
};

export function RenewableQuestCard({
  entry,
  busy,
  acceptDisabledReason,
  onAccept,
  onClaim,
  onAbandon,
  onStartTimer,
  onFailTimer,
  onSucceedTimer,
  onPartialStop,
  winFlash,
  highlighted,
}: {
  entry: RenewableBoardEntry;
  busy: boolean;
  acceptDisabledReason?: string | null;
  onAccept: () => void;
  onClaim: () => void;
  onAbandon: () => void;
  onStartTimer?: () => void;
  onFailTimer?: () => void;
  onSucceedTimer?: () => void;
  onPartialStop?: () => void;
  winFlash?: boolean;
  highlighted?: boolean;
}) {
  const { template, state, progress } = entry;
  const badge = BADGE[state] ?? BADGE.offered;
  const [tick, setTick] = useState(0);
  const hasInline =
    template.proof === 'breathing_timer' || template.proof === 'inline_challenge';

  useEffect(() => {
    if (!entry.timerRunning) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [entry.timerRunning]);

  const liveElapsed =
    entry.timerRunning && entry.inlineTimer
      ? displayElapsedSec(
          {
            id: '',
            type: 'sport',
            startedUtc: entry.inlineTimer.startedUtc,
            endedUtc: null,
            targetDurationSec: entry.inlineTimer.targetSec,
            state: 'running',
            durationSec: 0,
            userConfirmed: false,
            userConfirmedDurationSec: null,
            createdAt: entry.inlineTimer.startedUtc,
            updatedAt: entry.inlineTimer.startedUtc,
          },
          Date.now(),
        )
      : null;
  const liveProgress =
    liveElapsed != null && entry.inlineTimer
      ? progressTowardTarget(liveElapsed, entry.inlineTimer.targetSec)
      : null;
  const progressLabel =
    liveElapsed != null && entry.inlineTimer
      ? `${formatChallengeHms(liveElapsed)} / ${formatChallengeHms(entry.inlineTimer.targetSec)}`
      : progress.label;
  const progressValue =
    liveProgress != null
      ? liveProgress
      : progress.target > 1
        ? progress.current / progress.target
        : progress.current;

  const cat = categoryLabel(template.category as RenewableQuestCategory);

  return (
    <FantasyPanel accent={state === 'ready' || winFlash || highlighted}>
      <View style={styles.header}>
        <View style={styles.headerMain}>
          <Text style={styles.category}>{cat} · {template.difficulty} · {template.durationLabel}</Text>
          <Text style={styles.title} numberOfLines={2}>
            {template.title}
          </Text>
          <Text style={styles.goalLine} numberOfLines={2}>
            {template.objective}
          </Text>
        </View>
        <View style={[styles.badge, { borderColor: badge.color }]}>
          <Text style={[styles.badgeText, { color: badge.color }]}>{badge.label}</Text>
        </View>
      </View>
      <Text style={styles.nextStep} numberOfLines={2}>
        {template.nextStep}
      </Text>
      {state !== 'offered' ? (
        <View style={styles.progressBlock}>
          <ProgressBar progress={progressValue} label={progressLabel} height={8} />
          {liveElapsed != null && entry.inlineTimer ? (
            <Text style={styles.liveClock}>
              Chrono {formatChallengeHms(liveElapsed)} — cible {formatChallengeHms(entry.inlineTimer.targetSec)}
            </Text>
          ) : null}
          <Text style={styles.reward}>+{template.rewardGold} or</Text>
        </View>
      ) : (
        <Text style={styles.rewardIdle}>Récompense : {template.rewardGold} or</Text>
      )}
      {state === 'offered' ? (
        <>
          <Button label="Accepter" onPress={onAccept} disabled={busy || !!acceptDisabledReason} />
          {acceptDisabledReason ? <Text style={styles.hint}>{acceptDisabledReason}</Text> : null}
        </>
      ) : null}
      {state === 'active' && hasInline ? (
        <View style={styles.timerRow}>
          {!entry.timerRunning ? (
            <Button label="Démarrer le chrono" onPress={() => onStartTimer?.()} disabled={busy} compact />
          ) : (
            <>
              <Button label="Succès (objectif atteint)" onPress={() => onSucceedTimer?.()} disabled={busy} compact />
              <Button label="Arrêt partiel" variant="ghost" onPress={() => onPartialStop?.()} disabled={busy} compact />
              <Button label="Échec" variant="ghost" onPress={() => onFailTimer?.()} disabled={busy} compact />
            </>
          )}
        </View>
      ) : null}
      {state === 'ready' ? (
        <Button label={`Réclamer ${template.rewardGold} or`} onPress={onClaim} disabled={busy} />
      ) : null}
      {state === 'active' && !hasInline ? (
        <Button label="Abandonner" variant="ghost" onPress={onAbandon} disabled={busy} />
      ) : null}
      {winFlash ? <Text style={styles.winAnim}>✦ Victoire !</Text> : null}
    </FantasyPanel>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  headerMain: { flex: 1, minWidth: 0 },
  category: { ...typography.caption, color: colors.muted },
  title: { ...typography.subtitle, color: colors.ink },
  goalLine: { ...typography.caption, color: colors.muted, marginTop: 4 },
  badge: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { fontSize: 11, fontWeight: '600' },
  nextStep: {
    ...typography.caption,
    color: colors.ink,
    marginTop: spacing.sm,
    padding: spacing.sm,
    backgroundColor: colors.mist,
    borderRadius: 8,
  },
  progressBlock: { marginTop: spacing.sm, gap: 4 },
  liveClock: { ...typography.caption, color: colors.ember, fontWeight: '600', textAlign: 'center' },
  reward: { ...typography.caption, color: colors.gold, fontWeight: '700', textAlign: 'right' },
  rewardIdle: { ...typography.caption, color: colors.gold, fontWeight: '700', marginTop: spacing.sm },
  timerRow: { gap: spacing.xs, marginTop: spacing.sm },
  hint: { ...typography.caption, color: colors.muted, marginTop: spacing.xs },
  winAnim: { ...typography.caption, color: colors.success, textAlign: 'center', marginTop: spacing.sm, fontWeight: '700' },
});