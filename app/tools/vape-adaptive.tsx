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
  resumeAutoVapeTier,
  setManualVapeTier,
  startVapeAdaptiveChallenge,
  type VapeAdaptiveDashboard,
} from '@/src/domain/services/adaptiveChallengeService';
import { displayElapsedSec } from '@/src/domain/services/challengeService';
import type { ChallengeSession } from '@/src/domain/models/challengeSession';
import {
  delayMinutesForTier,
  highestRecordMilestoneMinutes,
  intervalMinutesForTier,
  VAPE_BREATHING_SECONDS,
  VAPE_DELAY_TIER_MINUTES,
  VAPE_INTERVAL_TIER_MINUTES,
  VAPE_RECORD_MILESTONE_MINUTES,
  VAPE_TIER_COUNT,
  vapeChallengeDef,
} from '@/src/domain/content/vapeChallengeDefs';
import type { VapeChallengeFormat } from '@/src/domain/models/adaptiveChallenge';
import { formatChallengeHms, progressTowardTarget } from '@/src/domain/rules/challengeDuration';
import { breathPhaseAtElapsedMs } from '@/src/domain/rules/breathingRhythm';
import { friendlyDbError } from '@/src/utils/dbErrors';

const FORMATS: VapeChallengeFormat[] = ['delay_craving', 'breathing', 'interval', 'record'];

function attemptLine(outcome: string, format: VapeChallengeFormat, dur: number | null): string {
  const label = formatDefLabel(format);
  const d = dur != null ? formatChallengeHms(dur) : '—';
  const st =
    outcome === 'success' ? 'Réussi' : outcome === 'failure' ? 'Écart' : outcome === 'unknown' ? 'Non renseigné' : '';
  return `${label} · ${st} · ${d}`;
}

function nextRecordMilestoneSec(bestSec: number): number | null {
  for (const m of VAPE_RECORD_MILESTONE_MINUTES) {
    const sec = m * 60;
    if (bestSec < sec) return sec;
  }
  return null;
}

