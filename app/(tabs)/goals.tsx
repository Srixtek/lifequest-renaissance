import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View, Text, StyleSheet } from 'react-native';
import { Body, Button, Chip, Field, Screen, Title } from '@/src/design-system/ui';
import { colors, spacing, typography } from '@/src/design-system/theme';
import { FantasyPanel } from '@/src/design-system/FantasyPanel';
import { EmptyState, QuestCard } from '@/src/design-system/QuestCard';
import { completionRatio } from '@/src/domain/rules/xp';
import { useAppStore } from '@/src/state/appStore';
import { getDb } from '@/src/data/db/client';
import { confirmGoalDay, logGoalNumeric } from '@/src/domain/services/trackingService';
import {
  getVersionForDate,
  insertGoal,
  listTrackingInRange,
  setGoalStatus,
} from '@/src/data/db/repositories/goalRepo';
import { GOAL_KIND_LABELS, GOAL_TEMPLATES } from '@/src/data/content/goalTemplates';
import { createId } from '@/src/utils/id';
import { nowIso } from '@/src/domain/rules/dates';
import type { GoalTier } from '@/src/domain/models/types';
import { HabitSetupFlow } from '@/src/design-system/HabitSetupFlow';
import { scheduleVersionUpdate } from '@/src/domain/services/goalLifecycleService';
import {
  countWeeklySuccessDays,
  formatWeeklyProgress,
  weekBoundsMondaySunday,
} from '@/src/domain/rules/weeklyTracking';
import type { GoalDefinition, GoalKind, TrackingStatus } from '@/src/domain/models/types';
import {
  kindRequiresNumericTarget,
  parseLogValue,
  usesNumericLog,
  validateCreationTarget,
} from '@/src/domain/rules/trackingStatus';
import { HELP_LINES, HEALTH_GUARDRAIL } from '@/src/data/content/helpLines';
import { useRouter } from 'expo-router';
import { challengeTypeForTemplate } from '@/src/domain/models/challengeSession';
import { publicGoalTitle } from '@/src/domain/content/goalDisplay';

const STATUS_FR: Record<TrackingStatus, string> = {
  unknown: 'Non renseigné',
  success: 'Réussi',
  partial: 'Partiel',
  miss: 'Écart',
  paused: 'En pause',
};

