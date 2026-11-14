import { useState } from 'react';
import { ScrollView, Text, StyleSheet } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { Body, Button, Screen, Title } from '@/src/design-system/ui';
import { colors, spacing } from '@/src/design-system/theme';
import { HELP_LINES, HEALTH_GUARDRAIL } from '@/src/data/content/helpLines';
import { getDb } from '@/src/data/db/client';
import { exportBackup, importBackup, previewBackup } from '@/src/domain/services/backupService';
import { useAppStore } from '@/src/state/appStore';
import { DAILY_XP_BUDGET, XP_RULE_VERSION } from '@/src/domain/rules/xp';

export default function SettingsScreen() {
  const refresh = useAppStore((s) => s.refresh);
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
        <Body muted>Export ZIP (manifest + data). Import = remplacement complet contrôlé.</Body>
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
          label="Importer une sauvegarde"
          variant="ghost"
          onPress={async () => {
            const picked = await DocumentPicker.getDocumentAsync({
              copyToCacheDirectory: true,
              type: '*/*',
            });
            if (picked.canceled || !picked.assets?.[0]) return;
            const uri = picked.assets[0].uri;
            const preview = await previewBackup(uri);
            // Safety backup first
            const db = await getDb();
            await exportBackup(db);
            await importBackup(db, uri);
            await refresh();
            setMsg(`Import OK : ${preview.pseudo} · ${preview.goalCount} objectifs · ${preview.xpTotal} XP`);
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
