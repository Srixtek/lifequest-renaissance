import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, SecondaryLink } from '@/src/design-system/ui';
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
import { challengeTypeForTemplate } from '@/src/domain/models/challengeSession';
import { getDb } from '@/src/data/db/client';
import {
  delayMinutesForTier,
  vapeChallengeDef,
} from '@/src/domain/content/vapeChallengeDefs';

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
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const profile = useAppStore((s) => s.profile);
  const character = useAppStore((s) => s.character);
  const goldBalance = useAppStore((s) => s.goldBalance);
  const goals = useAppStore((s) => s.goals);
  const todayTracking = useAppStore((s) => s.todayTracking);
  const refresh = useAppStore((s) => s.refresh);
  const [vapeDelayMin, setVapeDelayMin] = useState<number | null>(null);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const activeGoals = useMemo(
    () => goals.filter((g) => g.status === 'active'),
    [goals],
  );

  const vapeGoal = useMemo(
    () => activeGoals.find((g) => g.templateId === 'vape_sessions'),
    [activeGoals],
  );

  useEffect(() => {
    if (!vapeGoal) {
      setVapeDelayMin(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { getVapeAdaptiveDashboard } = await import('@/src/domain/services/adaptiveChallengeService');
      const db = await getDb();
      const dash = await getVapeAdaptiveDashboard(db);
      if (cancelled) return;
      if (dash.running) {
        setVapeDelayMin(null);
        return;
      }
      setVapeDelayMin(delayMinutesForTier(dash.state.tierIndex));
    })();
    return () => {
      cancelled = true;
    };
  }, [vapeGoal?.id, goals]);

  const nextChallenge = useMemo(() => {
    if (vapeGoal && vapeDelayMin != null) {
      const def = vapeChallengeDef('delay_craving');
      return {
        title: def.title,
        subtitle: publicGoalTitle(vapeGoal),
        targetLine: `Cible : tenir ${vapeDelayMin} min avant de vapoter`,
        cta: 'Commencer',
        onPress: () => router.push('/tools/vape-adaptive'),
      };
    }
    const unstated = activeGoals.find((g) => {
      if (g.templateId === 'vape_sessions') return false;
      const tr = todayTracking[g.id];
      const status = (tr?.status ?? 'unknown') as TrackingStatus;
      return status === 'unknown';
    });
    if (unstated) {
      const challengeType = challengeTypeForTemplate(unstated.templateId);
      const displayTitle = publicGoalTitle(unstated);
      if (challengeType) {
        return {
          title: `Défi : ${displayTitle}`,
          subtitle: 'Chronomètre recommandé pour aujourd\'hui',
          targetLine: undefined,
          cta: 'Commencer',
          onPress: () => router.push(`/tools/challenges?type=${challengeType}`),
        };
      }
      return {
        title: displayTitle,
        subtitle: 'Ton suivi du jour n\'est pas encore renseigné',
        targetLine: undefined,
        cta: 'Renseigner',
        onPress: () => router.push('/(tabs)/goals'),
      };
    }
    if (activeGoals.length === 0) {
      return {
        title: 'Aucune habitude active',
        subtitle: 'Choisis une première habitude pour lancer l\'aventure',
        targetLine: undefined,
        cta: 'Ajouter une habitude',
        onPress: () => router.push('/(tabs)/goals'),
        empty: true,
      };
    }
    const doneCount = activeGoals.filter((g) => {
      const tr = todayTracking[g.id];
      const s = (tr?.status ?? 'unknown') as TrackingStatus;
      return s === 'success' || s === 'partial';
    }).length;
    return {
      title: doneCount === activeGoals.length ? 'Journée bien avancée' : 'Tout est à jour',
      subtitle:
        doneCount === activeGoals.length
          ? 'Explore une quête ou prépare demain depuis Habitudes'
          : 'Retrouve le détail de tes habitudes si besoin',
      targetLine: `${doneCount}/${activeGoals.length} habitudes renseignées aujourd'hui`,
      cta: 'Voir mes habitudes',
      onPress: () => router.push('/(tabs)/goals'),
    };
  }, [activeGoals, todayTracking, vapeGoal, vapeDelayMin, router]);

  const className = CLASSES.find((c) => c.id === profile?.classId)?.name ?? 'Voyageur';
  const totalXp = character?.totalXp ?? 0;
  const level = character?.level ?? 1;
  const inLevelXp = totalXp - (level - 1) * XP_PER_LEVEL;
  const levelProgress = inLevelXp / XP_PER_LEVEL;
  const shards = character?.shards ?? 0;

  return (
    <Screen style={{ paddingHorizontal: 0, paddingTop: 0 }}>
      <ScrollView
        contentContainerStyle={{
          paddingBottom: insets.bottom + spacing.xxl,
          paddingHorizontal: spacing.lg,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingTop: Math.max(insets.top, spacing.sm) }}>
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

        <NextChallengeCard
          title={nextChallenge.title}
          subtitle={nextChallenge.subtitle}
          targetLine={nextChallenge.targetLine}
          ctaLabel={nextChallenge.cta}
          onPress={nextChallenge.onPress}
          empty={'empty' in nextChallenge && nextChallenge.empty}
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
      </ScrollView>
    </Screen>
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
    marginTop: -spacing.md,
    paddingTop: spacing.xs,
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
  sectionTitle: { ...typography.title, color: colors.ink, marginTop: spacing.xl, fontSize: 20 },
  panelTitle: { ...typography.subtitle, color: colors.gold, marginBottom: spacing.sm },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
});