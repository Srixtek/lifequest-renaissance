import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Body, Button, Chip, Screen, Title } from '@/src/design-system/ui';
import { colors, spacing, typography } from '@/src/design-system/theme';
import { FantasyPanel } from '@/src/design-system/FantasyPanel';
import { ProgressBar } from '@/src/design-system/ProgressBar';
import { getDb } from '@/src/data/db/client';
import {
  closeVapeAdaptiveChallenge,
  formatDefLabel,
  getVapeAdaptiveDashboard,
  setManualVapeTier,
  startVapeAdaptiveChallenge,
  type VapeAdaptiveDashboard,
} from '@/src/domain/services/adaptiveChallengeService';
import { displayElapsedSec } from '@/src/domain/services/challengeService';
import { getById as getSessionById } from '@/src/data/db/repositories/challengeSessionRepo';
import {
  delayMinutesForTier,
  intervalMinutesForTier,
  VAPE_DELAY_TIER_MINUTES,
  VAPE_TIER_COUNT,
  vapeChallengeDef,
} from '@/src/domain/content/vapeChallengeDefs';
import type { VapeChallengeFormat } from '@/src/domain/models/adaptiveChallenge';
import { formatChallengeHms, progressTowardTarget } from '@/src/domain/rules/challengeDuration';
import { friendlyDbError } from '@/src/utils/dbErrors';

const FORMATS: VapeChallengeFormat[] = ['delay_craving', 'breathing', 'interval', 'record'];

function attemptLine(outcome: string, format: VapeChallengeFormat, dur: number | null): string {
  const label = formatDefLabel(format);
  const d = dur != null ? formatChallengeHms(dur) : '—';
  const st =
    outcome === 'success' ? 'Réussi' : outcome === 'failure' ? 'Écart' : outcome === 'unknown' ? 'Non renseigné' : '';
  return `${label} · ${st} · ${d}`;
}

