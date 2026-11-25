import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, View, StyleSheet } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Body, Button, Chip, Field, Screen, Title } from '@/src/design-system/ui';
import { colors, spacing, typography } from '@/src/design-system/theme';
import { FantasyPanel } from '@/src/design-system/FantasyPanel';
import { ProgressBar } from '@/src/design-system/ProgressBar';
import { getDb } from '@/src/data/db/client';
import {
  CHALLENGE_TYPE_LABELS,
  SCREEN_TARGET_MINUTES,
  SPORT_TARGET_MINUTES,
  type ChallengeSession,
  type ChallengeType,
} from '@/src/domain/models/challengeSession';
import {
  completeScreenChallenge,
  completeSportChallenge,
  completeVapeChallenge,
  displayElapsedSec,
  getActiveChallenge,
  interruptVapeChallenge,
  listChallengeHistory,
  startChallengeSession,
} from '@/src/domain/services/challengeService';
import {
  formatChallengeHms,
  parsePositiveTargetMinutes,
  parseSportConfirmMinutes,
  progressTowardTarget,
} from '@/src/domain/rules/challengeDuration';
import { friendlyDbError } from '@/src/utils/dbErrors';

const TYPES: ChallengeType[] = ['no_vape', 'no_screen', 'sport'];

function stateLabel(state: ChallengeSession['state']): string {
  if (state === 'completed') return 'Terminé';
  if (state === 'interrupted') return 'Interrompu';
  return 'En cours';
}

function formatHistoryLine(s: ChallengeSession): string {
  const dur = s.userConfirmedDurationSec ?? s.durationSec;
  const target =
    s.targetDurationSec != null ? ` · cible ${Math.round(s.targetDurationSec / 60)} min` : '';
  const when = (s.endedUtc ?? s.startedUtc).slice(0, 16).replace('T', ' ');
  return `${stateLabel(s.state)} · ${formatChallengeHms(dur)}${target} · ${when}`;
}

