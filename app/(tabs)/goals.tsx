import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { Body, Button, Chip, Field, Screen, Title } from '@/src/design-system/ui';
import { colors, spacing } from '@/src/design-system/theme';
import { useAppStore } from '@/src/state/appStore';
import { getDb } from '@/src/data/db/client';
import { confirmGoalDay, logGoalNumeric } from '@/src/domain/services/trackingService';
import {
  getCurrentVersion,
  insertGoal,
  listGoals,
  setGoalStatus,
} from '@/src/data/db/repositories/goalRepo';
import { GOAL_KIND_LABELS, GOAL_TEMPLATES } from '@/src/data/content/goalTemplates';
import { createId } from '@/src/utils/id';
import { nowIso } from '@/src/domain/rules/dates';
import type { GoalDefinition, GoalKind, GoalTier, TrackingStatus } from '@/src/domain/models/types';
import {
  kindRequiresNumericTarget,
  parseLogValue,
  usesNumericLog,
  validateCreationTarget,
} from '@/src/domain/rules/trackingStatus';
import { HELP_LINES, HEALTH_GUARDRAIL } from '@/src/data/content/helpLines';

const STATUS_FR: Record<TrackingStatus, string> = {
  unknown: 'Non renseigné',
  success: 'Réussi',
  partial: 'Partiel',
  miss: 'Écart',
  paused: 'En pause',
};

const KINDS: GoalKind[] = ['habit', 'abstinence', 'limit', 'reduce', 'duration', 'quantity'];

