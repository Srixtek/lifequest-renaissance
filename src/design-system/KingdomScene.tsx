import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { BastionSceneArt } from './art/BastionSceneArt';
import { computeKingdomSceneLayout } from './kingdomSceneLayout';
import { colors, spacing, typography } from './theme';

export type KingdomZone = 'forge' | 'combat' | 'forest' | 'camp';

type Props = {
  forgeLevel: number;
  onZone: (zone: KingdomZone) => void;
  height?: number;
};

export function KingdomScene({ forgeLevel, onZone, height = 268 }: Props) {
  const { width: screenWidth } = useWindowDimensions();
  const layout = useMemo(() => computeKingdomSceneLayout(screenWidth, height), [screenWidth, height]);
  const { buildingSpriteDp, hitboxes, columns } = layout;

  const centers = useMemo(
    () => ({
      combat: columns.combat.centerX,
      camp: columns.camp.centerX,
      forge: columns.forge.centerX,
    }),
    [columns],
  );

  return (
    <View style={[styles.wrap, { height }]} accessibilityRole="image" accessibilityLabel="Bastion d'Eloria, village nocturne">
      <BastionSceneArt height={height} forgeLevel={forgeLevel} centers={centers} buildingDp={buildingSpriteDp} />

      <View style={styles.forestSlot} pointerEvents="none" accessibilityElementsHidden>
        <Text style={styles.lockedTag}>Forêt — bientôt</Text>
      </View>

      <Pressable
        style={[styles.hit, hitboxes.combat]}
        onPress={() => onZone('combat')}
        accessibilityRole="button"
        accessibilityLabel="Arène de combat"
      />
      <Pressable
        style={[styles.hit, hitboxes.camp]}
        onPress={() => onZone('camp')}
        accessibilityRole="button"
        accessibilityLabel="Camp — retour à l'accueil"
      />
      <Pressable
        style={[styles.hit, hitboxes.forge]}
        onPress={() => onZone('forge')}
        accessibilityRole="button"
        accessibilityLabel="Forge"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: spacing.md,
    position: 'relative',
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.lineBright,
  },
  forestSlot: {
    position: 'absolute',
    left: 6,
    top: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: 'rgba(7,15,14,0.72)',
  },
  lockedTag: { ...typography.caption, color: colors.muted, fontSize: 11 },
  hit: {
    position: 'absolute',
    minHeight: 48,
    minWidth: 48,
  },
});