const CUSTOM_KINDS: GoalKind[] = ['habit', 'abstinence', 'limit', 'reduce', 'duration', 'quantity'];

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
  const [showCustom, setShowCustom] = useState(false);
  const [customTitle, setCustomTitle] = useState('');
  const [customKind, setCustomKind] = useState<GoalKind>('habit');
  const [customUnit, setCustomUnit] = useState('');
  const [customTarget, setCustomTarget] = useState('');
  const [customTier, setCustomTier] = useState<GoalTier>('normal');

  const activeGoals = useMemo(
    () => goals.filter((g) => g.status !== 'archived'),
    [goals],
  );
  const activeGoalIdsKey = useMemo(
    () => activeGoals.map((g) => g.id).sort().join('\0'),
    [activeGoals],
  );

  const templateNotes = useMemo(() => {
    const added = new Set(goals.map((g) => g.templateId).filter(Boolean));
    return GOAL_TEMPLATES.filter((t) => added.has(t.id));
  }, [goals]);

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

  const createCustom = async () => {
    await runAction(async () => {
      const title = customTitle.trim();
      if (!title) {
        showFeedback('Donne un nom à l\'habitude.');
        return;
      }
      const targetCheck = validateCreationTarget(customKind, customTarget);
      if (!targetCheck.ok) {
        showFeedback(targetCheck.error);
        return;
      }
      const db = await getDb();
      const goalId = createId('goal');
      const createdAt = nowIso();
      const unit = customUnit.trim() || null;
      await db.withExclusiveTransactionAsync(async (tx) => {
        await insertGoal(
          tx,
          {
            id: goalId,
            title,
            kind: customKind,
            unit,
            weight: 1,
            status: 'active',
            templateId: null,
            sensitive: false,
            followWithoutXp: false,
            createdAt,
          },
          {
            id: createId('gver'),
            goalId,
            version: 1,
            tier: customTier,
            targetValue: targetCheck.value,
            scheduleKind: 'daily',
            weeklyTargetCount: null,
            notes: null,
            effectiveFrom: createdAt.slice(0, 10),
            effectiveTo: null,
          },
        );
      });
      setCustomTitle('');
      setCustomUnit('');
      setCustomTarget('');
      setShowCustom(false);
      await refresh();
      showFeedback(`Habitude personnalisée « ${title} » créée.`);
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
        showFeedback(`Cible hebdo mise à jour — effet à partir du ${effectiveFrom}.`);
      } else {
        const check = validateCreationTarget(kind, raw);
        if (!check.ok) {
          showFeedback(check.error);
          return;
        }
        if (check.value == null) {
          showFeedback('Une cible numérique est requise.');
          return;
        }
        const { effectiveFrom } = await scheduleVersionUpdate(db, goalId, today, {
          targetValue: check.value,
        });
        showFeedback(`Cible mise à jour — effet à partir du ${effectiveFrom} (historique inchangé).`);
      }
      await refresh();
    });
  };

  const binaryAbstinence = (g: GoalDefinition) => g.kind === 'abstinence';
  const binaryHabit = (g: GoalDefinition) =>
    g.kind === 'habit' && versions[g.id]?.scheduleKind !== 'weekly';
  const binaryWeeklyHabit = (g: GoalDefinition) =>
    g.kind === 'habit' && versions[g.id]?.scheduleKind === 'weekly';

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl, paddingTop: spacing.sm }}>
        <Title>Habitudes</Title>
        <Text style={styles.dateLine}>{today}</Text>
        <Body muted>
          Vide ≠ zéro. Les jours sans saisie restent « non renseignés » (0 XP). Corrige librement dans la journée.
        </Body>
        {flash ? <Text style={styles.flash}>{flash}</Text> : null}

        <Text style={styles.sectionHeading}>Mes habitudes actives</Text>
        {activeGoals.length === 0 ? (
          <EmptyState
            title="Pas encore d'habitude"
            hint="Choisis un modèle ci-dessous ou crée un objectif sur mesure."
          />
        ) : null}

        {activeGoals.map((g) => {
          const tr = todayTracking[g.id];
          const rawStatus = g.status === 'paused' ? 'paused' : (tr?.status ?? 'unknown');
          const status = rawStatus;
          const statusLabel = displayStatus(g, rawStatus, tr?.value != null);
          const ver = versions[g.id];
          const numeric = usesNumericLog(g.kind);
          const savedValue =
            tr?.value != null
              ? `${tr.value}${g.unit ? ` ${g.unit}` : ''}`
              : '—';
          const tpl = GOAL_TEMPLATES.find((t) => t.id === g.templateId);
          const initialDraft =
            draftValues[g.id] ?? (tr?.value != null ? String(tr.value) : '');
          const targetLabel =
            ver?.scheduleKind === 'weekly' && ver.weeklyTarget != null
              ? formatWeeklyProgress(weeklyDone[g.id] ?? 0, ver.weeklyTarget)
              : ver?.target != null
                ? `Cible : ${ver.target}${g.unit ? ` ${g.unit}` : ''}`
                : g.kind === 'abstinence'
                  ? 'Abstinence déclarée'
                  : g.followWithoutXp
                    ? 'Suivi neutre'
                    : 'Confirmation quotidienne';
          const progress =
            !g.followWithoutXp &&
            ver?.target != null &&
            tr?.value != null &&
            rawStatus !== 'unknown'
              ? completionRatio(status, g.kind, tr.value, ver.target)
              : undefined;
          const challengeType = challengeTypeForTemplate(g.templateId);
          const displayTitle = publicGoalTitle(g);

          return (
            <QuestCard
              key={g.id}
              title={displayTitle}
              category={tpl?.category}
              status={status}
              statusLabel={statusLabel}
              targetLabel={targetLabel}
              valueLabel={savedValue}
              progress={progress}
            >

              {g.templateId === 'vape_sessions' ? (
                <Button
                  label="Mes défis"
                  variant="secondary"
                  onPress={() => router.push('/tools/vape-adaptive')}
                  disabled={actionBusy}
                />
              ) : null}
              {challengeType && g.templateId !== 'vape_sessions' ? (
                <Button
                  label="Ouvrir le défi chronométré"
                  variant="secondary"
                  onPress={() => router.push(`/tools/challenges?type=${challengeType}`)}
                  disabled={actionBusy}
                />
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
                    placeholder={g.unit ? `Quantité (${g.unit})` : 'Valeur'}
                    keyboardType="decimal-pad"
                    accessibilityLabel={`Saisie ${displayTitle}`}
                  />
                  <Button
                    label="Enregistrer la valeur"
                    onPress={() => saveNumeric(g)}
                    variant="primary"
                    disabled={actionBusy}
                  />
                </>
              ) : null}

              {ver?.scheduleKind === 'weekly' ? (
                <Body muted>Suivi hebdomadaire — pas encore de récompense RPG sur cette habitude.</Body>
              ) : null}

              {g.status !== 'paused' && (binaryHabit(g) || binaryAbstinence(g) || binaryWeeklyHabit(g)) ? (
                <>
                  <Body muted>Confirmation du jour (réversible) :</Body>
                  <View style={styles.row}>
                    {binaryAbstinence(g) ? (
                      <>
                        <Chip
                          label="Journée sans consommation"
                          selected={status === 'success'}
                          onPress={() => confirm(g.id, 'success', 0)}
                        />
                        <Chip
                          label="Consommation déclarée"
                          selected={status === 'miss'}
                          onPress={() => confirm(g.id, 'miss', 1)}
                        />
                      </>
                    ) : binaryWeeklyHabit(g) ? (
                      <>
                        <Chip
                          label="Appel fait"
                          selected={status === 'success'}
                          onPress={() => confirm(g.id, 'success')}
                        />
                        <Chip
                          label="Pas d'appel"
                          selected={status === 'miss'}
                          onPress={() => confirm(g.id, 'miss')}
                        />
                      </>
                    ) : (
                      <>
                        <Chip
                          label="Fait"
                          selected={status === 'success'}
                          onPress={() => confirm(g.id, 'success')}
                        />
                        <Chip label="Pas fait" selected={status === 'miss'} onPress={() => confirm(g.id, 'miss')} />
                      </>
                    )}
                    <Chip
                      label="Non renseigné"
                      selected={status === 'unknown'}
                      onPress={() => confirm(g.id, 'unknown', null)}
                    />
                  </View>
                </>
              ) : null}

              {(kindRequiresNumericTarget(g.kind) || ver?.scheduleKind === 'weekly') && g.status !== 'paused' ? (
                <View style={styles.note}>
                  <Body>Modifier mon objectif (effet dès demain)</Body>
                  <Field
                    value={editTargetDraft[g.id] ?? (ver?.weeklyTarget != null ? String(ver.weeklyTarget) : ver?.target != null ? String(ver.target) : '')}
                    onChangeText={(t) => setEditTargetDraft((d) => ({ ...d, [g.id]: t }))}
                    keyboardType="decimal-pad"
                    placeholder={ver?.scheduleKind === 'weekly' ? 'Jours / semaine' : 'Nouvelle cible'}
                  />
                  <Button
                    label="Enregistrer la cible"
                    variant="secondary"
                    disabled={actionBusy}
                    onPress={() => void applyTargetEdit(g.id, g.kind)}
                  />
                </View>
              ) : null}

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
            </QuestCard>
          );
        })}

        <FantasyPanel accent>
          <Text style={styles.sectionHeading}>Ajouter une habitude</Text>
          <Body muted>Catégorie → intention → cible → valider.</Body>
          <HabitSetupFlow
            disabled={actionBusy}
            onFeedback={showFeedback}
            onDone={refresh}
          />
        </FantasyPanel>

        <FantasyPanel>
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowCustom((v) => !v)}
            style={styles.customToggle}
          >
            <Text style={styles.sectionHeading}>Créer une habitude personnalisée</Text>
            <Body muted>{showCustom ? 'Masquer' : 'Déplier pour nom, type, unité et cible'}</Body>
          </Pressable>
          {showCustom ? (
            <View>
              <Field value={customTitle} onChangeText={setCustomTitle} placeholder="Nom" />
              <Body muted>Type</Body>
              <View style={styles.row}>
                {CUSTOM_KINDS.map((k) => (
                  <Chip
                    key={k}
                    label={GOAL_KIND_LABELS[k]}
                    selected={customKind === k}
                    onPress={() => {
                      setCustomKind(k);
                      if (!kindRequiresNumericTarget(k)) setCustomTarget('');
                    }}
                  />
                ))}
              </View>
              <Field value={customUnit} onChangeText={setCustomUnit} placeholder="Unité (facultatif)" />
              {kindRequiresNumericTarget(customKind) ? (
                <Field
                  value={customTarget}
                  onChangeText={setCustomTarget}
                  placeholder="Cible numérique (obligatoire)"
                  keyboardType="decimal-pad"
                />
              ) : (
                <Body muted>Pas de cible numérique pour ce type.</Body>
              )}
              <View style={styles.row}>
                {(['minimal', 'normal', 'ambitieux'] as GoalTier[]).map((tier) => (
                  <Chip
                    key={tier}
                    label={tier}
                    selected={customTier === tier}
                    onPress={() => setCustomTier(tier)}
                  />
                ))}
              </View>
              <View style={styles.row}>
                <Button label="Créer l'habitude" onPress={() => void createCustom()} disabled={actionBusy} />
                <Button
                  label="Annuler"
                  onPress={() => {
                    setShowCustom(false);
                    setCustomTitle('');
                    setCustomUnit('');
                    setCustomTarget('');
                  }}
                  variant="ghost"
                  disabled={actionBusy}
                />
              </View>
            </View>
          ) : null}
        </FantasyPanel>

        {templateNotes.some((t) => t.alcoholSafety || t.nicotineNote) ? (
          <View style={styles.note}>
            <Body muted>{HEALTH_GUARDRAIL}</Body>
          </View>
        ) : null}

      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  dateLine: { ...typography.caption, color: colors.gold, marginBottom: spacing.sm },
  sectionHeading: {
    ...typography.subtitle,
    color: colors.ink,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm },
  manageRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.md, opacity: 0.9 },
  flash: { color: colors.ember, marginTop: spacing.sm },
  note: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg,
  },
  customToggle: { marginBottom: spacing.sm },
});