export default function GoalsScreen() {
  const goals = useAppStore((s) => s.goals);
  const today = useAppStore((s) => s.today);
  const todayTracking = useAppStore((s) => s.todayTracking);
  const refresh = useAppStore((s) => s.refresh);
  const [flash, setFlash] = useState<string | null>(null);
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [versions, setVersions] = useState<Record<string, { unit: string | null; target: number | null }>>({});
  const [showCustom, setShowCustom] = useState(false);
  const [customTitle, setCustomTitle] = useState('');
  const [customKind, setCustomKind] = useState<GoalKind>('habit');
  const [customUnit, setCustomUnit] = useState('');
  const [customTarget, setCustomTarget] = useState('');
  const [customTier, setCustomTier] = useState<GoalTier>('normal');
  const [pendingTemplateId, setPendingTemplateId] = useState<string | null>(null);
  const [templateTargetDraft, setTemplateTargetDraft] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const actionLockRef = useRef(false);

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
        const next: Record<string, { unit: string | null; target: number | null }> = {};
        for (const g of goalsSnapshot) {
          if (cancelled) return;
          const v = await getCurrentVersion(db, g.id);
          next[g.id] = { unit: g.unit, target: v?.targetValue ?? null };
        }
        if (cancelled) return;
        setVersions(goalsSnapshot.length === 0 ? {} : next);
      } catch {
        if (!cancelled) showFeedback('Chargement des cibles impossible.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeGoalIdsKey]);

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
        showFeedback('Enregistré — écriture déjà comptabilisée (idempotence).');
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
      } else if (r.xpGranted > 0) {
        showFeedback(`Valeur ${parsed.value} (${STATUS_FR[r.status]}) · +${r.xpGranted} XP`);
      } else {
        showFeedback(`Valeur ${parsed.value} enregistrée (${STATUS_FR[r.status]}).`);
      }
      await refresh();
    });
  };

  const beginTemplate = async (templateId: string) => {
    const t = GOAL_TEMPLATES.find((x) => x.id === templateId);
    if (!t) return;
    try {
      const db = await getDb();
      const existing = (await listGoals(db, true)).some(
        (g) => g.templateId === templateId && g.status !== 'archived',
      );
      if (existing) {
        showFeedback('Ce modèle est déjà actif.');
        return;
      }
      setPendingTemplateId(templateId);
      setTemplateTargetDraft(t.targetValue != null ? String(t.targetValue) : '');
    } catch {
      showFeedback('Impossible de vérifier ce modèle pour le moment.');
    }
  };

  const confirmTemplate = async () => {
    if (!pendingTemplateId) return;
    const t = GOAL_TEMPLATES.find((x) => x.id === pendingTemplateId);
    if (!t) return;
    await runAction(async () => {
      const targetCheck = validateCreationTarget(
        t.kind,
        kindRequiresNumericTarget(t.kind) ? templateTargetDraft : '',
      );
      if (!targetCheck.ok) {
        showFeedback(targetCheck.error);
        return;
      }
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
          targetValue: targetCheck.value,
          scheduleKind: t.scheduleKind,
          weeklyTargetCount: t.weeklyTargetCount,
          notes: null,
          effectiveFrom: createdAt.slice(0, 10),
          effectiveTo: null,
        },
      );
      setPendingTemplateId(null);
      setTemplateTargetDraft('');
      await refresh();
      showFeedback(`Objectif « ${t.title} » ajouté.`);
    });
  };

  const createCustom = async () => {
    await runAction(async () => {
      const title = customTitle.trim();
      if (!title) {
        showFeedback('Donne un nom à l\'objectif.');
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
      await insertGoal(
        db,
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
      setCustomTitle('');
      setCustomUnit('');
      setCustomTarget('');
      setShowCustom(false);
      await refresh();
      showFeedback(`Objectif personnalisé « ${title} » créé.`);
    });
  };

  const binaryAbstinence = (g: GoalDefinition) => g.kind === 'abstinence';
  const binaryHabit = (g: GoalDefinition) => g.kind === 'habit';

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl, paddingTop: spacing.sm }}>
        <Title>Objectifs — {today}</Title>
        <Body muted>
          Vide ≠ zéro. Les jours sans saisie restent « non renseignés » (0 XP). Corrige librement dans la journée.
        </Body>
        {flash ? <Text style={styles.flash}>{flash}</Text> : null}

        {activeGoals.length === 0 ? (
          <View style={{ marginTop: spacing.md }}>
            <Body muted>Aucun objectif actif. Ajoute un modèle ou crée un objectif personnalisé.</Body>
          </View>
        ) : null}

        {activeGoals.map((g) => {
          const tr = todayTracking[g.id];
          const status = g.status === 'paused' ? 'paused' : (tr?.status ?? 'unknown');
          const ver = versions[g.id];
          const numeric = usesNumericLog(g.kind);
          const savedValue =
            tr?.value != null
              ? `${tr.value}${g.unit ? ` ${g.unit}` : ''}`
              : status === 'unknown'
                ? '—'
                : '—';
          const tpl = GOAL_TEMPLATES.find((t) => t.id === g.templateId);
          const initialDraft =
            draftValues[g.id] ?? (tr?.value != null ? String(tr.value) : '');

          return (
            <View key={g.id} style={styles.card}>
              <Text style={styles.goalTitle}>{g.title}</Text>
              <Body muted>
                {GOAL_KIND_LABELS[g.kind]}
                {ver?.target != null ? ` · cible ${ver.target}${g.unit ? ` ${g.unit}` : ''}` : ''}
              </Body>
              <Body muted>
                Statut : {STATUS_FR[status]}
                {g.status === 'paused' ? ' (objectif en pause)' : ''}
              </Body>
              <Body muted>Enregistré : {savedValue}</Body>

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
                    accessibilityLabel={`Saisie ${g.title}`}
                  />
                  <Button
                    label="Enregistrer la valeur"
                    onPress={() => saveNumeric(g)}
                    variant="primary"
                    disabled={actionBusy}
                  />
                </>
              ) : null}

              {g.status !== 'paused' && (binaryHabit(g) || binaryAbstinence(g)) ? (
                <>
                  <Body muted>Confirmation explicite requise :</Body>
                  <View style={styles.row}>
                    {binaryAbstinence(g) ? (
                      <>
                        <Chip
                          label="Jour sans consommation"
                          selected={status === 'success'}
                          onPress={() => confirm(g.id, 'success', 0)}
                        />
                        <Chip
                          label="J'ai consommé"
                          selected={status === 'miss'}
                          onPress={() => confirm(g.id, 'miss', 1)}
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

              <View style={styles.row}>
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
            </View>
          );
        })}

        <Title>Modèles (A–F)</Title>
        <Body muted>Tous optionnels. A= vape, B= alcool, C= fréquence, D= sport, E= sans écran, F= appel proche.</Body>
        <View style={styles.row}>
          {GOAL_TEMPLATES.filter((t) => t.id !== 'breathing5').map((t) => (
            <Chip
              key={t.id}
              label={`${t.category}. ${t.title}`}
              onPress={() => void beginTemplate(t.id)}
              selected={pendingTemplateId === t.id}
            />
          ))}
        </View>

        {pendingTemplateId ? (
          <View style={styles.note}>
            {(() => {
              const t = GOAL_TEMPLATES.find((x) => x.id === pendingTemplateId);
              if (!t) return null;
              return (
                <>
                  <Body>Confirmer « {t.title} »</Body>
                  {kindRequiresNumericTarget(t.kind) ? (
                    <Field
                      value={templateTargetDraft}
                      onChangeText={setTemplateTargetDraft}
                      placeholder={t.unit ? `Cible (${t.unit})` : 'Cible numérique'}
                      keyboardType="decimal-pad"
                      accessibilityLabel={`Cible pour ${t.title}`}
                    />
                  ) : (
                    <Body muted>Pas de cible numérique (confirmation quotidienne).</Body>
                  )}
                  <View style={styles.row}>
                    <Button
                      label="Créer l'objectif"
                      onPress={() => void confirmTemplate()}
                      variant="primary"
                      disabled={actionBusy}
                    />
                    <Button
                      label="Annuler"
                      onPress={() => {
                        setPendingTemplateId(null);
                        setTemplateTargetDraft('');
                      }}
                      variant="ghost"
                      disabled={actionBusy}
                    />
                  </View>
                </>
              );
            })()}
          </View>
        ) : null}

        {templateNotes.some((t) => t.alcoholSafety || t.nicotineNote) ? (
          <View style={styles.note}>
            <Body muted>{HEALTH_GUARDRAIL}</Body>
          </View>
        ) : null}

        <Title>Objectif personnalisé</Title>
        {showCustom ? (
          <View>
            <Field value={customTitle} onChangeText={setCustomTitle} placeholder="Nom" />
            <Body muted>Type</Body>
            <View style={styles.row}>
              {KINDS.map((k) => (
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
            <Button label="Créer l'objectif" onPress={() => void createCustom()} disabled={actionBusy} />
            <Button label="Annuler" onPress={() => setShowCustom(false)} variant="ghost" />
          </View>
        ) : (
          <Button label="Nouvel objectif personnalisé" onPress={() => setShowCustom(true)} variant="ghost" />
        )}
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
  note: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg,
  },
});