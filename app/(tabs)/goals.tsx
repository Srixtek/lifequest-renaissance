import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Pressable, View, Text, StyleSheet } from 'react-native';
import { Body, Button, Chip, Field, TabScrollView } from '@/src/design-system/ui';
import { CollapsibleSection } from '@/src/design-system/CollapsibleSection';
import { colors, spacing, typography } from '@/src/design-system/theme';
import { EmptyState, QuestCard } from '@/src/design-system/QuestCard';
import { completionRatio } from '@/src/domain/rules/xp';
import { useAppStore } from '@/src/state/appStore';
import { getDb } from '@/src/data/db/client';
import { confirmGoalDay, logGoalNumeric } from '@/src/domain/services/trackingService';
import {
  getVersionForDate,
  listTrackingInRange,
  setGoalStatus,
} from '@/src/data/db/repositories/goalRepo';
import { GOAL_TEMPLATES } from '@/src/data/content/goalTemplates';
import {
  HABIT_CATEGORIES,
  HABIT_CATEGORY_BY_ID,
  activeCountLabel,
  groupGoalsByCategory,
} from '@/src/data/content/habitCategories';
import { HabitSetupFlow } from '@/src/design-system/HabitSetupFlow';
import { scheduleVersionUpdate } from '@/src/domain/services/goalLifecycleService';
import {
  countWeeklySuccessDays,
  weekBoundsMondaySunday,
} from '@/src/domain/rules/weeklyTracking';
import type { GoalDefinition, GoalKind, HabitCategoryId, TrackingStatus } from '@/src/domain/models/types';
import {
  kindRequiresNumericTarget,
  parseLogValue,
  usesNumericLog,
  validateCreationTarget,
} from '@/src/domain/rules/trackingStatus';
import { HELP_LINES, HEALTH_GUARDRAIL } from '@/src/data/content/helpLines';
import { useFocusEffect, useRouter } from 'expo-router';
import { challengeTypeForTemplate } from '@/src/domain/models/challengeSession';
import { presentHabitCard } from '@/src/domain/content/habitPresentation';
import { VapeTracker } from '@/src/design-system/VapeTracker';
import { AlcoholTracker } from '@/src/design-system/AlcoholTracker';
import { SportTracker } from '@/src/design-system/SportTracker';

const STATUS_FR: Record<TrackingStatus, string> = {
  unknown: 'Non renseigné',
  success: 'Réussi',
  partial: 'Partiel',
  miss: 'Écart',
  paused: 'En pause',
};

function displayStatus(goal: GoalDefinition, status: TrackingStatus, hasValue: boolean): string {
  if (goal.followWithoutXp && usesNumericLog(goal.kind)) {
    if (status === 'unknown' && !hasValue) return 'Non renseigné';
    if (hasValue || status !== 'unknown') return 'Renseigné';
  }
  return STATUS_FR[status];
}

