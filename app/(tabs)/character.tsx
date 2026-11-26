import { useCallback, useState } from 'react';
import { ScrollView, Text, View, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Body, Screen, Title } from '@/src/design-system/ui';
import { colors, spacing, typography } from '@/src/design-system/theme';
import { FantasyPanel } from '@/src/design-system/FantasyPanel';
import { ProgressBar } from '@/src/design-system/ProgressBar';
import { HeroPortraitArt } from '@/src/design-system/art/HeroPortraitArt';
import { useAppStore } from '@/src/state/appStore';
import { getDb } from '@/src/data/db/client';
import { listEquipment, listInventory } from '@/src/data/db/repositories/rpgRepo';
import { ITEMS } from '@/src/data/content/items';
import { CLASSES } from '@/src/data/content/classes';
import { XP_PER_LEVEL } from '@/src/domain/rules/xp';
import type { ClassId, EquipmentSlot, InventoryItem } from '@/src/domain/models/types';

const SLOT_LABELS: Record<string, string> = {
  weapon: 'Arme',
  armor: 'Armure',
  trinket: 'Charme',
};

export default function CharacterScreen() {
  const profile = useAppStore((s) => s.profile);
  const character = useAppStore((s) => s.character);
  const goldBalance = useAppStore((s) => s.goldBalance);
  const [inv, setInv] = useState<InventoryItem[]>([]);
  const [eq, setEq] = useState<EquipmentSlot[]>([]);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const db = await getDb();
        setInv(await listInventory(db));
        setEq(await listEquipment(db));
      })();
    }, []),
  );

  const classDef = CLASSES.find((c) => c.id === profile?.classId);
  const className = classDef?.name ?? profile?.classId;
  const classId = (profile?.classId ?? 'rodeur') as ClassId;
  const level = character?.level ?? 1;
  const totalXp = character?.totalXp ?? 0;
  const inLevelXp = totalXp - (level - 1) * XP_PER_LEVEL;
  const shards = character?.shards ?? 0;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl, paddingTop: spacing.sm }}>
        <Title>Fiche héros</Title>
        <Body muted>Équipement, réserve et progression — données déjà en jeu.</Body>

        <FantasyPanel accent style={{ marginTop: spacing.md }}>
          <View style={styles.heroRow}>
            <HeroPortraitArt classId={classId} size={88} />
            <View style={styles.heroMeta}>
              <Text style={styles.pseudo}>{profile?.pseudo ?? 'Voyageur'}</Text>
              <Text style={styles.classLine}>
                {className} · Niveau {level}
              </Text>
              <ProgressBar
                progress={inLevelXp / XP_PER_LEVEL}
                label={`${Math.round(inLevelXp)} / ${XP_PER_LEVEL} XP vers le niveau ${level + 1}`}
                height={10}
              />
              {classDef ? (
                <Text style={styles.themeLine} numberOfLines={2}>
                  {classDef.theme}
                </Text>
              ) : null}
            </View>
          </View>
        </FantasyPanel>

        <View style={styles.resourceRow}>
          <FantasyPanel style={styles.resourceCard}>
            <Text style={styles.resourceKicker}>Or</Text>
            <Text style={styles.goldValue}>{goldBalance}</Text>
            <Text style={styles.hint}>
              Gagné via les quêtes. Dépensable à la forge du bastion pour renforcer tes coups au combat.
            </Text>
          </FantasyPanel>
          <FantasyPanel style={styles.resourceCard}>
            <Text style={[styles.resourceKicker, styles.shardKicker]}>Éclats</Text>
            <Text style={styles.shardValue}>{shards}</Text>
            <Text style={styles.hint}>
              Réserve narrative liée au camp. Distinct de l&apos;or du carnet de quêtes.
            </Text>
          </FantasyPanel>
        </View>

        <Text style={styles.section}>Équipement</Text>
        {eq.length === 0 ? (
          <FantasyPanel>
            <Body muted>Aucun emplacement enregistré pour l&apos;instant.</Body>
          </FantasyPanel>
        ) : (
          eq.map((s) => {
            const item = s.itemId ? ITEMS[s.itemId] : null;
            return (
              <FantasyPanel key={s.slot} style={styles.slotCard}>
                <Text style={styles.slotLabel}>{SLOT_LABELS[s.slot] ?? s.slot}</Text>
                {item ? (
                  <>
                    <Text style={styles.itemName}>{item.name}</Text>
                    <Text style={styles.hint}>{item.description ?? item.usefulEffect ?? ''}</Text>
                  </>
                ) : (
                  <Body muted>Emplacement vide — rien d&apos;équipé ici.</Body>
                )}
              </FantasyPanel>
            );
          })
        )}

        <Text style={styles.section}>Inventaire</Text>
        {inv.length === 0 ? (
          <FantasyPanel>
            <Body muted>Sac vide. Les objets utiles apparaîtront ici quand tu en obtiendras en jeu.</Body>
          </FantasyPanel>
        ) : (
          inv.map((i) => {
            const def = ITEMS[i.itemId];
            return (
              <FantasyPanel key={i.id} style={styles.invCard}>
                <View style={styles.invHeader}>
                  <Text style={styles.itemName}>{def?.name ?? i.itemId}</Text>
                  <Text style={styles.qty}>×{i.quantity}</Text>
                </View>
                {def?.usefulEffect ? <Text style={styles.hint}>Effet : {def.usefulEffect}</Text> : null}
              </FantasyPanel>
            );
          })
        )}

        <Text style={[styles.section, styles.sectionMuted]}>Camp · niveau {character?.campLevel ?? 0}</Text>
        <Body muted>Améliore le camp depuis l&apos;accueil pour débloquer les prochaines étapes d&apos;Eloria.</Body>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heroRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  heroMeta: { flex: 1, minWidth: 0 },
  pseudo: { ...typography.title, color: colors.ink },
  classLine: { ...typography.caption, color: colors.muted, marginBottom: spacing.xs },
  themeLine: { ...typography.caption, color: colors.gold, marginTop: spacing.xs },
  resourceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  resourceCard: { flex: 1, minWidth: 140 },
  resourceKicker: { ...typography.label, color: colors.gold, marginBottom: spacing.xs },
  shardKicker: { color: colors.emeraldBright },
  goldValue: { ...typography.hero, color: colors.goldBright, fontSize: 26 },
  shardValue: { ...typography.hero, color: colors.emeraldBright, fontSize: 26 },
  section: { ...typography.label, color: colors.gold, marginTop: spacing.lg, marginBottom: spacing.sm },
  sectionMuted: { color: colors.muted },
  slotCard: { marginBottom: spacing.sm },
  slotLabel: { ...typography.caption, color: colors.copper, fontWeight: '700', marginBottom: 4 },
  itemName: { ...typography.subtitle, color: colors.ink },
  invCard: { marginBottom: spacing.sm },
  invHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  qty: { ...typography.subtitle, color: colors.gold },
  hint: { ...typography.caption, color: colors.muted, lineHeight: 18 },
});