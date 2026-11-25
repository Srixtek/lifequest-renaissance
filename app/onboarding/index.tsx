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
import type { ClassId } from '@/src/domain/models/types';
import { getDb } from '@/src/data/db/client';
import { completeOnboarding } from '@/src/domain/services/onboardingService';
import { useAppStore } from '@/src/state/appStore';

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const refresh = useAppStore((s) => s.refresh);
  const [pseudo, setPseudo] = useState('');
  const [classId, setClassId] = useState<ClassId>('rodeur');
  const [tone, setTone] = useState<'fantasy' | 'sobre'>('fantasy');
  const [selected, setSelected] = useState<string[]>(['vape_sessions', 'breathing5']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const showAlcohol = selected.some((id) => GOAL_TEMPLATES.find((t) => t.id === id)?.alcoholSafety);
  const showNicotine = selected.some((id) => GOAL_TEMPLATES.find((t) => t.id === id)?.nicotineNote);

  const onFinish = async () => {
    setBusy(true);
    setError(null);
    try {
      const db = await getDb();
      await completeOnboarding(db, { pseudo, classId, tone, templateIds: selected });
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
        <Body muted>Tu pourras en ajouter ensuite. Rien n'est coché comme réussi par défaut.</Body>
        <View style={[styles.row, { marginTop: spacing.sm }]}>
          {GOAL_TEMPLATES.map((t) => (
            <Chip key={t.id} label={t.title} selected={selected.includes(t.id)} onPress={() => toggle(t.id)} />
          ))}
        </View>

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
