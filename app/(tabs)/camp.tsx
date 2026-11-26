import { useEffect, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Body, Button, Screen } from '@/src/design-system/ui';
import { colors, spacing, typography } from '@/src/design-system/theme';
import { ForestScene } from '@/src/design-system/ForestScene';
import { FantasyPanel } from '@/src/design-system/FantasyPanel';
import { ProgressBar } from '@/src/design-system/ProgressBar';
import { AdventureQuestCard, EmptyState, QuestCard } from '@/src/design-system/QuestCard';
import { CATEGORY_SHORT } from '@/src/design-system/categoryLabels';
import { GOAL_TEMPLATES } from '@/src/data/content/goalTemplates';
import { CLASSES } from '@/src/data/content/classes';
import { useAppStore } from '@/src/state/appStore';
import { getDb } from '@/src/data/db/client';
import { upgradeCamp } from '@/src/domain/services/adventureService';
import { XP_PER_LEVEL } from '@/src/domain/rules/xp';
import type { GoalDefinition, TrackingStatus } from '@/src/domain/models/types';
import { publicGoalTitle } from '@/src/domain/content/goalDisplay';
import { useState } from 'react';

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
  const [campMsg, setCampMsg] = useState<string | null>(null);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const activeGoals = useMemo(
    () => goals.filter((g) => g.status === 'active'),
    [goals],
  );

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
        <View style={{ paddingTop: Math.max(insets.top, spacing.md) }}>
          <ForestScene />
          <View style={styles.heroOverlay}>
            <Text style={styles.eloria}>Eloria</Text>
            <Text style={styles.pseudo}>{profile?.pseudo ?? 'Voyageur'}</Text>
            <Text style={styles.classLine}>
              {className} · Niveau {level}
            </Text>
            <ProgressBar
              progress={levelProgress}
              label={`${Math.round(inLevelXp)} / ${XP_PER_LEVEL} XP vers le niveau ${level + 1}`}
            />
          </View>
        </View>

        <FantasyPanel>
          <Text style={styles.panelTitle}>Ressources</Text>
          <View style={styles.resourceRow}>
            <View style={styles.resourceBox}>
              <Text style={styles.resourceValue}>{Math.round(totalXp)}</Text>
              <Text style={styles.resourceLabel}>XP totale</Text>
            </View>
            <View style={styles.resourceBox}>
              <Text style={styles.resourceValue}>{shards}</Text>
              <Text style={styles.resourceLabel}>Éclats</Text>
            </View>
            <View style={styles.resourceBox}>
              <Text style={styles.resourceValue}>{goldBalance}</Text>
              <Text style={styles.resourceLabel}>Or</Text>
            </View>
          </View>
        </FantasyPanel>

        <FantasyPanel accent>
          <Text style={styles.panelTitle}>Mes objectifs d'aujourd'hui</Text>
          <View style={{ marginBottom: spacing.sm }}>
            <Body muted>
              Chaque jour compte à ta façon. Sans saisie, le statut reste neutre — jamais un succès inventé.
            </Body>
          </View>
          {activeGoals.length === 0 ? (
            <EmptyState
              title="Aucune habitude active"
              hint="Ajoute un objectif depuis l'onglet Habitudes quand tu es prêt."
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
                  />
                </Pressable>
              );
            })
          )}
        </FantasyPanel>

        <Text style={styles.sectionTitle}>Actions rapides</Text>
        <View style={styles.quickGrid}>
          <Button label="Renseigner une habitude" onPress={() => router.push('/(tabs)/goals')} />
          <Button label="Respiration" variant="secondary" onPress={() => router.push('/tools/breathing')} />
          <Button label="Gérer une envie" variant="secondary" onPress={() => router.push('/tools/urge')} />
          <Button label="Défis chronométrés" variant="secondary" onPress={() => router.push('/tools/challenges')} />
          <Button label="Journal" variant="ghost" onPress={() => router.push('/journal')} />
        </View>

        <AdventureQuestCard
          title="Partir à l'aventure"
          description="Explore les sentiers d'Eloria, équipe ta lanterne et fais évoluer ton camp — à ton rythme."
          onPress={() => router.push('/(tabs)/adventure')}
        />
        <Button
          label="Améliorer le camp"
          variant="ghost"
          onPress={async () => {
            const db = await getDb();
            const r = await upgradeCamp(db);
            setCampMsg(r.message);
            await refresh();
          }}
        />
        {campMsg ? <Body muted>{campMsg}</Body> : null}
        <Button label="Paramètres & sauvegarde" variant="ghost" onPress={() => router.push('/settings')} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heroOverlay: {
    marginTop: -spacing.lg,
    paddingTop: spacing.sm,
  },
  eloria: { ...typography.label, color: colors.gold },
  pseudo: { ...typography.title, color: colors.ink, fontSize: 26, marginTop: 4 },
  classLine: { ...typography.body, color: colors.muted, marginTop: 2 },
  panelTitle: { ...typography.subtitle, color: colors.gold, marginBottom: spacing.sm },
  resourceRow: { flexDirection: 'row', gap: spacing.md },
  resourceBox: {
    flex: 1,
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.mist,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
  },
  resourceValue: { fontSize: 28, fontWeight: '700', color: colors.ink },
  resourceLabel: { ...typography.caption, color: colors.muted, marginTop: 4 },
  sectionTitle: { ...typography.title, color: colors.ink, marginTop: spacing.lg },
  quickGrid: { marginTop: spacing.sm },
});