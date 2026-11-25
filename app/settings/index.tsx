import { useState } from 'react';
import { ScrollView, Text, StyleSheet } from 'react-native';
import * as Sharing from 'expo-sharing';
import { Body, Button, Screen, Title } from '@/src/design-system/ui';
import { colors, spacing } from '@/src/design-system/theme';
import { HELP_LINES, HEALTH_GUARDRAIL } from '@/src/data/content/helpLines';
import { getDb } from '@/src/data/db/client';
import { exportBackup } from '@/src/domain/services/backupService';
import { useAppStore } from '@/src/state/appStore';
import { DAILY_XP_BUDGET, XP_RULE_VERSION } from '@/src/domain/rules/xp';

export default function SettingsScreen() {
  const profile = useAppStore((s) => s.profile);
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }}>
        <Title>Paramètres</Title>
        <Body muted>
          {profile?.pseudo} · fuseau {profile?.timezone} · jour à partir de {profile?.dayStartHour}h
        </Body>

        <Text style={styles.section}>XP</Text>
        <Body>
          Budget quotidien {DAILY_XP_BUDGET} XP (règles {XP_RULE_VERSION}). Les jours non renseignés ne
          rapportent rien. Ledger immuable + clés d'idempotence.
        </Body>

        <Text style={styles.section}>Sauvegarde (.lqbackup)</Text>
        <Body muted>
          Export ZIP (manifest + données). Import désactivé sur cette préversion (audit sécurité non terminé) — export
          uniquement.
        </Body>
        <Button
          label="Exporter la sauvegarde"
          onPress={async () => {
            const db = await getDb();
            const { uri, preview } = await exportBackup(db);
            setMsg(`Export ${preview.exportedAt} · ${preview.goalCount} objectifs · ${preview.xpTotal} XP`);
            if (await Sharing.isAvailableAsync()) {
              await Sharing.shareAsync(uri, { mimeType: 'application/zip', dialogTitle: 'LifeQuest sauvegarde' });
            }
          }}
        />
        <Button
          label="Import indisponible (préversion)"
          variant="ghost"
          disabled
          onPress={() => {
            setMsg(
              'Import désactivé sur 0.2.0-preview.1. Le code de restauration reste présent ; un audit viendra avant réactivation.',
            );
          }}
        />

        <Text style={styles.section}>Aide</Text>
        {HELP_LINES.map((h) => (
          <Body key={h.id}>
            {h.name} — {h.phone} ({h.hours})
          </Body>
        ))}
        <Body muted>{HEALTH_GUARDRAIL}</Body>
        {msg ? <Text style={styles.msg}>{msg}</Text> : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { color: colors.ember, fontWeight: '700', marginTop: spacing.lg, marginBottom: spacing.sm },
  msg: { color: colors.success, marginTop: spacing.md },
});
