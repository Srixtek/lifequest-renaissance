import { useRef, useState } from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import { Body, Button, Chip, Field } from './ui';
import { colors, spacing, typography } from './theme';
import { CATEGORY_LABELS } from './categoryLabels';
import {
  DEFAULT_WEEKLY_CALL_TARGET,
  INTENTION_OPTIONS,
  MAX_WEEKLY_CALLS,
  MIN_WEEKLY_CALLS,
  intentionRequiresNumericTarget,
  intentionRequiresWeeklyCount,
  resolveHabitPlan,
  CONFIG_CATEGORY_LABELS,
  type HabitCategory,
  type HabitIntentionChoice,
} from '@/src/domain/content/habitIntentions';
import { getDb } from '@/src/data/db/client';
import { findActiveByTemplateId } from '@/src/data/db/repositories/goalRepo';
import {
  archiveAndRecreateForModeChange,
  createHabitGoal,
} from '@/src/domain/services/goalLifecycleService';
import { validateCreationTarget } from '@/src/domain/rules/trackingStatus';
import type { GoalTier } from '@/src/domain/models/types';
import { friendlyDbError } from '@/src/utils/dbErrors';

const CATEGORIES: HabitCategory[] = ['A', 'B', 'C', 'D', 'E', 'F'];

type Step = 'category' | 'intention' | 'target';

export function HabitSetupFlow({
  onFeedback,
  onDone,
  disabled,
  initialCategory,
}: {
  onFeedback: (msg: string) => void;
  onDone: () => Promise<void>;
  disabled: boolean;
  initialCategory?: HabitCategory | null;
}) {
  const [step, setStep] = useState<Step>(initialCategory ? 'intention' : 'category');
  const [category, setCategory] = useState<HabitCategory | null>(initialCategory ?? null);
  const [intention, setIntention] = useState<HabitIntentionChoice | null>(null);
  const [targetDraft, setTargetDraft] = useState('');
  const [weeklyDraft, setWeeklyDraft] = useState(String(DEFAULT_WEEKLY_CALL_TARGET));
  const [tier] = useState<GoalTier>('normal');
  const [createBusy, setCreateBusy] = useState(false);
  const createLockRef = useRef(false);

  const reset = () => {
    setStep('category');
    setCategory(null);
    setIntention(null);
    setTargetDraft('');
    setWeeklyDraft(String(DEFAULT_WEEKLY_CALL_TARGET));
  };

  const confirmCreate = async () => {
    if (!category || !intention || createLockRef.current || disabled) return;
    const plan = resolveHabitPlan(
      category,
      intention,
      null,
      intentionRequiresWeeklyCount(intention) ? Number(weeklyDraft) : null,
    );
    let targetValue: number | null = plan.defaultTarget;
    if (intention === 'measure') {
      targetValue = null;
    } else if (intentionRequiresNumericTarget(category, intention)) {
      const check = validateCreationTarget(plan.kind, targetDraft || String(plan.defaultTarget ?? ''));
      if (!check.ok) {
        onFeedback(check.error);
        return;
      }
      targetValue = check.value;
    }
    if (intentionRequiresWeeklyCount(intention)) {
      const w = Number(weeklyDraft);
      if (!Number.isInteger(w) || w < MIN_WEEKLY_CALLS || w > MAX_WEEKLY_CALLS) {
        onFeedback(`Choisis entre ${MIN_WEEKLY_CALLS} et ${MAX_WEEKLY_CALLS} jours par semaine.`);
        return;
      }
      plan.weeklyTargetCount = w;
    }

    createLockRef.current = true;
    setCreateBusy(true);
    try {
      const db = await getDb();
      const existing = await findActiveByTemplateId(db, plan.templateId);
      if (existing) {
        if (existing.kind === plan.kind && existing.followWithoutXp === plan.followWithoutXp) {
          onFeedback('Cette habitude est déjà active avec la même intention.');
          return;
        }
        await archiveAndRecreateForModeChange(db, existing, plan, targetValue, tier);
        onFeedback(
          'Intention mise à jour — l\'ancien objectif est archivé, l\'historique est conservé.',
        );
      } else {
        await db.withExclusiveTransactionAsync(async (tx) => {
          await createHabitGoal(tx, plan, targetValue, tier);
        });
        onFeedback(`Habitude « ${plan.title} » ajoutée.`);
      }
      reset();
      await onDone();
    } catch (err) {
      onFeedback(friendlyDbError(err));
    } finally {
      createLockRef.current = false;
      setCreateBusy(false);
    }
  };

  const flowDisabled = disabled || createBusy;

  return (
    <View>
      {step === 'category' ? (
        <View style={styles.grid}>
          {CATEGORIES.map((c) => (
            <Pressable
              key={c}
              accessibilityRole="button"
              onPress={() => {
                setCategory(c);
                setStep('intention');
              }}
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.cat}>{CATEGORY_LABELS[c]}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {step === 'intention' && category ? (
        <View>
          <Body>
            Intention pour {category === 'C' ? CONFIG_CATEGORY_LABELS[category] : CATEGORY_LABELS[category]}
          </Body>
          <View style={styles.chips}>
            {INTENTION_OPTIONS[category].map((opt) => (
              <Chip
                key={opt.id}
                label={opt.label}
                selected={intention === opt.id}
                onPress={() => {
                  setIntention(opt.id);
                  const plan = resolveHabitPlan(category, opt.id, null, null);
                  if (plan.defaultTarget != null) setTargetDraft(String(plan.defaultTarget));
                  else setTargetDraft('');
                  setStep('target');
                }}
              />
            ))}
            {category === 'C' ? (
              <Chip
                label="Ne pas suivre"
                selected={false}
                onPress={() => {
                  onFeedback('Aucun objectif sensible créé — tu pourras revenir quand tu veux.');
                  reset();
                }}
              />
            ) : null}
          </View>
          <Button label="Retour" variant="ghost" onPress={() => setStep('category')} disabled={flowDisabled} />
        </View>
      ) : null}

      {step === 'target' && category && intention ? (
        <View>
          <Body>
            {INTENTION_OPTIONS[category].find((o) => o.id === intention)?.hint ?? 'Confirme ta cible.'}
          </Body>
          {intentionRequiresNumericTarget(category, intention) ? (
            <Field
              value={targetDraft}
              onChangeText={setTargetDraft}
              keyboardType="decimal-pad"
              placeholder="Cible"
              accessibilityLabel="Cible numérique"
            />
          ) : null}
          {intentionRequiresWeeklyCount(intention) ? (
            <Field
              value={weeklyDraft}
              onChangeText={setWeeklyDraft}
              keyboardType="number-pad"
              placeholder="Jours avec appel / semaine"
              accessibilityLabel="Jours par semaine"
            />
          ) : null}
          {intention === 'measure' ? (
            <Body muted>Suivi neutre : aucune récompense XP automatique.</Body>
          ) : null}
          {intention === 'weekly_calls' ? (
            <Body muted>Suivi hebdomadaire — pas encore de récompense RPG sur cette habitude.</Body>
          ) : null}
          <View style={styles.chips}>
            <Button
              label="Valider l'habitude"
              variant="primary"
              onPress={() => void confirmCreate()}
              disabled={flowDisabled}
            />
            <Button
              label="Retour"
              variant="ghost"
              onPress={() => setStep('intention')}
              disabled={flowDisabled}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { gap: spacing.sm, marginTop: spacing.sm },
  card: {
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  cat: { ...typography.label, color: colors.gold },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm },
});