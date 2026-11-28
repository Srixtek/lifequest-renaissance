import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { getKingdomView } from '../domain/services/kingdomService';
import { enemyDisplayName } from '../domain/combat/combatEngine';
import { Button, Body } from './ui';
import { FantasyPanel } from './FantasyPanel';
import { colors, spacing, typography } from './theme';
import type { EnemyId } from '../data/content/kingdom';

type CampaignView = NonNullable<Awaited<ReturnType<typeof getKingdomView>>['campaign']>;

type Props = {
  campaign: CampaignView;
  busy: boolean;
  combatOpen: boolean;
  onStartStage: (stageId: string) => void;
  onResume: () => void;
};

function statusLabel(status: string): string {
  switch (status) {
    case 'cleared':
      return '✓';
    case 'unlocked':
      return '•';
    default:
      return '🔒';
  }
}

export function EloriaCampaignPanel({ campaign, busy, combatOpen, onStartStage, onResume }: Props) {
  const nextStage = campaign.stages.find((s) => s.status === 'unlocked') ?? campaign.stages.find((s) => s.status === 'cleared' && s.number === campaign.highestUnlocked);

  return (
    <FantasyPanel style={styles.panel}>
      <Text style={styles.title}>Campagne d&apos;Eloria</Text>
      <Body muted>{campaign.zoneName} — 10 paliers</Body>
      {campaign.hasCampaignTrophy ? (
        <Text style={styles.trophy}>Emblème de la Forêt des Brumes obtenu.</Text>
      ) : null}
      {campaign.activeStageId && !combatOpen ? (
        <Button label="Reprendre le combat" onPress={onResume} disabled={busy} compact />
      ) : null}
      {nextStage ? (
        <Text style={styles.nextFoe}>
          Prochain : {nextStage.number}. {nextStage.name} — {enemyDisplayName(nextStage.enemyId as EnemyId)}
        </Text>
      ) : null}
      <View style={styles.steps}>
        {campaign.stages.map((s) => (
          <View
            key={s.stageId}
            style={[
              styles.step,
              s.status === 'cleared' && styles.stepDone,
              s.status === 'unlocked' && styles.stepOpen,
              s.isBoss && styles.stepBoss,
            ]}
          >
            <Text style={styles.stepNum}>
              {statusLabel(s.status)} {s.number}
            </Text>
            <Text style={styles.stepName} numberOfLines={1}>
              {s.name}
            </Text>
            {s.status !== 'locked' ? (
              <Button
                label={s.status === 'cleared' ? 'Rejouer' : 'Combattre'}
                variant={s.isBoss ? 'primary' : 'secondary'}
                compact
                disabled={busy || (campaign.activeStageId != null && !combatOpen)}
                onPress={() => onStartStage(s.stageId)}
              />
            ) : (
              <Text style={styles.lockedHint}>Verrouillé</Text>
            )}
          </View>
        ))}
      </View>
    </FantasyPanel>
  );
}

const styles = StyleSheet.create({
  panel: { gap: spacing.sm },
  title: { ...typography.title, color: colors.gold },
  trophy: { color: colors.emerald, fontSize: 13 },
  nextFoe: { color: colors.mist, fontSize: 13, marginBottom: spacing.xs },
  steps: { gap: spacing.xs, marginTop: spacing.sm },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  stepDone: { opacity: 0.85 },
  stepOpen: { backgroundColor: 'rgba(46, 90, 78, 0.15)' },
  stepBoss: { borderLeftWidth: 2, borderLeftColor: colors.warn, paddingLeft: spacing.xs },
  stepNum: { width: 36, color: colors.muted, fontWeight: '600' },
  stepName: { flex: 1, color: colors.ink, fontSize: 13 },
  lockedHint: { color: colors.muted, fontSize: 12, width: 72, textAlign: 'right' },
});