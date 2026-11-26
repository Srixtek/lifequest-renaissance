import { useState } from 'react';
import { Pressable, ScrollView, Text, View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { BrandTitle, Body, Button, Chip, Field, Screen, Title } from '@/src/design-system/ui';
import { colors, spacing, typography } from '@/src/design-system/theme';
import { ClassSymbol } from '@/src/design-system/icons';
import { CLASSES } from '@/src/data/content/classes';
import { GOAL_TEMPLATES } from '@/src/data/content/goalTemplates';
import { HELP_LINES, HEALTH_GUARDRAIL } from '@/src/data/content/helpLines';
import {
  CONFIG_CATEGORY_LABELS,
  INTENTION_OPTIONS,
  intentionRequiresNumericTarget,
  resolveHabitPlan,
  type HabitIntentionChoice,
} from '@/src/domain/content/habitIntentions';
import type { ClassId } from '@/src/domain/models/types';
import { getDb } from '@/src/data/db/client';
import { completeOnboarding } from '@/src/domain/services/onboardingService';
import { useAppStore } from '@/src/state/appStore';

const FREQ_REGULATION_ID = 'freq_regulation';

function onboardingLabelForTemplate(t: (typeof GOAL_TEMPLATES)[0]): string {
  if (t.id === FREQ_REGULATION_ID) {
    return `${CONFIG_CATEGORY_LABELS.C} (facultatif)`;
  }
  return t.title;
}

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const refresh = useAppStore((s) => s.refresh);
  const [pseudo, setPseudo] = useState('');
  const [classId, setClassId] = useState<ClassId>('rodeur');
  const [tone, setTone] = useState<'fantasy' | 'sobre'>('fantasy');
  const [selected, setSelected] = useState<string[]>([]);
  const [sensitiveIntention, setSensitiveIntention] = useState<HabitIntentionChoice | null>(null);
  const [sensitiveTarget, setSensitiveTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sensitiveSelected = selected.includes(FREQ_REGULATION_ID);

  const toggle = (id: string) => {
    if (id === FREQ_REGULATION_ID) {
      setSelected((prev) => {
        if (prev.includes(id)) {
          setSensitiveIntention(null);
          setSensitiveTarget('');
          return prev.filter((x) => x !== id);
        }
        return [...prev, id];
      });
      return;
    }
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const showAlcohol = selected.some((id) => GOAL_TEMPLATES.find((t) => t.id === id)?.alcoholSafety);
  const showNicotine = selected.some((id) => GOAL_TEMPLATES.find((t) => t.id === id)?.nicotineNote);

  const onFinish = async () => {
    setBusy(true);
    setError(null);
    try {
      if (sensitiveSelected && !sensitiveIntention) {
        setError('Choisis une intention pour la rubrique sensible, ou décoche-la.');
        return;
      }
      let templateIds = [...selected];
      let sensitiveRegulation = null as { intention: HabitIntentionChoice; targetValue: number | null } | null;
      if (sensitiveSelected && sensitiveIntention) {
        if (sensitiveIntention === 'measure') {
          sensitiveRegulation = { intention: 'measure', targetValue: null };
        } else if (intentionRequiresNumericTarget('C', sensitiveIntention)) {
          const raw = sensitiveTarget.trim();
          const n = raw ? Number(raw.replace(',', '.')) : NaN;
          if (!Number.isFinite(n) || n <= 0) {
            setError('Indique une cible quotidienne positive, ou choisis « Mesurer ».');
            return;
          }
          sensitiveRegulation = { intention: sensitiveIntention, targetValue: n };
        } else {
          sensitiveRegulation = { intention: sensitiveIntention, targetValue: null };
        }
      } else if (sensitiveSelected) {
        templateIds = templateIds.filter((x) => x !== FREQ_REGULATION_ID);
      }

      const db = await getDb();
      await completeOnboarding(db, {
        pseudo,
        classId,
        tone,
        templateIds,
        sensitiveRegulation,
      });
      await refresh();
      router.replace('/(tabs)/camp');
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen style={{ paddingTop: Math.max(insets.top, spacing.lg) }}>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }} showsVerticalScrollIndicator={false}>
        <BrandTitle subtitle="Crée ton aventurier — sans compte, hors ligne." />
        <Title>Pseudo</Title>
        <Field
          value={pseudo}
          onChangeText={setPseudo}
          placeholder="Ex. Aube"
          autoCapitalize="words"
          accessibilityLabel="Pseudo"
        />

        <View style={{ height: spacing.lg }} />
        <Title>Classe</Title>
        <Body muted>Chaque classe raconte une façon d'avancer — sans bonus cachés pour l'instant.</Body>
        <View style={styles.classGrid}>
          {CLASSES.map((c) => {
            const selected = classId === c.id;
            return (
              <Pressable
                key={c.id}
                onPress={() => setClassId(c.id)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={[styles.classCard, selected && styles.classCardSelected]}
              >
                <ClassSymbol classId={c.id} size={36} />
                <Text style={styles.className}>{c.name}</Text>
                <Text style={styles.classTheme}>{c.theme}</Text>
                <Text style={styles.classBlurb}>{c.blurb}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={{ height: spacing.lg }} />
        <Title>Ton</Title>
        <View style={styles.row}>
          <Chip label="Fantasy" selected={tone === 'fantasy'} onPress={() => setTone('fantasy')} />
          <Chip label="Sobre" selected={tone === 'sobre'} onPress={() => setTone('sobre')} />
        </View>

        <View style={{ height: spacing.lg }} />
        <Title>Premiers objectifs</Title>
        <Body muted>Rien n'est coché par défaut. La rubrique sensible est toujours facultative.</Body>
        <View style={[styles.row, { marginTop: spacing.sm }]}>
          {GOAL_TEMPLATES.filter((t) => t.id !== 'breathing5').map((t) => (
            <Chip
              key={t.id}
              label={onboardingLabelForTemplate(t)}
              selected={selected.includes(t.id)}
              onPress={() => toggle(t.id)}
            />
          ))}
        </View>

        {sensitiveSelected ? (
          <View style={styles.note}>
            <Body>{CONFIG_CATEGORY_LABELS.C} — que veux-tu faire ?</Body>
            <View style={styles.row}>
              {INTENTION_OPTIONS.C.map((opt) => (
                <Chip
                  key={opt.id}
                  label={opt.label}
                  selected={sensitiveIntention === opt.id}
                  onPress={() => {
                    setSensitiveIntention(opt.id);
                    setSensitiveTarget('');
                  }}
                />
              ))}
              <Chip
                label="Ne pas suivre"
                selected={false}
                onPress={() => {
                  setSensitiveIntention(null);
                  setSensitiveTarget('');
                  setSelected((prev) => prev.filter((x) => x !== FREQ_REGULATION_ID));
                }}
              />
            </View>
            {sensitiveIntention && intentionRequiresNumericTarget('C', sensitiveIntention) ? (
              <Field
                value={sensitiveTarget}
                onChangeText={setSensitiveTarget}
                keyboardType="decimal-pad"
                placeholder="Cible quotidienne (fois)"
                accessibilityLabel="Cible sensible"
              />
            ) : null}
            {sensitiveIntention === 'measure' ? (
              <Body muted>Suivi neutre — pas de limite implicite ni de récompense XP automatique.</Body>
            ) : null}
          </View>
        ) : null}

        {showNicotine ? (
          <View style={styles.note}>
            <Body>
              La priorité reste de ne pas revenir à la cigarette. Un tabacologue ({HELP_LINES[0].phone}) peut
              t'aider à planifier l'arrêt de la vape. Aucun calendrier de nicotine n'est imposé par l'app.
            </Body>
          </View>
        ) : null}

        {showAlcohol ? (
          <View style={styles.note}>
            <Body>
              Un arrêt brutal de l'alcool peut être dangereux. Parles-en à un médecin ou appelle Alcool Info
              Service ({HELP_LINES[1].phone}) avant de commencer. Confusion, hallucinations, tremblements
              intenses → 15 ou 112. Un verre standard FR = 10 g d'alcool pur.
            </Body>
          </View>
        ) : null}

        <View style={styles.note}>
          <Body muted>{HEALTH_GUARDRAIL}</Body>
        </View>

        {error ? <Text style={{ color: colors.danger, marginTop: 8 }}>{error}</Text> : null}
        <Button label={busy ? 'Création…' : 'Entrer dans Eloria'} onPress={onFinish} disabled={busy || !pseudo.trim()} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm },
  classGrid: { marginTop: spacing.sm, gap: spacing.sm },
  classCard: {
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  classCardSelected: { borderColor: colors.gold, backgroundColor: colors.mist },
  className: { ...typography.subtitle, color: colors.ink, marginTop: spacing.sm },
  classTheme: { ...typography.label, color: colors.gold, marginTop: 4 },
  classBlurb: { ...typography.caption, color: colors.muted, marginTop: spacing.xs },
  note: {
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.bgElevated,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
  },
});