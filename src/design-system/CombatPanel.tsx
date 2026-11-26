import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
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
import { computeCombatVisualLayout } from './combatVisualLayout';
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
  const { width: screenWidth } = useWindowDimensions();
  const [stageWidth, setStageWidth] = useState<number | null>(null);
  // Screen horizontal padding + FantasyPanel inner padding/borders.
  const estimatedWidth = Math.max(180, screenWidth - spacing.lg * 2 - spacing.md * 2 - 4);
  const visual = computeCombatVisualLayout(stageWidth ?? estimatedWidth);
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
      <View
        style={[styles.stage, { minHeight: visual.stageHeight }, flash === 'hit' && !reduceMotion && styles.flashHit, flash === 'defend' && !reduceMotion && styles.flashDefend]}
        onLayout={({ nativeEvent }) => {
          const w = Math.round(nativeEvent.layout.width);
          if (w > 0 && w !== stageWidth) setStageWidth(w);
        }}
      >
        <CombatArenaArt height={visual.stageHeight} />
        <View style={styles.fighters}>
          <FighterSlot label={CLASS_LABELS[classId]} side="left">
            <CombatFighterArt kind="hero" classId={classId} size={visual.fighterSize} pulse={!combat.outcome} />
          </FighterSlot>
          <Text style={styles.vs}>vs</Text>
          <FighterSlot label={enemyDisplayName(enemyId)} side="right">
            <CombatFighterArt kind="enemy" enemyId={enemyId} size={visual.fighterSize} pulse={!combat.outcome} />
          </FighterSlot>
        </View>
        <HpBar
          inScene
          label={`${combat.heroHp}`}
          current={combat.heroHp}
          max={combat.heroHpMax}
          tint={colors.emerald}
          style={styles.heroHp}
        />
        <HpBar
          inScene
          label={`${combat.enemyHp}`}
          current={combat.enemyHp}
          max={combat.enemyHpMax}
          tint={colors.warn}
          style={styles.enemyHp}
        />
      </View>

      <View style={styles.hpNumericRow}>
        <Text style={styles.hpNumeric}>
          Héros {combat.heroHp}/{combat.heroHpMax} PV
        </Text>
        <Text style={styles.hpNumeric}>
          {enemyDisplayName(enemyId)} {combat.enemyHp}/{combat.enemyHpMax} PV
        </Text>
      </View>

      {combat.outcome ? (
        <OutcomeRecap combat={combat} classId={classId} enemyName={enemyDisplayName(enemyId)} />
      ) : (
        <>
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
            <Body muted>
              Tour {combat.turnNumber} · compétence : {SKILL_CONCENTRATION_COST} concentration
            </Body>
          </View>
          <View style={styles.actions}>
            <Button label="Attaquer" onPress={onAttack} disabled={busy} />
            <View style={styles.actionRow}>
              <View style={styles.actionHalf}>
                <Button label="Défendre" variant="secondary" onPress={onDefend} disabled={busy} compact />
              </View>
              <View style={styles.actionHalf}>
                <Button
                  label={skillReady ? skillLabel : `${skillLabel} (${SKILL_CONCENTRATION_COST})`}
                  variant="secondary"
                  onPress={onSkill}
                  disabled={busy || !skillReady}
                  compact
                />
              </View>
            </View>
          </View>
        </>
      )}
      {combat.outcome && onLeave ? (
        <Button label="Revenir au bastion" variant="ghost" onPress={onLeave} disabled={busy} />
      ) : null}
      <Text style={styles.logHeading}>Journal du combat</Text>
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

function OutcomeRecap({
  combat,
  classId,
  enemyName,
}: {
  combat: CombatSnapshot;
  classId: ClassId;
  enemyName: string;
}) {
  const won = combat.outcome === 'victory';
  const rewardLine = [...combat.log].reverse().find((l) => /bannière|inventaire|or\b/i.test(l));
  return (
    <View style={[styles.outcome, won ? styles.winStage : styles.loseStage]}>
      <Text style={won ? styles.win : styles.lose}>{won ? 'Victoire' : 'Défaite'}</Text>
      <Text style={styles.outcomeDetail}>
        {CLASS_LABELS[classId]} · {combat.heroHp}/{combat.heroHpMax} PV — {enemyName} · {combat.enemyHp}/
        {combat.enemyHpMax} PV
      </Text>
      {rewardLine ? <Text style={styles.outcomeReward}>{rewardLine}</Text> : null}
      {!won ? <Text style={styles.outcomeHint}>Tu peux relancer un combat depuis l&apos;arène.</Text> : null}
    </View>
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
        {label ? <Text style={styles.sceneHpText}>{label}</Text> : null}
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
  hpNumericRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    flexWrap: 'wrap',
  },
  hpNumeric: { ...typography.caption, color: colors.muted, fontWeight: '700', flex: 1, minWidth: 120 },
  actionRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'stretch', marginTop: spacing.xs },
  actionHalf: { flex: 1, minWidth: 0 },
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
  vs: { ...typography.caption, color: colors.line, marginBottom: spacing.md, flexShrink: 0 },
  sceneHp: { position: 'absolute', width: '38%', maxWidth: 128 },
  heroHp: { left: spacing.sm, bottom: spacing.sm },
  enemyHp: { right: spacing.sm, bottom: spacing.sm },
  sceneHpText: {
    ...typography.caption,
    color: colors.ink,
    fontWeight: '800',
    fontSize: 11,
    textAlign: 'center',
    marginBottom: 2,
    textShadowColor: 'rgba(0,0,0,0.65)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  hpTrackThin: { height: 6, borderRadius: 3, backgroundColor: colors.line, overflow: 'hidden' },
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
  actions: { marginVertical: spacing.sm, gap: spacing.xs },
  logHeading: { ...typography.caption, color: colors.copper, marginTop: spacing.sm, fontWeight: '700' },
  log: { maxHeight: 96, marginTop: spacing.xs },
  logLine: { ...typography.caption, color: colors.muted, marginBottom: 2, fontSize: 11 },
  outcome: { borderRadius: 8, padding: spacing.md, marginVertical: spacing.sm, gap: spacing.xs },
  winStage: { backgroundColor: 'rgba(212,175,55,0.12)' },
  loseStage: { backgroundColor: 'rgba(180,90,70,0.12)' },
  win: { color: colors.goldBright, fontWeight: '700', textAlign: 'center', fontSize: 18 },
  lose: { color: colors.warn, textAlign: 'center', fontWeight: '700', fontSize: 18 },
  outcomeDetail: { ...typography.caption, color: colors.muted, textAlign: 'center' },
  outcomeReward: { ...typography.caption, color: colors.gold, textAlign: 'center', fontWeight: '600' },
  outcomeHint: { ...typography.caption, color: colors.muted, textAlign: 'center', marginTop: spacing.xs },
});