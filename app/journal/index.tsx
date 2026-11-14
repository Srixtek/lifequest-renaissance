import { useState } from 'react';
import { View } from 'react-native';
import { Body, Button, Field, Screen, Title } from '@/src/design-system/ui';
import { spacing } from '@/src/design-system/theme';
import { getDb } from '@/src/data/db/client';
import { addJournalEntry } from '@/src/domain/services/toolsService';
import { useAppStore } from '@/src/state/appStore';

export default function JournalScreen() {
  const today = useAppStore((s) => s.today);
  const [body, setBody] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <Screen>
      <Title>Journal</Title>
      <Body muted>Facultatif. Tes notes restent sur cet appareil.</Body>
      <View style={{ height: spacing.md }} />
      <Field
        value={body}
        onChangeText={setBody}
        placeholder="Ce qui s'est passé…"
        multiline
        style={{ minHeight: 140, textAlignVertical: 'top' }}
      />
      <Button
        label="Enregistrer"
        onPress={async () => {
          if (!body.trim()) return;
          const db = await getDb();
          await addJournalEntry(db, today, body.trim(), null);
          setBody('');
          setMsg('Entrée enregistrée.');
        }}
      />
      {msg ? <Body muted>{msg}</Body> : null}
    </Screen>
  );
}
