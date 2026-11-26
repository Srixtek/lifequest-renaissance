import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Body, SecondaryLink, TabScrollView } from '@/src/design-system/ui';
import { CollapsibleSection } from '@/src/design-system/CollapsibleSection';
import { colors, spacing, typography } from '@/src/design-system/theme';
import { ForestScene } from '@/src/design-system/ForestScene';
import { FantasyPanel } from '@/src/design-system/FantasyPanel';
import { ProgressBar } from '@/src/design-system/ProgressBar';
import { NextChallengeCard } from '@/src/design-system/NextChallengeCard';
import { EmptyState, QuestCard } from '@/src/design-system/QuestCard';
import { CATEGORY_SHORT } from '@/src/design-system/categoryLabels';
import { GOAL_TEMPLATES } from '@/src/data/content/goalTemplates';
import { CLASSES } from '@/src/data/content/classes';
import { useAppStore } from '@/src/state/appStore';
import { XP_PER_LEVEL } from '@/src/domain/rules/xp';
import type { GoalDefinition, TrackingStatus } from '@/src/domain/models/types';
import { publicGoalTitle } from '@/src/domain/content/goalDisplay';
import { getDb } from '@/src/data/db/client';
import { upgradeCamp } from '@/src/domain/services/adventureService';
import { buildWhatToDoNow, type WhatToDoNow } from '@/src/domain/services/whatToDoNowService';
import { delayMinutesForTier } from '@/src/domain/content/vapeChallengeDefs';

function todayStatusLabel(
  goal: GoalDefinition,
  status: TrackingStatus,
  hasValue: boolean,
): string {
  if (goal.followWithoutXp) {
    if (status === 'unknown' && !hasValue) return 'Non renseigné';
    if (hasValue || status !== 'unknown') return 'Renseigné';
  }
  if (status === 'success') return 'Accompli';
  if (status === 'partial') return 'Partiel';
  if (status === 'miss') return 'Écart';
  if (status === 'paused') return 'En pause';
  return 'Non renseigné';
}

