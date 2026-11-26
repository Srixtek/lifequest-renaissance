import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { THORN_GUARDIAN_NAME } from '../data/content/kingdom';
import type { CombatSnapshot } from '../domain/combat/combatEngine';
import { Button, Body } from './ui';
import { colors, spacing, typography } from './theme';
import { FantasyPanel } from './FantasyPanel';

type Props = {
  combat: CombatSnapshot & { active: boolean };
  skillLabel: string;
  skillReady: boolean;
  busy: boolean;
  onAttack: () => void;
  onDefend: () => void;
  onSkill: () => void;
  onLeave?: () => void;
};

export function CombatPanel({
  combat,
  skillLabel,
  skillReady,
  busy,
  onAttack,
  onDefend,
  onSkill,
  onLeave,
}: Props) {
  const intent =
    combat.enemyIntent === 'power' ? 'Frappe lourde imminente' : 'Attaque normale imminente';
  return (
    <FantasyPanel>
      <Text style={styles.title}>{THORN_GUARDIAN_NAME}</Text>
      <View style={styles.bars}>
        <HpBar label="Héros" current={combat.heroHp} max={combat.heroHpMax} tint={colors.emerald} />
        <HpBar label="Ennemi" current={combat.enemyHp} max={combat.enemyHpMax} tint={colors.warn} />
      </View>
      <Body muted>
        Tour {combat.turnNumber} — {intent}
      </Body>
      {combat.outcome ? (
        <Text style={combat.outcome === 'victory' ? styles.win : styles.lose}>
          {combat.outcome === 'victory' ? 'Victoire' : 'Défaite'}
        </Text>
      ) : (
        <View style={styles.actions}>
          <Button label="Attaquer" onPress={onAttack} disabled={busy} />
          <Button label="Défendre" variant="ghost" onPress={onDefend} disabled={busy} />
          <Button
            label={skillReady ? skillLabel : `${skillLabel} (${combat.skillCooldown}t)`}
            variant="ghost"
            onPress={onSkill}
            disabled={busy || !skillReady}
          />
        </View>
      )}
      {combat.outcome && onLeave ? (
        <Button label="Revenir au bastion" variant="ghost" onPress={onLeave} disabled={busy} />
      ) : null}
      <ScrollView style={styles.log} nestedScrollEnabled>
        {combat.log.slice(-8).map((line, i) => (
          <Text key={`${i}-${line.slice(0, 12)}`} style={styles.logLine}>
            {line}
          </Text>
        ))}
      </ScrollView>
    </FantasyPanel>
  );
}

function HpBar({
  label,
  current,
  max,
  tint,
}: {
  label: string;
  current: number;
  max: number;
  tint: string;
}) {
  const pct = max > 0 ? Math.min(1, current / max) : 0;
  return (
    <View style={styles.hpWrap}>
      <Text style={styles.hpLabel}>
        {label} {current}/{max}
      </Text>
      <View style={styles.hpTrack}>
        <View style={[styles.hpFill, { width: `${pct * 100}%`, backgroundColor: tint }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.subtitle, color: colors.gold, marginBottom: spacing.sm },
  bars: { gap: spacing.sm, marginBottom: spacing.sm },
  hpWrap: { marginBottom: 4 },
  hpLabel: { ...typography.caption, color: colors.muted, marginBottom: 2 },
  hpTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.line,
    overflow: 'hidden',
  },
  hpFill: { height: '100%', borderRadius: 4 },
  actions: { gap: spacing.xs, marginVertical: spacing.sm },
  log: { maxHeight: 120, marginTop: spacing.sm },
  logLine: { ...typography.caption, color: colors.muted, marginBottom: 2 },
  win: { color: colors.goldBright, fontWeight: '700' },
  lose: { color: colors.warn },
});