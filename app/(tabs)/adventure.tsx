import { useCallback, useState } from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Body, Button, Screen, Title } from '@/src/design-system/ui';
import { colors, spacing } from '@/src/design-system/theme';
import { getDb } from '@/src/data/db/client';
import { chooseAdventure, equipLantern, getAdventureView } from '@/src/domain/services/adventureService';
import { useAppStore } from '@/src/state/appStore';

export default function AdventureScreen() {
  const refresh = useAppStore((s) => s.refresh);
  const [view, setView] = useState<Awaited<ReturnType<typeof getAdventureView>> | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const db = await getDb();
    setView(await getAdventureView(db));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!view) {
    return (
      <Screen>
        <Body>Chargement…</Body>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl, paddingTop: spacing.sm }}>
        <Title>{view.node.title}</Title>
        <Body>{view.node.description}</Body>
        {view.locked ? (
          <Text style={styles.warn}>Zone voilée — équipe la lanterne pour y voir clair.</Text>
        ) : null}
        <View style={{ height: spacing.md }} />
        <Button
          label="Équiper la lanterne"
          variant="ghost"
          onPress={async () => {
            const db = await getDb();
            const r = await equipLantern(db);
            setMsg(r.message);
            await refresh();
            await load();
          }}
        />
        {view.node.choices.map((c) => (
          <Button
            key={c.id}
            label={c.label}
            onPress={async () => {
              const db = await getDb();
              const r = await chooseAdventure(db, c.id);
              setMsg(r.message);
              await refresh();
              await load();
            }}
          />
        ))}
        {msg ? <Body muted>{msg}</Body> : null}
        <Body muted>Visité : {view.visited.join(' → ')}</Body>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  warn: { color: colors.warn, marginTop: spacing.sm },
});
