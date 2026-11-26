import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { FantasyPanel } from './FantasyPanel';
import { ProgressBar } from './ProgressBar';
import { CollapsibleSection } from './CollapsibleSection';
import { Button } from './ui';
import { KENNEY, QUEST_EMBLEM } from '../data/content/kingdomAssets';
import { QUEST_HOW_TO } from '../data/content/quests';
import { colors, radius, spacing, typography } from './theme';
import type { QuestBoardEntry, QuestBoardState } from '@/src/domain/services/questService';

const BADGE: Record<QuestBoardState, { label: string; color: string }> = {
  available: { label: 'Disponible', color: colors.muted },
  accepted: { label: 'En cours', color: colors.ember },
  ready: { label: 'Prête', color: colors.gold },
  claimed: { label: 'Terminée', color: colors.success },
};

function goalOneLine(objective: string): string {
  const line = objective.split(/[.!?]/)[0]?.trim() ?? objective;
  return line.length > 72 ? `${line.slice(0, 69)}…` : line;
}

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
  const emblem = QUEST_EMBLEM[def.id] ?? KENNEY.buildingCamp;
  const howTo = QUEST_HOW_TO[def.id];

  return (
    <FantasyPanel accent={state === 'ready'}>
      <View style={styles.header}>
        <Image source={emblem} style={styles.emblem} />
        <View style={styles.headerMain}>
          <Text style={styles.title} numberOfLines={2}>
            {def.title}
          </Text>
          <Text style={styles.goalLine} numberOfLines={2}>
            {goalOneLine(def.objective)}
          </Text>
        </View>
        <View style={[styles.badge, { borderColor: badge.color }]}>
          <Text style={[styles.badgeText, { color: badge.color }]} numberOfLines={1}>
            {badge.label}
          </Text>
        </View>
      </View>
      {state !== 'claimed' && howTo ? (
        <Text style={styles.howTo} numberOfLines={3}>
          {howTo}
        </Text>
      ) : null}
      <View style={styles.progressBlock}>
        {state === 'accepted' || state === 'ready' ? (
          <ProgressBar progress={progress.current / progress.target} label={progress.label} height={8} />
        ) : (
          <Text style={styles.rewardIdle}>Récompense : {def.rewardGold} or</Text>
        )}
        {state === 'accepted' || state === 'ready' ? (
          <Text style={styles.reward}>{state === 'ready' ? `Prête · ${def.rewardGold} or` : `+${def.rewardGold} or`}</Text>
        ) : null}
      </View>
      {state !== 'claimed' ? (
        <CollapsibleSection title="Détails" hint="Contexte et objectif complet">
          <Text style={styles.desc}>{def.description}</Text>
          <Text style={styles.objective}>{def.objective}</Text>
        </CollapsibleSection>
      ) : (
        <Text style={styles.claimedReward}>+{def.rewardGold} or réclamés</Text>
      )}
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
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  emblem: { width: 40, height: 40, marginTop: 2, flexShrink: 0 },
  headerMain: { flex: 1, flexShrink: 1, minWidth: 0 },
  title: { ...typography.subtitle, color: colors.ink },
  goalLine: { ...typography.caption, color: colors.muted, marginTop: 4 },
  badge: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
    flexShrink: 0,
    alignSelf: 'flex-start',
    maxWidth: '36%',
  },
  badgeText: { fontSize: 11, fontWeight: '600' },
  howTo: {
    ...typography.caption,
    color: colors.ink,
    marginTop: spacing.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.mist,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  claimedReward: { ...typography.caption, color: colors.muted, marginTop: spacing.sm },
  desc: { ...typography.body, color: colors.ink },
  objective: { ...typography.caption, color: colors.muted, marginTop: spacing.sm },
  progressBlock: { marginTop: spacing.sm, gap: 4 },
  reward: { ...typography.caption, color: colors.gold, fontWeight: '700', textAlign: 'right' },
  rewardIdle: { ...typography.caption, color: colors.gold, fontWeight: '700' },
  hint: { ...typography.caption, color: colors.muted, marginTop: spacing.xs },
});