export default function ChallengesScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ type?: string }>();
  const focusType = TYPES.includes(params.type as ChallengeType) ? (params.type as ChallengeType) : null;

  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const startLockRef = useRef(false);
  const closeLockRef = useRef(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [active, setActive] = useState<Record<ChallengeType, ChallengeSession | null>>({
    no_vape: null,
    no_screen: null,
    sport: null,
  });
  const [history, setHistory] = useState<Record<ChallengeType, ChallengeSession[]>>({
    no_vape: [],
    no_screen: [],
    sport: [],
  });
  const [targetMin, setTargetMin] = useState<Record<ChallengeType, number>>({
    no_vape: 0,
    no_screen: 30,
    sport: 30,
  });
  const [customMin, setCustomMin] = useState<Record<ChallengeType, string>>({
    no_vape: '',
    no_screen: '',
    sport: '',
  });
  const [sportConfirmMin, setSportConfirmMin] = useState('');
  const [screenClosePending, setScreenClosePending] = useState(false);

  const reload = useCallback(async () => {
    const db = await getDb();
    const nextActive: typeof active = { no_vape: null, no_screen: null, sport: null };
    const nextHist: typeof history = { no_vape: [], no_screen: [], sport: [] };
    for (const t of TYPES) {
      nextActive[t] = await getActiveChallenge(db, t);
      nextHist[t] = await listChallengeHistory(db, t, 5);
    }
    setActive(nextActive);
    setHistory(nextHist);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const hasRunning = useMemo(() => TYPES.some((t) => active[t] != null), [active]);

  useEffect(() => {
    if (!hasRunning) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [hasRunning]);

  const resolvedTargetSec = (type: ChallengeType): number | null => {
    if (type === 'no_vape') return null;
    const custom = customMin[type].trim();
    if (custom) {
      const parsed = parsePositiveTargetMinutes(custom);
      if (parsed.ok) return parsed.minutes * 60;
      return null;
    }
    const m = targetMin[type];
    return m > 0 ? m * 60 : null;
  };

  const start = async (type: ChallengeType) => {
    if (startLockRef.current) return;
    startLockRef.current = true;
    setBusy(true);
    setMsg(null);
    try {
      const db = await getDb();
      let target: number | null = null;
      if (type !== 'no_vape') {
        const custom = customMin[type].trim();
        if (custom) {
          const parsed = parsePositiveTargetMinutes(custom);
          if (!parsed.ok) {
            setMsg('Durée personnalisée invalide — nombre positif requis (pas 0, négatif, infini).');
            return;
          }
          target = parsed.minutes * 60;
        } else {
          target = resolvedTargetSec(type);
          if (target == null) {
            setMsg('Choisis une durée cible (minutes).');
            return;
          }
        }
      }
      const r = await startChallengeSession(db, type, target);
      if (!r.ok) {
        setMsg('Un défi est déjà en cours pour ce type.');
        return;
      }
      setSportConfirmMin('');
      await reload();
      setMsg(
        type === 'no_vape'
          ? 'Défi sans vapoter démarré — le temps est calculé à partir de maintenant.'
          : 'Défi démarré. Tu peux fermer l\'app : le temps sera recalculé au retour.',
      );
    } catch (err) {
      setMsg(friendlyDbError(err));
    } finally {
      startLockRef.current = false;
      setBusy(false);
    }
  };

  const withCloseLock = async (fn: () => Promise<void>) => {
    if (closeLockRef.current) return;
    closeLockRef.current = true;
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setMsg(friendlyDbError(err));
    } finally {
      closeLockRef.current = false;
      setBusy(false);
    }
  };

  const session = (type: ChallengeType) => active[type];

  const elapsed = (type: ChallengeType) => {
    const s = session(type);
    if (!s) return 0;
    void tick;
    return displayElapsedSec(s);
  };

  const renderSection = (type: ChallengeType) => {
    const running = session(type);
    const elapsedSec = elapsed(type);
    const targetSec = running?.targetDurationSec ?? resolvedTargetSec(type);
    const progress = progressTowardTarget(elapsedSec, targetSec);
    const targets = type === 'no_screen' ? SCREEN_TARGET_MINUTES : SPORT_TARGET_MINUTES;

    return (
      <FantasyPanel key={type} accent={focusType === type}>
        <Text style={styles.panelTitle}>{CHALLENGE_TYPE_LABELS[type]}</Text>
        {type === 'no_vape' ? (
          <Body muted>
            Chronomètre multi-jours sans remise à minuit. Aucune preuve d'abstinence — ton ressenti compte.
          </Body>
        ) : type === 'no_screen' ? (
          <Body muted>
            Objectif indicatif : pas d'auto-validation à l'heure atteinte. À l'arrêt, tu déclares « respecté » ou
            « interrompu ».
          </Body>
        ) : (
          <Body muted>Arrêt manuel puis confirmation de la durée réelle — rien n'est enregistré sans toi.</Body>
        )}

        {!running ? (
          <>
            {type !== 'no_vape' ? (
              <>
                <View style={styles.row}>
                  {targets.map((m) => (
                    <Chip
                      key={m}
                      label={`${m} min`}
                      selected={targetMin[type] === m && !customMin[type].trim()}
                      onPress={() => {
                        setTargetMin((s) => ({ ...s, [type]: m }));
                        setCustomMin((s) => ({ ...s, [type]: '' }));
                      }}
                    />
                  ))}
                </View>
                <Field
                  value={customMin[type]}
                  onChangeText={(t) => setCustomMin((s) => ({ ...s, [type]: t }))}
                  keyboardType="decimal-pad"
                  placeholder="Autre durée (minutes)"
                />
              </>
            ) : null}
            <Button
              label={type === 'no_vape' ? 'Je commence un défi sans vapoter' : 'Commencer le défi'}
              onPress={() => void start(type)}
              disabled={busy}
            />
          </>
        ) : (
          <View style={styles.timerCard}>
            <Text style={styles.timer}>{formatChallengeHms(elapsedSec)}</Text>
            {progress != null ? (
              <ProgressBar
                progress={progress}
                label={`Progression vers la cible (${Math.round((targetSec ?? 0) / 60)} min)`}
              />
            ) : (
              <Body muted>Pas de durée cible — le temps s'accumule tant que le défi tourne.</Body>
            )}

            {type === 'no_vape' ? (
              <View style={styles.row}>
                <Button
                  label="J'ai vapoté"
                  variant="ghost"
                  disabled={busy}
                  onPress={() =>
                    void withCloseLock(async () => {
                      const db = await getDb();
                      const r = await interruptVapeChallenge(db, running.id);
                      if (!r.ok) {
                        setMsg(
                          r.code === 'invalid_end_time'
                            ? 'Horodatage invalide — le défi reste actif.'
                            : 'Impossible de clôturer ce défi.',
                        );
                        return;
                      }
                      setMsg('Défi interrompu — durée conservée. Tu peux en lancer un nouveau.');
                      await reload();
                    })
                  }
                />
                <Button
                  label="Terminer ce défi"
                  disabled={busy}
                  onPress={() =>
                    void withCloseLock(async () => {
                      const db = await getDb();
                      const r = await completeVapeChallenge(db, running.id);
                      if (!r.ok) {
                        setMsg(
                          r.code === 'invalid_end_time'
                            ? 'Horodatage invalide — le défi reste actif.'
                            : 'Impossible de terminer ce défi.',
                        );
                        return;
                      }
                      setMsg('Défi terminé — bravo pour cette période.');
                      await reload();
                    })
                  }
                />
              </View>
            ) : null}

            {type === 'no_screen' ? (
              <>
                {!screenClosePending ? (
                  <Button
                    label="Arrêter le défi"
                    variant="secondary"
                    disabled={busy}
                    onPress={() => setScreenClosePending(true)}
                  />
                ) : (
                  <>
                    <Body>Comment s'est passé ce temps ?</Body>
                    <View style={styles.row}>
                      <Button
                        label="Respecté"
                        disabled={busy}
                        onPress={() =>
                          void withCloseLock(async () => {
                            const db = await getDb();
                            const r = await completeScreenChallenge(db, running.id, true);
                            if (!r.ok) {
                              setMsg(
                                r.code === 'invalid_end_time'
                                  ? 'Horodatage invalide — le défi reste actif.'
                                  : 'Clôture impossible.',
                              );
                              return;
                            }
                            setScreenClosePending(false);
                            setMsg('Temps sans écran enregistré comme respecté.');
                            await reload();
                          })
                        }
                      />
                      <Button
                        label="Interrompu"
                        variant="ghost"
                        disabled={busy}
                        onPress={() =>
                          void withCloseLock(async () => {
                            const db = await getDb();
                            const r = await completeScreenChallenge(db, running.id, false);
                            if (!r.ok) {
                              setMsg(
                                r.code === 'invalid_end_time'
                                  ? 'Horodatage invalide — le défi reste actif.'
                                  : 'Clôture impossible.',
                              );
                              return;
                            }
                            setScreenClosePending(false);
                            setMsg('Défi sans écran interrompu — durée conservée.');
                            await reload();
                          })
                        }
                      />
                    </View>
                  </>
                )}
              </>
            ) : null}

            {type === 'sport' ? (
              <>
                <Body muted>
                  Durée suggérée : {formatChallengeHms(elapsedSec)} ({Math.max(1, Math.round(elapsedSec / 60))} min)
                </Body>
                <Field
                  value={sportConfirmMin}
                  onChangeText={setSportConfirmMin}
                  keyboardType="decimal-pad"
                  placeholder="Minutes réelles confirmées"
                />
                <Button
                  label="Confirmer et terminer"
                  disabled={busy}
                  onPress={async () => {
                    const parsed = parseSportConfirmMinutes(sportConfirmMin);
                    if (!parsed.ok) {
                      setMsg(
                        parsed.error === 'Vide'
                          ? 'Confirme la durée réelle avant de terminer.'
                          : 'Minutes invalides — nombre fini entre 0 et 24 h.',
                      );
                      return;
                    }
                    await withCloseLock(async () => {
                      const db = await getDb();
                      const r = await completeSportChallenge(db, running.id, parsed.minutes);
                      if (!r.ok) {
                        setMsg(
                          r.code === 'sport_needs_confirm'
                            ? 'Confirme la durée avant d\'enregistrer le sport.'
                            : r.code === 'invalid_end_time'
                              ? 'Horodatage invalide — le défi reste actif.'
                              : 'Clôture impossible.',
                        );
                        return;
                      }
                      setSportConfirmMin('');
                      setMsg(`Activité enregistrée (${parsed.minutes} min confirmées).`);
                      await reload();
                    });
                  }}
                />
              </>
            ) : null}
          </View>
        )}

        {history[type].length > 0 ? (
          <View style={styles.history}>
            <Text style={styles.historyTitle}>Cinq dernières sessions</Text>
            {history[type].map((h) => (
              <Text key={h.id} style={styles.historyLine}>
                {formatHistoryLine(h)}
              </Text>
            ))}
          </View>
        ) : (
          <Body muted>Aucune session terminée pour l'instant.</Body>
        )}
      </FantasyPanel>
    );
  };

  return (
    <Screen style={{ paddingTop: 0 }}>
      <ScrollView
        contentContainerStyle={{
          paddingBottom: insets.bottom + spacing.xxl,
          paddingHorizontal: spacing.lg,
          paddingTop: Math.max(insets.top, spacing.md),
        }}
      >
        <Title>Défis chronométrés</Title>
        <Body muted>
          Timers persistants hors ligne — une session active par type. Aucune récompense XP automatique.
        </Body>
        {msg ? <Text style={styles.msg}>{msg}</Text> : null}
        {TYPES.filter((t) => (focusType ? t === focusType : true)).map(renderSection)}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  panelTitle: { ...typography.subtitle, color: colors.gold, marginBottom: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm },
  timerCard: { marginTop: spacing.md, padding: spacing.md, borderRadius: 12, backgroundColor: colors.mist },
  timer: {
    fontSize: 48,
    fontWeight: '700',
    color: colors.ember,
    textAlign: 'center',
    marginVertical: spacing.md,
  },
  history: { marginTop: spacing.md },
  historyTitle: { ...typography.caption, color: colors.muted, marginBottom: spacing.xs },
  historyLine: { ...typography.caption, color: colors.ink, marginTop: 4 },
  msg: { color: colors.ember, marginTop: spacing.sm },
});