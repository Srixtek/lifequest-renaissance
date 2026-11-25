import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FantasyPanel } from './FantasyPanel';
import { ProgressBar } from './ProgressBar';
import { Button } from './ui';
import { colors, radius, spacing, typography } from './theme';
import type { QuestBoardEntry, QuestBoardState } from '@/src/domain/services/questService';

const BADGE: Record<QuestBoardState, { label: string; color: string }> = {
  available: { label: 'Disponible', color: colors.muted },
  accepted: { label: 'En cours', color: colors.ember },
  ready: { label: 'Prête', color: colors.gold },
  claimed: { label: 'Terminée', color: colors.success },
};

export function QuestBoardCard({
  entry,
  busy,
  acceptDisabledReason,
  onAccept,
  onClaim,
  onAbandon,
}: {
  entry: QuestBoardEntry;
  busy: boolean;
  acceptDisabledReason?: string | null;
  onAccept: () => void;
  onClaim: () => void;
  onAbandon: () => void;
}) {
  const { def, state, progress } = entry;
  const badge = BADGE[state];
  return (
    <FantasyPanel accent={state === 'ready'}>
      <View style={styles.header}>
        <Text style={styles.title}>{def.title}</Text>
        <View style={[styles.badge, { borderColor: badge.color }]}>
          <Text style={[styles.badgeText, { color: badge.color }]}>{badge.label}</Text>
        </View>
      </View>
      <Text style={styles.desc}>{def.description}</Text>
      <Text style={styles.objective}>Objectif : {def.objective}</Text>
      {state === 'accepted' || state === 'ready' ? (
        <ProgressBar progress={progress.current / progress.target} label={progress.label} height={8} />
      ) : null}
      <Text style={styles.reward}>
        {state === 'claimed' ? `Récompense reçue : ${def.rewardGold} or` : `Récompense : ${def.rewardGold} or`}
      </Text>
      {state === 'available' ? (
        <>
          <Button label="Accepter la quête" onPress={onAccept} disabled={busy || !!acceptDisabledReason} />
          {acceptDisabledReason ? <Text style={styles.hint}>{acceptDisabledReason}</Text> : null}
        </>
      ) : null}
      {state === 'ready' ? <Button label={`Réclamer ${def.rewardGold} or`} onPress={onClaim} disabled={busy} /> : null}
      {state === 'accepted' ? (
        <Button label="Abandonner (sans pénalité)" variant="ghost" onPress={onAbandon} disabled={busy} />
      ) : null}
    </FantasyPanel>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  title: { ...typography.subtitle, color: colors.ink, flex: 1 },
  badge: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { fontSize: 11, fontWeight: '600' },
  desc: { ...typography.body, color: colors.ink, marginTop: spacing.sm },
  objective: { ...typography.caption, color: colors.muted, marginTop: spacing.sm, marginBottom: spacing.sm },
  reward: { ...typography.caption, color: colors.gold, fontWeight: '700', marginTop: spacing.sm },
  hint: { ...typography.caption, color: colors.muted, marginTop: spacing.xs },
});
