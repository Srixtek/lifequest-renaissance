import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { EnemyId } from '../data/content/kingdom';
import { SKILL_CONCENTRATION_COST, CONCENTRATION_MAX } from '../data/content/kingdom';
import { enemyDisplayName } from '../domain/combat/combatEngine';
import { CombatArenaArt } from './art/CombatArenaArt';
import { CombatFighterArt } from './art/CombatFighterArt';
import type { CombatSnapshot } from '../domain/combat/combatEngine';
import type { ClassId } from '../domain/models/types';
import { Button, Body } from './ui';
import { colors, spacing, typography } from './theme';
import { FantasyPanel } from './FantasyPanel';
import { pixelDim } from './pixelSprite';
import { useReduceMotion } from './useReduceMotion';

type Props = {
  combat: CombatSnapshot & { active: boolean; updatedAt: string };
  classId: ClassId;
  skillLabel: string;
  skillReady: boolean;
  busy: boolean;
  reduceMotion?: boolean;
  onAttack: () => void;
  onDefend: () => void;
  onSkill: () => void;
  onLeave?: () => void;
};

const COMBAT_STAGE_HEIGHT = pixelDim(3.6) + spacing.xl + 28;

const CLASS_LABELS: Record<ClassId, string> = {
  rodeur: 'Rôdeur',
  gardien: 'Gardien',
  sage: 'Sage',
  artisan: 'Artisan',
};

function intentCopy(intent: CombatSnapshot['enemyIntent']) {
  switch (intent) {
    case 'heavy':
      return { label: 'Frappe lourde imminente', tint: colors.warn };
    case 'brace':
      return { label: 'Ennemi en défense / préparation', tint: colors.emerald };
    default:
      return { label: 'Attaque normale imminente', tint: colors.muted };
  }
}