export default function VapeAdaptiveScreen() {
  const insets = useSafeAreaInsets();
  const [dash, setDash] = useState<VapeAdaptiveDashboard | null>(null);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const startLock = useRef(false);
  const closeLock = useRef(false);
  const [elapsed, setElapsed] = useState(0);

  const reload = useCallback(async () => {
    const db = await getDb();
    const d = await getVapeAdaptiveDashboard(db);
    setDash(d);
    if (d.running?.challengeSessionId) {
      const s = await getSessionById(db, d.running.challengeSessionId);
      setElapsed(s ? displayElapsedSec(s) : 0);
    } else {
      setElapsed(0);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  useEffect(() => {
    if (!dash?.running) return;
    const id = setInterval(() => {
      setTick((n) => n + 1);
      void (async () => {
        const db = await getDb();
        const sid = dash.running?.challengeSessionId;
        if (!sid) return;
        const s = await getSessionById(db, sid);
        if (s) setElapsed(displayElapsedSec(s));
      })();
    }, 1000);
    return () => clearInterval(id);
  }, [dash?.running]);

  void tick;

  const tier = dash?.state.tierIndex ?? 0;

  const start = async (format: VapeChallengeFormat) => {
    if (startLock.current || busy) return;
    startLock.current = true;
    setBusy(true);
    setMsg(null);
    try {
      const db = await getDb();
      const r = await startVapeAdaptiveChallenge(db, format);
      if (!r.ok) {
        if (r.code === 'category_inactive') setMsg('Active d\'abord l\'habitude Vape pour voir les défis.');
        else if (r.code === 'already_running') setMsg('Un défi adaptatif est déjà en cours.');
        else setMsg('Impossible de démarrer — un chronomètre vape est peut-être déjà actif.');
        return;
      }
      setMsg(`Défi « ${vapeChallengeDef(format).title} » démarré.`);
      await reload();
    } catch (err) {
      setMsg(friendlyDbError(err));
    } finally {
      startLock.current = false;
      setBusy(false);
    }
  };

  const close = async (mode: 'completed' | 'vaped' | 'unknown') => {
    if (!dash?.running || closeLock.current || busy) return;
    closeLock.current = true;
    setBusy(true);
    setMsg(null);
    try {
      const db = await getDb();
      const r = await closeVapeAdaptiveChallenge(db, dash.running.id, mode);
      if (!r.ok) {
        setMsg('Clôture impossible — réessaie dans un instant.');
        return;
      }
      const parts = [];
      if (r.tierMessage) parts.push(r.tierMessage);
      if (r.goldGranted) parts.push(`+${3} or pour ce palier confirmé.`);
      if (mode === 'vaped') parts.push('Durée enregistrée — le record précédent est conservé.');
      else if (r.attempt.outcome === 'success') parts.push('Bien joué — rien ne valide l\'abstinence à ta place.');
      else if (mode === 'unknown') parts.push('Résultat laissé non renseigné.');
      else parts.push('Session interrompue — non comptée comme réussite.');
      setMsg(parts.join(' '));
      await reload();
    } catch (err) {
      setMsg(friendlyDbError(err));
    } finally {
      closeLock.current = false;
      setBusy(false);
    }
  };

  const pickTier = async (idx: number) => {
    setBusy(true);
    try {
      const db = await getDb();
      await setManualVapeTier(db, idx);
      await reload();
      setMsg('Palier choisi manuellement — l\'ajustement auto attend la fin du défi en cours.');
    } catch (err) {
      setMsg(friendlyDbError(err));
    } finally {
      setBusy(false);
    }
  };

  const running = dash?.running;
  const targetSec = running?.targetDurationSec ?? null;
  const progress = progressTowardTarget(elapsed, targetSec);

  return (
    <Screen style={{ paddingTop: 0 }}>
      <ScrollView
        contentContainerStyle={{
          paddingBottom: insets.bottom + spacing.xxl,
          paddingHorizontal: spacing.lg,
          paddingTop: Math.max(insets.top, spacing.md),
        }}
      >
        <Title>Vape — Mes défis</Title>
        <Body muted>
          Défis courts, progressifs et record. Aucune preuve automatique d'abstinence — tu restes juge du résultat.
        </Body>
        {msg ? <Text style={styles.msg}>{msg}</Text> : null}

        {!dash?.vapeActive ? (
          <FantasyPanel>
            <Body>L'habitude Vape n'est pas active — active-la dans Habitudes pour débloquer les défis adaptatifs.</Body>
          </FantasyPanel>
        ) : null}

        <FantasyPanel accent>
          <Text style={styles.panelTitle}>Difficulté</Text>
          <Body>
            Palier actuel : {tier + 1}/{VAPE_TIER_COUNT} ({delayMinutesForTier(tier)} min de retard)
          </Body>
          {dash?.nextTierMinutes != null ? (
            <Body muted>Prochain palier : {dash.nextTierMinutes} minutes de retard.</Body>
          ) : (
            <Body muted>Tu es au palier le plus élevé proposé pour l'instant.</Body>
          )}
          <View style={styles.row}>
            {VAPE_DELAY_TIER_MINUTES.map((_, i) => (
              <Chip key={i} label={`${i + 1}`} selected={tier === i} onPress={() => void pickTier(i)} />
            ))}
          </View>
          {dash?.record ? (
            <Body>
              Meilleur record déclaré : {formatChallengeHms(dash.record.bestDurationSec)} (
              {formatDefLabel(dash.record.format)})
            </Body>
          ) : (
            <Body muted>Aucun record personnel enregistré pour l'instant.</Body>
          )}
        </FantasyPanel>

        {running ? (
          <View style={styles.heroCard}>
            <Text style={styles.heroTitle}>{formatDefLabel(running.format)}</Text>
            <Text style={styles.timer}>{formatChallengeHms(elapsed)}</Text>
            {progress != null ? (
              <ProgressBar progress={progress} label="Vers la cible du défi" />
            ) : (
              <Body muted>Chronomètre multi-jours — ferme quand tu veux déclarer le résultat.</Body>
            )}
            <View style={styles.row}>
              {running.format === 'record' ? (
                <Button label="J'ai vapoté" variant="ghost" disabled={busy} onPress={() => void close('vaped')} />
              ) : null}
              <Button
                label={running.format === 'record' ? 'Terminer ce défi' : "J'ai tenu — valider"}
                disabled={busy}
                onPress={() => void close('completed')}
              />
              {running.format !== 'record' ? (
                <Button label="Interrompu" variant="secondary" disabled={busy} onPress={() => void close('vaped')} />
              ) : null}
            </View>
          </View>
        ) : (
          <FantasyPanel>
            <Text style={styles.panelTitle}>Défis recommandés</Text>
            {FORMATS.map((f) => {
              const def = vapeChallengeDef(f);
              const hint =
                f === 'delay_craving'
                  ? `${delayMinutesForTier(tier)} min`
                  : f === 'interval'
                    ? `${intervalMinutesForTier(tier)} min`
                    : f === 'breathing'
                      ? '3 min'
                      : 'multi-jours';
              return (
                <View key={f} style={styles.recRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.recTitle}>{def.title}</Text>
                    <Body muted>
                      {def.subtitle} · {hint}
                    </Body>
                  </View>
                  <Button label="Commencer" disabled={busy || !dash?.vapeActive} onPress={() => void start(f)} />
                </View>
              );
            })}
          </FantasyPanel>
        )}

        {dash && dash.history.length > 0 ? (
          <FantasyPanel>
            <Text style={styles.panelTitle}>Historique</Text>
            {dash.history.map((h) => (
              <Text key={h.id} style={styles.histLine}>
                {attemptLine(h.outcome, h.format, h.declaredDurationSec)}
              </Text>
            ))}
          </FantasyPanel>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  panelTitle: { ...typography.subtitle, color: colors.gold, marginBottom: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm, gap: spacing.xs },
  heroCard: {
    marginTop: spacing.md,
    padding: spacing.lg,
    borderRadius: 16,
    backgroundColor: colors.mist,
    borderWidth: 1,
    borderColor: colors.gold,
  },
  heroTitle: { ...typography.subtitle, color: colors.gold, textAlign: 'center' },
  timer: {
    fontSize: 52,
    fontWeight: '700',
    color: colors.ember,
    textAlign: 'center',
    marginVertical: spacing.md,
  },
  recRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  recTitle: { ...typography.label, color: colors.ink },
  histLine: { ...typography.caption, color: colors.ink, marginTop: 4 },
  msg: { color: colors.ember, marginTop: spacing.sm },
});