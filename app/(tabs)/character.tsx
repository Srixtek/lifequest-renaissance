import { useCallback, useState } from 'react';
import { ScrollView, Text, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Body, Screen, Title } from '@/src/design-system/ui';
import { colors, spacing } from '@/src/design-system/theme';
import { useAppStore } from '@/src/state/appStore';
import { getDb } from '@/src/data/db/client';
import { listEquipment, listInventory } from '@/src/data/db/repositories/rpgRepo';
import { ITEMS } from '@/src/data/content/items';
import { CLASSES } from '@/src/data/content/classes';

export default function CharacterScreen() {
  const profile = useAppStore((s) => s.profile);
  const character = useAppStore((s) => s.character);
  const [inv, setInv] = useState<any[]>([]);
  const [eq, setEq] = useState<any[]>([]);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const db = await getDb();
        setInv(await listInventory(db));
        setEq(await listEquipment(db));
      })();
    }, []),
  );

  const className = CLASSES.find((c) => c.id === profile?.classId)?.name ?? profile?.classId;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl, paddingTop: spacing.sm }}>
        <Title>{profile?.pseudo}</Title>
        <Body muted>
          {className} · Niveau {character?.level} · {Math.round(character?.totalXp ?? 0)} XP · Camp{' '}
          {character?.campLevel}
        </Body>
        <Text style={styles.section}>Équipement</Text>
        {eq.map((s) => (
          <Body key={s.slot}>
            {s.slot} : {s.itemId ? ITEMS[s.itemId]?.name ?? s.itemId : '—'}
          </Body>
        ))}
        <Text style={styles.section}>Inventaire</Text>
        {inv.length === 0 ? <Body muted>Vide</Body> : null}
        {inv.map((i) => (
          <Body key={i.id}>
            {ITEMS[i.itemId]?.name ?? i.itemId} ×{i.quantity}
            {ITEMS[i.itemId]?.usefulEffect ? ` — effet : ${ITEMS[i.itemId].usefulEffect}` : ''}
          </Body>
        ))}
        <Text style={styles.section}>Éclats</Text>
        <Body>{character?.shards ?? 0}</Body>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { color: colors.ember, fontWeight: '700', marginTop: spacing.lg, marginBottom: spacing.sm },
});
