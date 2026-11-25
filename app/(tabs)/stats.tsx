import { useCallback, useState } from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import Svg, { Rect, Text as SvgText } from 'react-native-svg';
import { Body, Chip, Screen, Title } from '@/src/design-system/ui';
import { colors, spacing } from '@/src/design-system/theme';
import { useAppStore } from '@/src/state/appStore';
import { getDb } from '@/src/data/db/client';
import { coverageLabel, goalChart, type GoalStats } from '@/src/domain/services/statsService';

export default function StatsScreen() {
  const goals = useAppStore((s) => s.goals);
  const character = useAppStore((s) => s.character);
  const today = useAppStore((s) => s.today);
  const [window, setWindow] = useState<7 | 30>(7);
  const [stats, setStats] = useState<GoalStats[]>([]);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const db = await getDb();
        const all: GoalStats[] = [];
        for (const g of goals) {
          all.push(await goalChart(db, g.id, today, window));
        }
        setStats(all);
      })();
    }, [goals, today, window]),
  );

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl, paddingTop: spacing.sm }}>
        <Title>Statistiques</Title>
        <Body muted>Réel et RPG sont séparés. Les dénominateurs sont visibles.</Body>

        <Text style={styles.section}>RPG</Text>
        <Body>
          Niveau {character?.level} · XP totale {Math.round(character?.totalXp ?? 0)} · Éclats{' '}
          {character?.shards}
        </Body>

        <Text style={styles.section}>Réel</Text>
        <View style={{ flexDirection: 'row', marginBottom: spacing.sm }}>
          <Chip label="7 jours" selected={window === 7} onPress={() => setWindow(7)} />
          <Chip label="30 jours" selected={window === 30} onPress={() => setWindow(30)} />
        </View>

        {stats.map((s) => (
          <View key={s.goalId} style={styles.card}>
            <Text style={styles.goalTitle}>{s.title}</Text>
            <Body muted>{coverageLabel(s)}</Body>
            {s.followWithoutXp ? (
              <Body muted>
                Mode Mesurer — jours renseignés : {s.covered}/{s.window}
                {s.points.some((p) => p.value != null)
                  ? ` · valeurs : ${s.points
                      .filter((p) => p.status !== 'unknown' && p.value != null)
                      .map((p) => `${p.date.slice(5)}=${p.value}`)
                      .join(', ')}`
                  : ''}
              </Body>
            ) : (
              <Body muted>
                Succès déclarés : {s.successCount}/{s.window}
              </Body>
            )}
            <Svg width="100%" height={56} viewBox={`0 0 ${s.points.length * 12} 56`}>
              {s.points.map((p, i) => {
                const color = s.followWithoutXp
                  ? p.status === 'unknown'
                    ? colors.line
                    : colors.muted
                  : p.status === 'success'
                    ? colors.success
                    : p.status === 'partial'
                      ? colors.warn
                      : p.status === 'miss'
                        ? colors.danger
                        : colors.line;
                return <Rect key={p.date} x={i * 12} y={8} width={10} height={40} fill={color} rx={2} />;
              })}
              <SvgText x={0} y={54} fill={colors.muted} fontSize="8">
                {s.points[0]?.date} → {s.points[s.points.length - 1]?.date}
              </SvgText>
            </Svg>
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { color: colors.ember, fontWeight: '700', marginTop: spacing.lg, marginBottom: spacing.sm },
  card: {
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bgElevated,
  },
  goalTitle: { color: colors.ink, fontWeight: '700', marginBottom: 4 },
});
