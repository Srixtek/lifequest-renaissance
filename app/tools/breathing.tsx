import { useEffect, useRef, useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { Body, Button, Chip, Screen, Title } from '@/src/design-system/ui';
import { colors, spacing } from '@/src/design-system/theme';
import { getDb } from '@/src/data/db/client';
import { recordBreathingSession } from '@/src/domain/services/toolsService';
import { useAppStore } from '@/src/state/appStore';

const DURATIONS = [1, 3, 5, 10];

export default function BreathingScreen() {
  const refresh = useAppStore((s) => s.refresh);
  const [minutes, setMinutes] = useState(5);
  const [remaining, setRemaining] = useState(5 * 60);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<'inspire' | 'expire'>('inspire');
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const phaseTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!running) {
      if (timer.current) clearInterval(timer.current);
      if (phaseTimer.current) clearInterval(phaseTimer.current);
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
    // ~6 cycles/min: 4s inspire / 6s expire
    let inspire = true;
    setPhase('inspire');
    phaseTimer.current = setInterval(() => {
      inspire = !inspire;
      setPhase(inspire ? 'inspire' : 'expire');
    }, inspire ? 4000 : 6000);
    return () => {
      if (timer.current) clearInterval(timer.current);
      if (phaseTimer.current) clearInterval(phaseTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  const finish = async (completed: boolean) => {
    const elapsed = minutes * 60 - remaining;
    const db = await getDb();
    const r = await recordBreathingSession(db, Math.max(elapsed, completed ? minutes * 60 : elapsed), completed);
    await refresh();
    if (r.bonusXp > 0) setMsg(`Session terminée. Bonus première fois : +${r.bonusXp} XP`);
    else setMsg(completed ? 'Session terminée.' : 'Session en pause / arrêtée.');
  };

  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');

  return (
    <Screen>
      <Title>Respiration</Title>
      <Body muted>Rythme calme (~6/min). Arrête si tu as des vertiges. Peut aider à se sentir plus calme.</Body>
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
      <Text style={styles.phase}>{phase === 'inspire' ? 'Inspire…' : 'Expire…'}</Text>
      {!running ? (
        <Button
          label="Démarrer"
          onPress={() => {
            setRemaining(minutes * 60);
            setMsg(null);
            setRunning(true);
          }}
        />
      ) : (
        <Button
          label="Pause / arrêter"
          variant="ghost"
          onPress={() => {
            setRunning(false);
            void finish(false);
          }}
        />
      )}
      <Button
        label="Terminer maintenant (test)"
        variant="ghost"
        onPress={async () => {
          setRunning(false);
          setRemaining(0);
          const db = await getDb();
          const r = await recordBreathingSession(db, minutes * 60, true, { shortcut: true });
          await refresh();
          setMsg(r.bonusXp > 0 ? `Terminé. +${r.bonusXp} XP (1ʳᵉ fois)` : 'Terminé.');
        }}
      />
      {msg ? <Body muted>{msg}</Body> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', marginVertical: spacing.md },
  timer: { fontSize: 48, color: colors.ember, fontWeight: '700', textAlign: 'center', marginTop: spacing.lg },
  phase: { color: colors.ink, textAlign: 'center', marginBottom: spacing.lg, fontSize: 18 },
});
