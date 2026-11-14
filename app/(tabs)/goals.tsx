import { useState } from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { Body, Button, Chip, Screen, Title } from '@/src/design-system/ui';
import { colors, spacing } from '@/src/design-system/theme';
import { useAppStore } from '@/src/state/appStore';
import { getDb } from '@/src/data/db/client';
import { confirmGoalDay } from '@/src/domain/services/trackingService';
import { insertGoal, setGoalStatus } from '@/src/data/db/repositories/goalRepo';
import { GOAL_TEMPLATES } from '@/src/data/content/goalTemplates';
import { createId } from '@/src/utils/id';
import { nowIso } from '@/src/domain/rules/dates';
import type { TrackingStatus } from '@/src/domain/models/types';

export default function GoalsScreen() {
  const goals = useAppStore((s) => s.goals);
  const today = useAppStore((s) => s.today);
  const todayTracking = useAppStore((s) => s.todayTracking);
  const refresh = useAppStore((s) => s.refresh);
  const [flash, setFlash] = useState<string | null>(null);

  const confirm = async (goalId: string, status: TrackingStatus, value: number | null = null) => {
    const db = await getDb();
    const r = await confirmGoalDay(db, goalId, today, status, value);
    setFlash(
      r.duplicate
        ? 'XP déjà versée pour cet objectif aujourd\'hui (idempotence).'
        : status === 'unknown'
          ? 'Statut : non renseigné (0 XP).'
          : `+${r.xpGranted} XP · +${r.shardsGranted} éclat(s)`,
    );
    await refresh();
  };

  const addTemplate = async (templateId: string) => {
    const t = GOAL_TEMPLATES.find((x) => x.id === templateId);
    if (!t) return;
    const db = await getDb();
    const goalId = createId('goal');
    const createdAt = nowIso();
    await insertGoal(
      db,
      {
        id: goalId,
        title: t.title,
        kind: t.kind,
        unit: t.unit,
        weight: 1,
        status: 'active',
        templateId: t.id,
        sensitive: !!t.sensitive,
        followWithoutXp: false,
        createdAt,
      },
      {
        id: createId('gver'),
        goalId,
        version: 1,
        tier: t.defaultTier,
        targetValue: t.targetValue,
        scheduleKind: t.scheduleKind,
        weeklyTargetCount: t.weeklyTargetCount,
        notes: null,
        effectiveFrom: createdAt.slice(0, 10),
        effectiveTo: null,
      },
    );
    await refresh();
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl, paddingTop: spacing.sm }}>
        <Title>Objectifs — {today}</Title>
        <Body muted>Par défaut : Non renseigné. Confirme honnêtement.</Body>
        {flash ? <Text style={styles.flash}>{flash}</Text> : null}

        {goals.map((g) => {
          const tr = todayTracking[g.id];
          const status = tr?.status ?? 'unknown';
          return (
            <View key={g.id} style={styles.card}>
              <Text style={styles.goalTitle}>{g.title}</Text>
              <Body muted>
                Statut : {status === 'unknown' ? 'Non renseigné' : status} · {g.status}
              </Body>
              <View style={styles.row}>
                <Chip label="Fait" selected={status === 'success'} onPress={() => confirm(g.id, 'success')} />
                <Chip label="Partiel" selected={status === 'partial'} onPress={() => confirm(g.id, 'partial')} />
                <Chip label="Écart" selected={status === 'miss'} onPress={() => confirm(g.id, 'miss')} />
                <Chip label="Non renseigné" selected={status === 'unknown'} onPress={() => confirm(g.id, 'unknown')} />
              </View>
              <View style={styles.row}>
                <Chip
                  label="Pause"
                  onPress={async () => {
                    const db = await getDb();
                    await setGoalStatus(db, g.id, g.status === 'paused' ? 'active' : 'paused');
                    await refresh();
                  }}
                />
                <Chip
                  label="Archiver"
                  onPress={async () => {
                    const db = await getDb();
                    await setGoalStatus(db, g.id, 'archived');
                    await refresh();
                  }}
                />
              </View>
            </View>
          );
        })}

        <Title>Ajouter un modèle</Title>
        <View style={styles.row}>
          {GOAL_TEMPLATES.map((t) => (
            <Chip key={t.id} label={`+ ${t.title}`} onPress={() => addTemplate(t.id)} />
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bgElevated,
  },
  goalTitle: { color: colors.ink, fontSize: 17, fontWeight: '700' },
  row: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm },
  flash: { color: colors.ember, marginTop: spacing.sm },
});
