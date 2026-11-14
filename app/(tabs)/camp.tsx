import { useEffect } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Body, BrandTitle, Button, Screen, Title } from '@/src/design-system/ui';
import { spacing } from '@/src/design-system/theme';
import { useAppStore } from '@/src/state/appStore';
import { getDb } from '@/src/data/db/client';
import { upgradeCamp } from '@/src/domain/services/adventureService';
import { useState } from 'react';

export default function CampScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const profile = useAppStore((s) => s.profile);
  const character = useAppStore((s) => s.character);
  const goals = useAppStore((s) => s.goals);
  const todayTracking = useAppStore((s) => s.todayTracking);
  const refresh = useAppStore((s) => s.refresh);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const unknownCount = goals.filter((g) => !todayTracking[g.id] || todayTracking[g.id]?.status === 'unknown').length;

  return (
    <Screen style={{ paddingTop: spacing.md }}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}>
        <BrandTitle subtitle={`Camp niveau ${character?.campLevel ?? 1}`} />
        <Title>{profile?.pseudo ?? 'Voyageur'}</Title>
        <Body muted>
          Niveau {character?.level ?? 1} · {Math.round(character?.totalXp ?? 0)} XP · {character?.shards ?? 0} éclats
        </Body>
        <View style={{ height: spacing.md }} />
        <Body>
          Aujourd'hui : {goals.length - unknownCount}/{goals.length} objectif(s) renseigné(s). Les jours non
          saisis restent « Non renseigné » — jamais un succès inventé.
        </Body>
        <View style={{ height: spacing.md }} />
        <Button label="Objectifs du jour" onPress={() => router.push('/(tabs)/goals')} />
        <Button label="Respiration" variant="ghost" onPress={() => router.push('/tools/breathing')} />
        <Button label="J'ai besoin d'un coup de main" variant="ghost" onPress={() => router.push('/tools/urge')} />
        <Button label="Journal" variant="ghost" onPress={() => router.push('/journal')} />
        <Button label="Paramètres & sauvegarde" variant="ghost" onPress={() => router.push('/settings')} />
        <Button
          label="Améliorer le camp"
          onPress={async () => {
            const db = await getDb();
            const r = await upgradeCamp(db);
            setMsg(r.message);
            await refresh();
          }}
        />
        {msg ? <Body muted>{msg}</Body> : null}
      </ScrollView>
    </Screen>
  );
}