export default function VapeAdaptiveScreen() {
  const insets = useSafeAreaInsets();
  const [dash, setDash] = useState<VapeAdaptiveDashboard | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const startLock = useRef(false);
  const closeLock = useRef(false);
  const [elapsed, setElapsed] = useState(0);
  const [runningSession, setRunningSession] = useState<ChallengeSession | null>(null);
  const [breathPhase, setBreathPhase] = useState<'inspire' | 'expire'>('inspire');

  const reload = useCallback(async () => {
    const db = await getDb();
    const d = await getVapeAdaptiveDashboard(db);
    setDash(d);
    if (d.running?.challengeSessionId) {
      const { getById } = await import('@/src/data/db/repositories/challengeSessionRepo');
      const s = await getById(db, d.running.challengeSessionId);
      setRunningSession(s);
      setElapsed(s ? displayElapsedSec(s) : 0);
    } else {
      setRunningSession(null);
      setElapsed(0);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  useEffect(() => {
    if (!runningSession) return;
    const id = setInterval(() => {
      const e = displayElapsedSec(runningSession);
      setElapsed(e);
      setBreathPhase(breathPhaseAtElapsedMs(e * 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [runningSession]);

  const delayTier = dash?.state.tierIndex ?? 0;
  const intervalTier = dash?.state.tierIndexInterval ?? 0;

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
      if (mode === 'vaped' && dash.running.format === 'record') {
        parts.push('Durée tenue enregistrée dans ton record si c\'est ton meilleur temps.');
      } else if (r.attempt.outcome === 'success') {
        parts.push('Bien joué — rien ne valide l\'abstinence à ta place.');
      } else if (mode === 'unknown') parts.push('Résultat laissé non renseigné.');
      else parts.push('Session interrompue ou palier non atteint — non comptée comme réussite.');
      setMsg(parts.join(' '));
      await reload();
    } catch (err) {
      setMsg(friendlyDbError(err));
    } finally {
      closeLock.current = false;
      setBusy(false);
    }
  };

  const pickTier = async (track: 'delay' | 'interval', idx: number) => {
    setBusy(true);
    try {
      const db = await getDb();
      await setManualVapeTier(db, track, idx);
      await reload();
      setMsg(
        track === 'delay'
          ? 'Palier retard choisi manuellement.'
          : 'Palier intervalle choisi manuellement.',
      );
    } catch (err) {
      setMsg(friendlyDbError(err));
    } finally {
      setBusy(false);
    }
  };

  const resumeAuto = async (track: 'delay' | 'interval') => {
    setBusy(true);
    try {
      const db = await getDb();
      await resumeAutoVapeTier(db, track);
      await reload();
      setMsg('Suggestions automatiques réactivées pour ce type de défi.');
    } catch (err) {
      setMsg(friendlyDbError(err));
    } finally {
      setBusy(false);
    }
  };

  const running = dash?.running;
  const targetSec = running?.targetDurationSec ?? null;
  const progress = progressTowardTarget(elapsed, targetSec);
  const canValidate =
    running != null &&
    (running.format === 'record'
      ? elapsed >= 60
      : targetSec != null
        ? elapsed >= targetSec
        : false);

  const recordBest = dash?.record?.bestDurationSec ?? 0;
  const nextRecord = nextRecordMilestoneSec(recordBest);

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
          <Text style={styles.panelTitle}>Difficulté — retarder une envie</Text>
          <Body>
            Palier actuel : {delayTier + 1}/{VAPE_TIER_COUNT} — cible {delayMinutesForTier(delayTier)} min
          </Body>
          {dash?.nextTierMinutes != null ? (
            <Body muted>Prochain palier : {dash.nextTierMinutes} min de retard.</Body>
          ) : null}
          <View style={styles.row}>
            {VAPE_DELAY_TIER_MINUTES.map((_, i) => (
              <Chip key={i} label={`${i + 1}`} selected={delayTier === i} onPress={() => void pickTier('delay', i)} />
            ))}
          </View>
          {dash?.state.tierManual ? (
            <Button label="Reprendre suggestions auto (retard)" variant="ghost" onPress={() => void resumeAuto('delay')} />
          ) : null}

          <Text style={[styles.panelTitle, { marginTop: spacing.md }]}>Difficulté — intervalle sans vape</Text>
          <Body>
            Palier actuel : {intervalTier + 1}/{VAPE_TIER_COUNT} — cible {intervalMinutesForTier(intervalTier)} min
          </Body>
          {dash?.nextIntervalTierMinutes != null ? (
            <Body muted>Prochain palier : {dash.nextIntervalTierMinutes} min.</Body>
          ) : null}
          <View style={styles.row}>
            {VAPE_INTERVAL_TIER_MINUTES.map((_, i) => (
              <Chip
                key={`iv${i}`}
                label={`${i + 1}`}
                selected={intervalTier === i}
                onPress={() => void pickTier('interval', i)}
              />
            ))}
          </View>
          {dash?.state.tierManualInterval ? (
            <Button
              label="Reprendre suggestions auto (intervalle)"
              variant="ghost"
              onPress={() => void resumeAuto('interval')}
            />
          ) : null}

          {dash?.record ? (
            <View style={{ marginTop: spacing.sm }}>
              <Body>
                Meilleur record : {formatChallengeHms(dash.record.bestDurationSec)}
                {nextRecord != null
                  ? ` · prochain palier or : ${formatChallengeHms(nextRecord)}`
                  : highestRecordMilestoneMinutes(recordBest)
                    ? ' · paliers record atteints'
                    : ''}
              </Body>
            </View>
          ) : (
            <View style={{ marginTop: spacing.sm }}>
              <Body muted>
                Aucun record personnel — premier palier or possible dès {VAPE_RECORD_MILESTONE_MINUTES[0]} min.
              </Body>
            </View>
          )}
        </FantasyPanel>

        {running ? (
          <View style={styles.heroCard}>
            <Text style={styles.heroTitle}>{formatDefLabel(running.format)}</Text>
            {targetSec != null ? (
              <Body muted>
                Cible du défi : {formatChallengeHms(targetSec)} — durée actuelle ci-dessous.
              </Body>
            ) : (
              <Body muted>Chronomètre multi-jours — déclare quand tu vapes ou termine au palier record.</Body>
            )}
            <Text style={styles.timer}>{formatChallengeHms(elapsed)}</Text>
            {running.format === 'breathing' ? (
              <Text style={styles.phase}>{breathPhase === 'inspire' ? 'Inspire… (4 s)' : 'Expire… (6 s)'}</Text>
            ) : null}
            {progress != null ? (
              <ProgressBar progress={progress} label="Vers la cible du défi" />
            ) : null}
            <View style={styles.row}>
              {running.format === 'record' ? (
                <Button label="J'ai vapoté" variant="ghost" disabled={busy} onPress={() => void close('vaped')} />
              ) : null}
              <Button
                label={
                  running.format === 'record'
                    ? 'Terminer (palier record atteint)'
                    : running.format === 'breathing'
                      ? 'Séance terminée (3 min)'
                      : "J'ai tenu — valider"
                }
                disabled={busy || !canValidate}
                onPress={() => void close('completed')}
              />
              {running.format !== 'record' ? (
                <Button label="Interrompu / envie cédée" variant="secondary" disabled={busy} onPress={() => void close('vaped')} />
              ) : null}
              <Button
                label="Arrêter sans renseigner"
                variant="ghost"
                disabled={busy}
                onPress={() => void close('unknown')}
              />
            </View>
          </View>
        ) : (
          <FantasyPanel>
            <Text style={styles.panelTitle}>Défis recommandés</Text>
            {FORMATS.map((f) => {
              const def = vapeChallengeDef(f);
              const hint =
                f === 'delay_craving'
                  ? `cible ${delayMinutesForTier(delayTier)} min`
                  : f === 'interval'
                    ? `cible ${intervalMinutesForTier(intervalTier)} min`
                    : f === 'breathing'
                      ? `séance guidée ${VAPE_BREATHING_SECONDS / 60} min (4s/6s)`
                      : `palier or dès ${VAPE_RECORD_MILESTONE_MINUTES[0]} min`;
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
  phase: { color: colors.ink, textAlign: 'center', marginBottom: spacing.sm, fontSize: 18 },
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