export default function GoalsScreen() {
  const router = useRouter();
  const goals = useAppStore((s) => s.goals);
  const today = useAppStore((s) => s.today);
  const todayTracking = useAppStore((s) => s.todayTracking);
  const refresh = useAppStore((s) => s.refresh);
  const [flash, setFlash] = useState<string | null>(null);
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [versions, setVersions] = useState<
    Record<
      string,
      {
        unit: string | null;
        target: number | null;
        scheduleKind: 'daily' | 'weekly';
        weeklyTarget: number | null;
      }
    >
  >({});
  const [weeklyDone, setWeeklyDone] = useState<Record<string, number>>({});
  const [editTargetDraft, setEditTargetDraft] = useState<Record<string, string>>({});
  const [actionBusy, setActionBusy] = useState(false);
  const actionLockRef = useRef(false);
  const [categoryId, setCategoryId] = useState<HabitCategoryId | null>(null);
  const [mode, setMode] = useState<'track' | 'challenges'>('track');
  const [detailsOpen, setDetailsOpen] = useState<Record<string, boolean>>({});

  const activeGoals = useMemo(
    () => goals.filter((g) => g.status !== 'archived'),
    [goals],
  );
  const activeGoalIdsKey = useMemo(
    () => activeGoals.map((g) => g.id).sort().join('\0'),
    [activeGoals],
  );

  const goalsByCategory = useMemo(() => groupGoalsByCategory(activeGoals), [activeGoals]);

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (categoryId == null) return false;
        setCategoryId(null);
        return true;
      });
      return () => sub.remove();
    }, [categoryId]),
  );

  const templateNotes = useMemo(() => {
    const added = new Set(goals.map((g) => g.templateId).filter(Boolean));
    return GOAL_TEMPLATES.filter((t) => added.has(t.id));
  }, [goals]);

  const challengeGoals = useMemo(
    () =>
      activeGoals.filter((g) => {
        if (g.templateId === 'vape_sessions') return true;
        return challengeTypeForTemplate(g.templateId) != null;
      }),
    [activeGoals],
  );

  const showFeedback = (msg: string) => {
    setFlash(msg);
  };

  useEffect(() => {
    let cancelled = false;
    const goalsSnapshot = activeGoals;
    void (async () => {
      try {
        const db = await getDb();
        const next: Record<string, { unit: string | null; target: number | null; scheduleKind: 'daily' | 'weekly'; weeklyTarget: number | null }> = {};
        const weekly: Record<string, number> = {};
        const { start, end } = weekBoundsMondaySunday(today);
        for (const g of goalsSnapshot) {
          if (cancelled) return;
          const v = await getVersionForDate(db, g.id, today);
          next[g.id] = {
            unit: g.unit,
            target: v?.targetValue ?? null,
            scheduleKind: v?.scheduleKind ?? 'daily',
            weeklyTarget: v?.weeklyTargetCount ?? null,
          };
          if (v?.scheduleKind === 'weekly') {
            const rows = await listTrackingInRange(db, g.id, start, end);
            weekly[g.id] = countWeeklySuccessDays(rows, start, end);
          }
        }
        if (cancelled) return;
        setVersions(goalsSnapshot.length === 0 ? {} : next);
        setWeeklyDone(weekly);
      } catch {
        if (!cancelled) showFeedback('Chargement des cibles impossible.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeGoalIdsKey, today]);

  const refreshWeeklyForGoal = async (goalId: string) => {
    const db = await getDb();
    const v = await getVersionForDate(db, goalId, today);
    if (v?.scheduleKind !== 'weekly') return;
    const { start, end } = weekBoundsMondaySunday(today);
    const rows = await listTrackingInRange(db, goalId, start, end);
    setWeeklyDone((prev) => ({
      ...prev,
      [goalId]: countWeeklySuccessDays(rows, start, end),
    }));
  };

  const runAction = async (fn: () => Promise<void>) => {
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    setActionBusy(true);
    try {
      await fn();
    } catch {
      showFeedback('Action impossible pour le moment.');
    } finally {
      actionLockRef.current = false;
      setActionBusy(false);
    }
  };

  const confirm = async (goalId: string, status: TrackingStatus, value: number | null = null) => {
    await runAction(async () => {
      const db = await getDb();
      const r = await confirmGoalDay(db, goalId, today, status, value);
      if (status === 'unknown') {
        if (r.xpDeltaCenti < 0) {
          showFeedback(`XP ajustée : -${Math.abs(r.xpGranted)}.`);
        } else if (r.rewardUnchanged) {
          showFeedback('Statut : non renseigné (récompense inchangée).');
        } else {
          showFeedback('Statut : non renseigné (0 XP, aucun éclat).');
        }
      } else if (r.legacyDay) {
        showFeedback(
          r.rewardUnchanged
            ? 'Enregistré — journée historique, récompense inchangée.'
            : 'Enregistré — journée historique (règles antérieures conservées).',
        );
      } else if (r.addedAfterSnapshot) {
        showFeedback(
          'Enregistré. Cet objectif comptera pour l\'XP à partir de demain (budget du jour déjà figé).',
        );
      } else if (r.duplicate) {
        showFeedback('Déjà enregistré pour aujourd\'hui — rien n\'a été modifié.');
      } else if (r.rewardUnchanged) {
        const shard = r.shardsGranted ? ' · +1 éclat de participation' : '';
        showFeedback(`Enregistré, récompense inchangée.${shard}`);
      } else if (r.xpDeltaCenti < 0) {
        const shard = r.shardsGranted ? ' · +1 éclat de participation' : '';
        showFeedback(`XP ajustée : -${Math.abs(r.xpGranted)}.${shard}`);
      } else if (r.xpGranted > 0) {
        const shard = r.shardsGranted ? ' · +1 éclat de participation' : '';
        showFeedback(`+${r.xpGranted} XP${shard}`);
      } else {
        const shard = r.shardsGranted ? ' · +1 éclat de participation' : '';
        showFeedback(`Enregistré.${shard}`);
      }
      await refreshWeeklyForGoal(goalId);
      await refresh();
    });
  };

  const saveNumeric = async (goal: GoalDefinition) => {
    await runAction(async () => {
      const raw = draftValues[goal.id] ?? '';
      const parsed = parseLogValue(raw);
      if (!parsed.ok) {
        showFeedback(parsed.error === 'Vide' ? 'Saisis une valeur (le vide n\'est pas zéro).' : parsed.error);
        return;
      }
      const db = await getDb();
      const r = await logGoalNumeric(db, goal.id, today, parsed.value);
      if (r.addedAfterSnapshot) {
        showFeedback(
          `${STATUS_FR[r.status]} — objectif hors budget du jour, XP dès demain.`,
        );
      } else if (r.rewardUnchanged) {
        showFeedback(
          `Valeur ${parsed.value} (${STATUS_FR[r.status]}) — enregistré, récompense inchangée.`,
        );
      } else if (r.xpDeltaCenti < 0) {
        showFeedback(
          `Valeur ${parsed.value} (${STATUS_FR[r.status]}) — XP ajustée : -${Math.abs(r.xpGranted)}.`,
        );
      } else if (goal.followWithoutXp) {
        showFeedback(`Valeur ${parsed.value} enregistrée (suivi neutre).`);
      } else if (r.xpGranted > 0) {
        showFeedback(`Valeur ${parsed.value} (${STATUS_FR[r.status]}) · +${r.xpGranted} XP`);
      } else {
        showFeedback(`Valeur ${parsed.value} enregistrée (${STATUS_FR[r.status]}).`);
      }
      await refreshWeeklyForGoal(goal.id);
      await refresh();
    });
  };

  const applyTargetEdit = async (goalId: string, kind: GoalKind) => {
    await runAction(async () => {
      const raw = editTargetDraft[goalId] ?? '';
      const db = await getDb();
      const ver = versions[goalId];
      if (ver?.scheduleKind === 'weekly') {
        const w = Number(raw);
        if (!Number.isInteger(w) || w < 1 || w > 7) {
          showFeedback('Nombre de jours par semaine : entre 1 et 7.');
          return;
        }
        const { effectiveFrom } = await scheduleVersionUpdate(db, goalId, today, {
          weeklyTargetCount: w,
        });
        showFeedback(`Objectif hebdo mis à jour — effet à partir du ${effectiveFrom}.`);
      } else {
        const check = validateCreationTarget(kind, raw);
        if (!check.ok) {
          showFeedback(check.error);
          return;
        }
        if (check.value == null) {
          showFeedback('Un repère numérique est requis.');
          return;
        }
        const { effectiveFrom } = await scheduleVersionUpdate(db, goalId, today, {
          targetValue: check.value,
        });
        showFeedback(`Objectif mis à jour — effet à partir du ${effectiveFrom} (historique inchangé).`);
      }
      await refresh();
    });
  };

  const binaryAbstinence = (g: GoalDefinition) => g.kind === 'abstinence';
  const binaryHabit = (g: GoalDefinition) =>
    g.kind === 'habit' && versions[g.id]?.scheduleKind !== 'weekly';
  const binaryWeeklyHabit = (g: GoalDefinition) =>
    g.kind === 'habit' && versions[g.id]?.scheduleKind === 'weekly';

  const toggleDetails = (goalId: string) => {
    setDetailsOpen((d) => ({ ...d, [goalId]: !d[goalId] }));
  };

  const inCategory = mode === 'track' && categoryId != null;
  const categoryDef = categoryId ? HABIT_CATEGORY_BY_ID[categoryId] : null;
  const goalsToRender =
    mode === 'challenges' ? challengeGoals : categoryId ? goalsByCategory[categoryId] : [];

  return (
    <TabScrollView>
        {inCategory && categoryDef ? (
          <>
            <View style={styles.topRow}>
              <Button
                label="← Habitudes"
                variant="secondary"
                compact
                onPress={() => setCategoryId(null)}
              />
              <Button label="Paramètres" variant="ghost" compact onPress={() => router.push('/settings')} />
            </View>
            <Text style={styles.categoryTitle}>
              {categoryDef.symbol} {categoryDef.label}
            </Text>
            {categoryId === 'vape' ? <VapeTracker /> : null}
            {categoryId === 'alcool' ? <AlcoholTracker /> : null}
            {categoryId === 'sport' ? <SportTracker /> : null}
          </>
        ) : (
          <>
            <View style={styles.topRow}>
              <Text style={styles.dateLine}>{today}</Text>
              <Button label="Paramètres" variant="ghost" compact onPress={() => router.push('/settings')} />
            </View>
            <Body muted>
              Vide ≠ zéro : un jour sans saisie reste « non renseigné » (0 XP). Corrige librement dans la journée.
            </Body>
          </>
        )}
        {flash ? <Text style={styles.flash}>{flash}</Text> : null}

        {inCategory ? null : (
          <View style={styles.modeRow}>
            <Chip label="Suivre mes habitudes" selected={mode === 'track'} onPress={() => setMode('track')} />
            <Chip label="Relever des défis" selected={mode === 'challenges'} onPress={() => setMode('challenges')} />
          </View>
        )}

        {mode === 'challenges' ? (
          <Text style={styles.sectionHeading}>Défis liés à tes habitudes</Text>
        ) : null}

        {mode === 'track' && !inCategory ? (
          <View style={styles.grid}>
            {HABIT_CATEGORIES.map((c) => {
              const count = goalsByCategory[c.id].length;
              return (
                <Pressable
                  key={c.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${c.label}, ${activeCountLabel(count)}`}
                  onPress={() => setCategoryId(c.id)}
                  style={({ pressed }) => [
                    styles.tile,
                    { borderColor: c.color },
                    count === 0 && styles.tileEmpty,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text style={styles.tileSymbol}>{c.symbol}</Text>
                  <Text style={[styles.tileName, { color: c.color }]} numberOfLines={1}>
                    {c.label}
                  </Text>
                  <Text style={styles.tileCount}>{activeCountLabel(count)}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {(mode === 'challenges' || (inCategory && categoryId !== 'alcool' && categoryId !== 'sport')) && goalsToRender.length === 0 ? (
          <EmptyState
            title={mode === 'track' ? 'Aucune habitude ici' : 'Aucun défi disponible'}
            hint={
              mode === 'track'
                ? 'Ajoute un modèle guidé depuis l\'écran Habitudes, ou crée la tienne dans Paramètres.'
                : 'Active une habitude avec défi (ex. vape) depuis l\'onglet Suivre.'
            }
          />
        ) : null}

        {mode === 'track' && categoryId === 'sport' && goalsToRender.length > 0 ? (
          <Text style={styles.sectionHeading}>Mes habitudes Sport</Text>
        ) : null}

        {goalsToRender.map((g) => {
          const tr = todayTracking[g.id];
          const rawStatus = g.status === 'paused' ? 'paused' : (tr?.status ?? 'unknown');
          const status = rawStatus;
          const statusLabel = displayStatus(g, rawStatus, tr?.value != null);
          const ver = versions[g.id];
          const numeric = usesNumericLog(g.kind);
          const tpl = GOAL_TEMPLATES.find((t) => t.id === g.templateId);
          const initialDraft =
            draftValues[g.id] ?? (tr?.value != null ? String(tr.value) : '');
          const presentation = presentHabitCard(
            g,
            ver
              ? {
                  unit: g.unit,
                  target: ver.target,
                  scheduleKind: ver.scheduleKind,
                  weeklyTarget: ver.weeklyTarget,
                }
              : undefined,
            tr ? { status: rawStatus, value: tr.value } : undefined,
            weeklyDone[g.id] ?? 0,
          );
          const progress =
            !g.followWithoutXp &&
            ver?.target != null &&
            tr?.value != null &&
            rawStatus !== 'unknown'
              ? completionRatio(status, g.kind, tr.value, ver.target)
              : undefined;
          const challengeType = challengeTypeForTemplate(g.templateId);
          const displayTitle = presentation.title;

          const showTrackControls = mode === 'track';
          const showChallengeCtas = mode === 'challenges';

          return (
            <QuestCard
              key={g.id}
              title={displayTitle}
              category={tpl?.category}
              status={status}
              statusLabel={statusLabel}
              targetLabel={presentation.objectiveLine}
              valueLabel={presentation.todayValueLabel}
              progress={progress}
            >
              {showChallengeCtas && g.templateId === 'vape_sessions' ? (
                <Button
                  label="Ouvrir mes défis vape"
                  onPress={() => router.push('/tools/vape-adaptive')}
                  disabled={actionBusy}
                />
              ) : null}
              {showChallengeCtas && challengeType && g.templateId !== 'vape_sessions' ? (
                <Button
                  label="Lancer le défi chronométré"
                  onPress={() => router.push(`/tools/challenges?type=${challengeType}`)}
                  disabled={actionBusy}
                />
              ) : null}

              {!showTrackControls ? null : (
                <>
              <Text style={styles.questionLine}>{presentation.dailyQuestion}</Text>
              {presentation.breathingManualNote ? (
                <View style={styles.note}>
                  <Body muted>{presentation.breathingManualNote}</Body>
                </View>
              ) : null}
              {tpl?.neutralNote ? (
                <View style={styles.note}>
                  <Body>{tpl.neutralNote}</Body>
                </View>
              ) : null}
              {tpl?.nicotineNote ? (
                <View style={styles.note}>
                  <Body>
                    Nicotine : aides validées (39 89). Aucune abstinence automatique — déclare tes séances.
                  </Body>
                </View>
              ) : null}
              {tpl?.alcoholSafety ? (
                <View style={styles.note}>
                  <Body>
                    Précaution : un arrêt brutal peut être dangereux — parles-en à un médecin ({HELP_LINES[1].phone}).
                    Verre standard FR = 10 g d'alcool pur.
                  </Body>
                </View>
              ) : null}

              {g.status !== 'paused' && numeric ? (
                <>
                  <Field
                    value={initialDraft}
                    onChangeText={(t) => setDraftValues((d) => ({ ...d, [g.id]: t }))}
                    placeholder={presentation.inputPlaceholder}
                    keyboardType="decimal-pad"
                    accessibilityLabel={presentation.inputAccessibilityLabel}
                  />
                  <Button
                    label={presentation.primaryLogLabel}
                    onPress={() => saveNumeric(g)}
                    variant="primary"
                    disabled={actionBusy}
                  />
                </>
              ) : null}

              {presentation.weeklyHint ? <Body muted>{presentation.weeklyHint}</Body> : null}

              {g.status !== 'paused' && (binaryHabit(g) || binaryAbstinence(g) || binaryWeeklyHabit(g)) ? (
                <>
                  {presentation.binaryPrompt ? (
                    <Body muted>{presentation.binaryPrompt}</Body>
                  ) : null}
                  <View style={styles.row}>
                    {binaryAbstinence(g) || binaryWeeklyHabit(g) || binaryHabit(g) ? (
                      <>
                        <Chip
                          label={presentation.binarySuccessLabel}
                          selected={status === 'success'}
                          onPress={() => {
                            if (binaryAbstinence(g)) void confirm(g.id, 'success', 0);
                            else void confirm(g.id, 'success');
                          }}
                        />
                        <Chip
                          label={presentation.binaryMissLabel}
                          selected={status === 'miss'}
                          onPress={() => {
                            if (binaryAbstinence(g)) void confirm(g.id, 'miss', 1);
                            else void confirm(g.id, 'miss');
                          }}
                        />
                      </>
                    ) : null}
                    <Chip
                      label="Non renseigné"
                      selected={status === 'unknown'}
                      onPress={() => confirm(g.id, 'unknown', null)}
                    />
                  </View>
                </>
              ) : null}

              {detailsOpen[g.id] ? (
                <>
                  {(kindRequiresNumericTarget(g.kind) || ver?.scheduleKind === 'weekly') && g.status !== 'paused' ? (
                    <View style={styles.note}>
                      <Body>{presentation.editTargetTitle}</Body>
                      <Field
                        value={editTargetDraft[g.id] ?? (ver?.weeklyTarget != null ? String(ver.weeklyTarget) : ver?.target != null ? String(ver.target) : '')}
                        onChangeText={(t) => setEditTargetDraft((d) => ({ ...d, [g.id]: t }))}
                        keyboardType="decimal-pad"
                        placeholder={presentation.editTargetPlaceholder}
                      />
                      <Button
                        label={presentation.editTargetSaveLabel}
                        variant="secondary"
                        disabled={actionBusy}
                        onPress={() => void applyTargetEdit(g.id, g.kind)}
                      />
                    </View>
                  ) : null}
                  <Body muted>{presentation.pauseHint}</Body>
                  <Body muted>{presentation.archiveHint}</Body>
                  <View style={styles.manageRow}>
                    <Chip
                      label={g.status === 'paused' ? 'Reprendre' : 'Pause'}
                      onPress={() => {
                        void runAction(async () => {
                          const db = await getDb();
                          await setGoalStatus(db, g.id, g.status === 'paused' ? 'active' : 'paused');
                          await refresh();
                        });
                      }}
                    />
                    <Chip
                      label="Archiver"
                      onPress={() => {
                        void runAction(async () => {
                          const db = await getDb();
                          await setGoalStatus(db, g.id, 'archived');
                          showFeedback('Archivé — l\'historique est conservé.');
                          await refresh();
                        });
                      }}
                    />
                  </View>
                </>
              ) : null}
              <Button
                label={
                  detailsOpen[g.id] ? presentation.settingsToggleOpen : presentation.settingsToggleClosed
                }
                variant="ghost"
                onPress={() => toggleDetails(g.id)}
                disabled={actionBusy}
              />
                </>
              )}
            </QuestCard>
          );
        })}

        {mode === 'track' && !inCategory ? (
          <CollapsibleSection title="Ajouter une habitude" hint="Modèles guidés ; création libre dans Paramètres">
            <Body muted>Catégorie → intention → cible → valider.</Body>
            <HabitSetupFlow disabled={actionBusy} onFeedback={showFeedback} onDone={refresh} />
          </CollapsibleSection>
        ) : null}

        {templateNotes.some((t) => t.alcoholSafety || t.nicotineNote) ? (
          <View style={styles.note}>
            <Body muted>{HEALTH_GUARDRAIL}</Body>
          </View>
        ) : null}

    </TabScrollView>
  );
}

const styles = StyleSheet.create({
  dateLine: { ...typography.caption, color: colors.gold },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
  },
  categoryTitle: { ...typography.title, color: colors.ink, marginBottom: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: spacing.xs },
  tile: {
    width: '48%',
    minHeight: 104,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: 14,
    borderWidth: 1.5,
    backgroundColor: colors.card,
    justifyContent: 'center',
  },
  tileEmpty: { opacity: 0.6 },
  tileSymbol: { fontSize: 28, marginBottom: 2 },
  tileName: { ...typography.subtitle },
  tileCount: { ...typography.caption, color: colors.muted, marginTop: 2 },
  sectionHeading: {
    ...typography.subtitle,
    color: colors.ink,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm },
  manageRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.md, opacity: 0.9 },
  flash: { color: colors.ember, marginTop: spacing.sm },
  questionLine: {
    ...typography.body,
    color: colors.ink,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  note: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg,
  },
  modeRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.md, marginBottom: spacing.sm },
});