export function CombatPanel({
  combat,
  classId,
  skillLabel,
  skillReady,
  busy,
  reduceMotion: reduceProp,
  onAttack,
  onDefend,
  onSkill,
  onLeave,
}: Props) {
  const reduceHook = useReduceMotion();
  const reduceMotion = reduceProp ?? reduceHook;
  const intent = intentCopy(combat.enemyIntent);
  const [flash, setFlash] = useState<'hit' | 'defend' | null>(null);
  const enemyId = (combat.enemyId ?? 'thorn_guardian') as EnemyId;

  useEffect(() => {
    const last = combat.log[combat.log.length - 1] ?? '';
    if (reduceMotion || combat.outcome) return;
    if (last.includes('frappe') || last.includes('dégâts')) {
      setFlash('hit');
      const t = setTimeout(() => setFlash(null), 220);
      return () => clearTimeout(t);
    }
    if (last.includes('défense')) {
      setFlash('defend');
      const t = setTimeout(() => setFlash(null), 220);
      return () => clearTimeout(t);
    }
  }, [combat.log.length, combat.updatedAt, reduceMotion, combat.outcome]);

  return (
    <FantasyPanel>
      <View style={[styles.stage, flash === 'hit' && !reduceMotion && styles.flashHit, flash === 'defend' && !reduceMotion && styles.flashDefend]}>
        <CombatArenaArt height={COMBAT_STAGE_HEIGHT} />
        <View style={styles.fighters}>
          <FighterSlot label={CLASS_LABELS[classId]} side="left">
            <CombatFighterArt kind="hero" classId={classId} size={pixelDim(3.6)} pulse={!combat.outcome} />
          </FighterSlot>
          <Text style={styles.vs}>vs</Text>
          <FighterSlot label={enemyDisplayName(enemyId)} side="right">
            <CombatFighterArt kind="enemy" enemyId={enemyId} size={pixelDim(3.6)} pulse={!combat.outcome} />
          </FighterSlot>
        </View>
        <HpBar inScene current={combat.heroHp} max={combat.heroHpMax} tint={colors.emerald} style={styles.heroHp} />
        <HpBar inScene current={combat.enemyHp} max={combat.enemyHpMax} tint={colors.warn} style={styles.enemyHp} />
      </View>

      <View style={styles.telegraphRow}>
        <Text style={styles.title} numberOfLines={2}>
          {enemyDisplayName(enemyId)}
        </Text>
        <ConcentrationMeter value={combat.concentration} max={CONCENTRATION_MAX} />
      </View>
      <View style={[styles.intentBadge, { borderColor: intent.tint }]}>
        <Text style={[styles.intentText, { color: intent.tint }]} numberOfLines={2}>
          {intent.label}
        </Text>
      </View>
      <View style={styles.turnLine}>
        <Body muted>Tour {combat.turnNumber} · compétence : {SKILL_CONCENTRATION_COST} concentration</Body>
      </View>
      {combat.outcome ? (
        <View style={[styles.outcome, combat.outcome === 'victory' ? styles.winStage : styles.loseStage]}>
          <Text style={combat.outcome === 'victory' ? styles.win : styles.lose}>
            {combat.outcome === 'victory' ? 'Victoire' : 'Défaite'}
          </Text>
        </View>
      ) : (
        <View style={styles.actions}>
          <View style={styles.actionRow}>
            <View style={styles.actionPrimary}>
              <Button label="Attaquer" onPress={onAttack} disabled={busy} />
            </View>
            <View style={styles.actionSide}>
              <Button label="Défendre" variant="ghost" onPress={onDefend} disabled={busy} />
              <Button
                label={skillReady ? skillLabel : `${skillLabel} (${SKILL_CONCENTRATION_COST})`}
                variant="ghost"
                onPress={onSkill}
                disabled={busy || !skillReady}
              />
            </View>
          </View>
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

function FighterSlot({
  label,
  side,
  children,
}: {
  label: string;
  side: 'left' | 'right';
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.fighter, side === 'right' && styles.fighterEnd]}>
      {children}
      <Text style={styles.fighterLabel} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

function ConcentrationMeter({ value, max }: { value: number; max: number }) {
  return (
    <View style={styles.concRow}>
      <Text style={styles.concLabel}>Concentration</Text>
      <View style={styles.concDots}>
        {Array.from({ length: max }).map((_, i) => (
          <View key={i} style={[styles.concDot, i < value && styles.concDotOn]} />
        ))}
      </View>
    </View>
  );
}

function HpBar({
  label,
  current,
  max,
  tint,
  inScene,
  style,
}: {
  label?: string;
  current: number;
  max: number;
  tint: string;
  inScene?: boolean;
  style?: object;
}) {
  const pct = max > 0 ? Math.min(1, current / max) : 0;
  if (inScene) {
    return (
      <View style={[styles.sceneHp, style]}>
        <View style={styles.hpTrackThin}>
          <View style={[styles.hpFill, { width: `${pct * 100}%`, backgroundColor: tint }]} />
        </View>
      </View>
    );
  }
  return (
    <View style={styles.hpWrap}>
      {label ? (
        <Text style={styles.hpLabel}>
          {label} {current}/{max}
        </Text>
      ) : null}
      <View style={styles.hpTrack}>
        <View style={[styles.hpFill, { width: `${pct * 100}%`, backgroundColor: tint }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: spacing.sm,
    minHeight: COMBAT_STAGE_HEIGHT,
    borderWidth: 1,
    borderColor: colors.line,
  },
  flashHit: { borderColor: colors.warn },
  flashDefend: { borderColor: colors.emeraldDim },
  telegraphRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  turnLine: { marginBottom: spacing.xs },
  actionRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'stretch' },
  actionPrimary: { flex: 1.1 },
  actionSide: { flex: 1, gap: spacing.xs },
  fighters: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg + 6,
    gap: spacing.xs,
  },
  fighter: { alignItems: 'center', gap: 4, flex: 1, minWidth: 0, maxWidth: '40%' },
  fighterEnd: { alignItems: 'center' },
  fighterLabel: { ...typography.caption, color: colors.muted, fontSize: 10, textAlign: 'center' },
  vs: { ...typography.caption, color: colors.line, marginBottom: pixelDim(0.8), flexShrink: 0 },
  sceneHp: { position: 'absolute', width: '36%', maxWidth: 120 },
  heroHp: { left: spacing.sm, bottom: spacing.sm },
  enemyHp: { right: spacing.sm, bottom: spacing.sm },
  hpTrackThin: { height: 5, borderRadius: 3, backgroundColor: colors.line, overflow: 'hidden' },
  intentBadge: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.sm,
    alignSelf: 'flex-start',
  },
  intentText: { ...typography.caption, fontWeight: '700' },
  concRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  concLabel: { ...typography.caption, color: colors.muted },
  concDots: { flexDirection: 'row', gap: 6 },
  concDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1, borderColor: colors.line },
  concDotOn: { backgroundColor: colors.gold, borderColor: colors.goldBright },
  title: { ...typography.subtitle, color: colors.gold, marginBottom: spacing.xs, flex: 1, flexShrink: 1, minWidth: 0 },
  hpWrap: { marginBottom: 4 },
  hpLabel: { ...typography.caption, color: colors.muted, marginBottom: 2 },
  hpTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.line,
    overflow: 'hidden',
  },
  hpFill: { height: '100%', borderRadius: 4 },
  actions: { marginVertical: spacing.sm },
  log: { maxHeight: 120, marginTop: spacing.sm },
  logLine: { ...typography.caption, color: colors.muted, marginBottom: 2 },
  outcome: { borderRadius: 8, padding: spacing.sm, marginVertical: spacing.sm },
  winStage: { backgroundColor: 'rgba(212,175,55,0.12)' },
  loseStage: { backgroundColor: 'rgba(180,90,70,0.12)' },
  win: { color: colors.goldBright, fontWeight: '700', textAlign: 'center' },
  lose: { color: colors.warn, textAlign: 'center' },
});