export default function CampScreen() {
  const router = useRouter();
  const profile = useAppStore((s) => s.profile);
  const character = useAppStore((s) => s.character);
  const goldBalance = useAppStore((s) => s.goldBalance);
  const goals = useAppStore((s) => s.goals);
  const todayTracking = useAppStore((s) => s.todayTracking);
  const refresh = useAppStore((s) => s.refresh);
  const [vapeDelayMin, setVapeDelayMin] = useState<number | null>(null);
  const [vapeRunning, setVapeRunning] = useState(false);
  const [campMsg, setCampMsg] = useState<string | null>(null);
  const [whatToDo, setWhatToDo] = useState<WhatToDoNow | null>(null);

  const activeGoals = useMemo(
    () => goals.filter((g) => g.status === 'active'),
    [goals],
  );

  const vapeGoal = useMemo(
    () => activeGoals.find((g) => g.templateId === 'vape_sessions'),
    [activeGoals],
  );

  const reloadVapeHint = useCallback(async () => {
    if (!vapeGoal) {
      setVapeDelayMin(null);
      setVapeRunning(false);
      return;
    }
    const { getVapeAdaptiveDashboard } = await import('@/src/domain/services/adaptiveChallengeService');
    const db = await getDb();
    const dash = await getVapeAdaptiveDashboard(db);
    if (dash.running) {
      setVapeRunning(true);
      setVapeDelayMin(null);
      return;
    }
    setVapeRunning(false);
    setVapeDelayMin(delayMinutesForTier(dash.state.tierIndex));
  }, [vapeGoal?.id]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      void reloadVapeHint();
    }, [refresh, reloadVapeHint]),
  );

  const reloadWhatToDo = useCallback(async () => {
    const db = await getDb();
    const w = await buildWhatToDoNow(db, {
      activeGoals,
      todayTracking,
      vapeDelayMin,
      vapeRunning,
    });
    setWhatToDo(w);
  }, [activeGoals, todayTracking, vapeDelayMin, vapeRunning]);

  useFocusEffect(
    useCallback(() => {
      void reloadWhatToDo();
    }, [reloadWhatToDo]),
  );

  const onWhatToDo = useCallback(() => {
    if (!whatToDo) return;
    const r = whatToDo.route;
    if (r.kind === 'adventure') {
      const q = new URLSearchParams();
      if (r.tab) q.set('tab', r.tab);
      if (r.instanceId) q.set('instanceId', r.instanceId);
      if (r.tab === 'royaume' && whatToDo.kind === 'combat') q.set('openCombat', '1');
      if (r.tab === 'royaume' && whatToDo.kind === 'forge') q.set('openForge', '1');
      const qs = q.toString();
      router.push(qs ? `/(tabs)/adventure?${qs}` : '/(tabs)/adventure');
    } else if (r.kind === 'vape-adaptive') {
      router.push('/tools/vape-adaptive');
    } else if (r.kind === 'challenges') {
      router.push(`/tools/challenges?type=${r.challengeType}`);
    } else if (r.kind === 'goals') {
      router.push('/(tabs)/goals');
    } else {
      router.push('/(tabs)/camp');
    }
  }, [whatToDo, router]);

  const className = CLASSES.find((c) => c.id === profile?.classId)?.name ?? 'Voyageur';
  const totalXp = character?.totalXp ?? 0;
  const level = character?.level ?? 1;
  const inLevelXp = totalXp - (level - 1) * XP_PER_LEVEL;
  const levelProgress = inLevelXp / XP_PER_LEVEL;
  const shards = character?.shards ?? 0;

  return (
    <TabScrollView safeTop flushHorizontal>
        <View>
          <ForestScene />
          <View style={styles.heroOverlay}>
            <Text style={styles.realm}>Eloria</Text>
            <Text style={styles.pseudo}>{profile?.pseudo ?? 'Voyageur'}</Text>
            <Text style={styles.classLine}>
              {className} · Nv. {level}
            </Text>
            <ProgressBar
              progress={levelProgress}
              label={`${Math.round(inLevelXp)} / ${XP_PER_LEVEL} XP`}
              height={12}
            />
            <View style={styles.resourceStrip}>
              <ResourceChip label="Or" value={String(goldBalance)} />
              <ResourceChip label="Éclats" value={String(shards)} />
              <ResourceChip label="XP" value={String(Math.round(totalXp))} />
            </View>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Que faire maintenant ?</Text>
        <NextChallengeCard
          title={whatToDo?.title ?? 'Chargement…'}
          subtitle={whatToDo?.subtitle ?? ''}
          ctaLabel={whatToDo?.cta ?? '…'}
          onPress={onWhatToDo}
          empty={whatToDo?.kind === 'idle'}
        />

        <Text style={styles.sectionTitle}>Aujourd'hui</Text>
        {activeGoals.length === 0 ? (
          <EmptyState
            title="Rien à suivre pour l'instant"
            hint="Ajoute une habitude depuis l'onglet Habitudes."
          />
        ) : (
          activeGoals.map((g) => {
            const tr = todayTracking[g.id];
            const status = (tr?.status ?? 'unknown') as TrackingStatus;
            const tpl = GOAL_TEMPLATES.find((t) => t.id === g.templateId);
            const category = tpl?.category;
            const displayTitle = publicGoalTitle(g);
            return (
              <Pressable
                key={g.id}
                onPress={() => router.push('/(tabs)/goals')}
                accessibilityRole="button"
              >
                <QuestCard
                  title={tpl ? CATEGORY_SHORT[category!] ?? displayTitle : displayTitle}
                  category={category}
                  status={status}
                  targetLabel={displayTitle}
                  valueLabel={todayStatusLabel(g, status, tr?.value != null)}
                  compact
                />
              </Pressable>
            );
          })
        )}

        <FantasyPanel style={{ marginTop: spacing.lg }}>
          <Text style={styles.panelTitle}>Accès rapide</Text>
          <View style={styles.quickRow}>
            <SecondaryLink label="Quêtes" onPress={() => router.push('/(tabs)/adventure')} />
            <SecondaryLink label="Respiration" onPress={() => router.push('/tools/breathing')} />
            <SecondaryLink label="Bilan" onPress={() => router.push('/(tabs)/stats')} />
          </View>
          <View style={styles.quickRow}>
            <SecondaryLink label="Journal" onPress={() => router.push('/journal')} />
            <SecondaryLink label="Paramètres" onPress={() => router.push('/settings')} />
            {vapeGoal ? (
              <SecondaryLink label="Défis vape" onPress={() => router.push('/tools/vape-adaptive')} />
            ) : null}
          </View>
        </FantasyPanel>

        <CollapsibleSection title="Autres actions" hint="Envie, camp, chronomètres…">
          <View style={styles.quickRow}>
            <SecondaryLink label="Gérer une envie" onPress={() => router.push('/tools/urge')} />
            <SecondaryLink label="Défis chronométrés" onPress={() => router.push('/tools/challenges')} />
          </View>
          <View style={[styles.quickRow, { marginTop: spacing.sm }]}>
            <SecondaryLink
              label="Améliorer le camp"
              onPress={async () => {
                const db = await getDb();
                const r = await upgradeCamp(db);
                setCampMsg(r.message);
                await refresh();
              }}
            />
          </View>
          {campMsg ? (
            <View style={{ marginTop: spacing.sm }}>
              <Body muted>{campMsg}</Body>
            </View>
          ) : null}
        </CollapsibleSection>
    </TabScrollView>
  );
}

function ResourceChip({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipValue}>{value}</Text>
      <Text style={styles.chipLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  heroOverlay: {
    marginTop: -spacing.sm,
    paddingTop: 0,
  },
  realm: { ...typography.label, color: colors.gold },
  pseudo: { ...typography.hero, color: colors.ink, marginTop: 4 },
  classLine: { ...typography.caption, color: colors.muted, marginTop: 2, marginBottom: spacing.xs },
  resourceStrip: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  chip: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: 12,
    backgroundColor: colors.mist,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  chipValue: { fontSize: 18, fontWeight: '700', color: colors.goldBright },
  chipLabel: { ...typography.caption, color: colors.muted, marginTop: 2 },
  sectionTitle: { ...typography.title, color: colors.ink, marginTop: spacing.lg, fontSize: 20 },
  panelTitle: { ...typography.subtitle, color: colors.gold, marginBottom: spacing.sm },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
});