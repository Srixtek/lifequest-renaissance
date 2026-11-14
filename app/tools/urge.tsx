import { useEffect, useRef, useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { Body, Button, Chip, Screen, Title } from '@/src/design-system/ui';
import { colors, spacing } from '@/src/design-system/theme';
import { HELP_LINES } from '@/src/data/content/helpLines';
import { getDb } from '@/src/data/db/client';
import { recordUrgeSession } from '@/src/domain/services/toolsService';
import { useAppStore } from '@/src/state/appStore';

const DURATIONS = [1, 3, 5, 10];

export default function UrgeScreen() {
  const refresh = useAppStore((s) => s.refresh);
  const [minutes, setMinutes] = useState(3);
  const [remaining, setRemaining] = useState(3 * 60);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!running) {
      if (timer.current) clearInterval(timer.current);
      return;
    }
    timer.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          setRunning(false);
          void finish(true);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  const finish = async (completed: boolean) => {
    const db = await getDb();
    const r = await recordUrgeSession(db, minutes * 60 - remaining, completed);
    await refresh();
    setMsg(
      completed
        ? r.bonusXp > 0
          ? `Bravo d'avoir tenu. Bonus 1ʳᵉ utilisation outil : +${r.bonusXp} XP (pas d'XP par envie).`
          : 'C\'est noté. Pas d\'XP par envie — seulement la première utilisation de l\'outil.'
        : 'Session interrompue.',
    );
  };

  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');

  return (
    <Screen>
      <Title>Une envie passe</Title>
      <Body>
        Une envie monte, atteint un pic, puis redescend souvent en quelques minutes — même si elle revient.
      </Body>
      <View style={styles.row}>
        {DURATIONS.map((d) => (
          <Chip
            key={d}
            label={`${d} min`}
            selected={minutes === d}
            onPress={() => {
              if (running) return;
              setMinutes(d);
              setRemaining(d * 60);
            }}
          />
        ))}
      </View>
      <Text style={styles.timer}>
        {mm}:{ss}
      </Text>
      {!running ? (
        <Button
          label="Surfer l'envie"
          onPress={() => {
            setRemaining(minutes * 60);
            setRunning(true);
            setMsg(null);
          }}
        />
      ) : (
        <Button label="Arrêter" variant="ghost" onPress={() => { setRunning(false); void finish(false); }} />
      )}
      <Body muted>
        Aide : {HELP_LINES[0].name} {HELP_LINES[0].phone} · {HELP_LINES[3].name} {HELP_LINES[3].phone}
      </Body>
      {msg ? <Body muted>{msg}</Body> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', marginVertical: spacing.md },
  timer: { fontSize: 48, color: colors.ember, fontWeight: '700', textAlign: 'center', marginVertical: spacing.lg },
});
