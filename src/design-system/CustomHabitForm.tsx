import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Body, Button, Chip, Field } from './ui';
import { colors, spacing, typography } from './theme';
import { getDb } from '@/src/data/db/client';
import { HABIT_CATEGORIES, HABIT_CATEGORY_BY_ID } from '@/src/data/content/habitCategories';
import { GOAL_KIND_LABELS } from '@/src/data/content/goalTemplates';
import { createCustomGoal } from '@/src/domain/services/goalCreationService';
import { kindRequiresNumericTarget } from '@/src/domain/rules/trackingStatus';
import { customCreationTargetPlaceholder } from '@/src/domain/content/habitPresentation';
import type { GoalKind, GoalTier, HabitCategoryId } from '@/src/domain/models/types';
import { friendlyDbError } from '@/src/utils/dbErrors';

const CUSTOM_KINDS: GoalKind[] = ['habit', 'abstinence', 'limit', 'reduce', 'duration', 'quantity'];
const TIERS: Array<{ id: GoalTier; label: string }> = [
  { id: 'minimal', label: 'Douce' },
  { id: 'normal', label: 'Normale' },
  { id: 'ambitieux', label: 'Ambitieuse' },
];

export function CustomHabitForm({ onCreated }: { onCreated: () => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState<HabitCategoryId>('divers');
  const [kind, setKind] = useState<GoalKind>('habit');
  const [unit, setUnit] = useState('');
  const [target, setTarget] = useState('');
  const [tier, setTier] = useState<GoalTier>('normal');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; ok: boolean } | null>(null);
  const lock = useRef(false);

  const submit = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const db = await getDb();
      const r = await createCustomGoal(db, { title, kind, unit, targetRaw: target, tier, categoryId });
      if (!r.ok) {
        setFeedback({ text: r.error, ok: false });
        return;
      }
      setTitle('');
      setUnit('');
      setTarget('');
      await onCreated();
      setFeedback({
        text: `« ${r.title} » ajoutée dans ${HABIT_CATEGORY_BY_ID[r.categoryId].label}.`,
        ok: true,
      });
    } catch (err) {
      setFeedback({ text: friendlyDbError(err), ok: false });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  return (
    <View>
      <Field value={title} onChangeText={setTitle} placeholder="Nom de l'habitude" accessibilityLabel="Nom" />

      <Text style={styles.label}>Catégorie</Text>
      <View style={styles.row}>
        {HABIT_CATEGORIES.map((c) => (
          <Chip
            key={c.id}
            label={`${c.symbol} ${c.label}`}
            selected={categoryId === c.id}
            onPress={() => setCategoryId(c.id)}
          />
        ))}
      </View>

      <Text style={styles.label}>Type de suivi</Text>
      <View style={styles.row}>
        {CUSTOM_KINDS.map((k) => (
          <Chip
            key={k}
            label={GOAL_KIND_LABELS[k]}
            selected={kind === k}
            onPress={() => {
              setKind(k);
              if (!kindRequiresNumericTarget(k)) setTarget('');
            }}
          />
        ))}
      </View>

      <Field value={unit} onChangeText={setUnit} placeholder="Unité (facultatif)" accessibilityLabel="Unité" />
      {kindRequiresNumericTarget(kind) ? (
        <Field
          value={target}
          onChangeText={setTarget}
          placeholder={customCreationTargetPlaceholder(kind)}
          keyboardType="decimal-pad"
          accessibilityLabel="Objectif"
        />
      ) : (
        <Body muted>Pas d&apos;objectif chiffré pour ce type.</Body>
      )}

      <Text style={styles.label}>Difficulté de départ</Text>
      <View style={styles.row}>
        {TIERS.map((t) => (
          <Chip key={t.id} label={t.label} selected={tier === t.id} onPress={() => setTier(t.id)} />
        ))}
      </View>

      <Button label="Créer l'habitude" onPress={() => void submit()} disabled={busy} />
      {feedback ? (
        <Text style={[styles.feedback, { color: feedback.ok ? colors.success : colors.ember }]}>
          {feedback.text}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { ...typography.caption, color: colors.muted, marginTop: spacing.md },
  row: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm },
  feedback: { ...typography.body, marginTop: spacing.sm },
});
