import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Body, Button, Chip } from './ui';
import { colors, spacing, typography } from './theme';
import { FantasyPanel } from './FantasyPanel';
import { ProgressBar } from './ProgressBar';
import { CollapsibleSection } from './CollapsibleSection';
import { getDb } from '../data/db/client';
import {
  amendLastDeclarationTime,
  claimVapeRewards,
  declareCraving,
  declareVape,
  getVapeTrackerDashboard,
  resolveCraving,
  startVapeMainSession,
  undoLastDeclaration,
  voidVapeSession,
  type CravingFormat,
  type VapeTrackerDashboard,
} from '../domain/services/vapeTrackerService';
import { formatChallengeHms } from '../domain/rules/challengeDuration';
import { formatDuration, nextStepInfo, safeElapsedSec, stepsReached } from '../domain/rules/vapeMain';
import { friendlyDbError } from '../utils/dbErrors';

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function outcomeLabel(outcome: string): string {
  if (outcome === 'success') return 'Tenu';
  if (outcome === 'failure') return 'Cédé';
  if (outcome === 'unknown') return 'Non renseigné';
  return outcome;
}

const PAST_PRESETS: Array<{ label: string; minutes: number }> = [
  { label: 'il y a 15 min', minutes: 15 },
  { label: 'il y a 1 h', minutes: 60 },
  { label: 'il y a 3 h', minutes: 180 },
];

export function VapeTracker() {
  const router = useRouter();
  const [dash, setDash] = useState<VapeTrackerDashboard | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmClaim, setConfirmClaim] = useState(false);
  const [cravingChoice, setCravingChoice] = useState(false);
  const lock = useRef(false);

  const reload = useCallback(async () => {
    try {
      const db = await getDb();
      setDash(await getVapeTrackerDashboard(db));
      setNowMs(Date.now());
    } catch (err) {
      setMsg(friendlyDbError(err));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void reload();
    });
    return () => sub.remove();
  }, [reload]);

  const ticking = dash?.active != null || dash?.craving != null;
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ticking]);

  const activeElapsed = dash?.active ? safeElapsedSec(dash.active.startedAt, nowMs) : null;
  const reachedSteps = activeElapsed ? stepsReached(activeElapsed.sec) : 0;
  const lastReached = useRef(0);
  useEffect(() => {
    if (reachedSteps !== lastReached.current) {
      lastReached.current = reachedSteps;
      if (reachedSteps > 0) void reload();
    }
  }, [reachedSteps, reload]);

  const run = async (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setMsg(friendlyDbError(err));
    } finally {
      lock.current = false;
      setBusy(false);
      await reload();
    }
  };

  const start = () =>
    run(async () => {
      const db = await getDb();
      const r = await startVapeMainSession(db);
      if (!r.ok) {
        setMsg('Un ancien chrono vape (record / intervalle) est en cours : termine-le depuis « Anciens défis » avant de démarrer.');
        return;
      }
      setConfirmClaim(false);
      setMsg(r.alreadyActive ? 'Le chrono tourne déjà.' : 'Chrono lancé. Tu peux fermer l\'app : le temps est calculé depuis l\'heure de départ.');
    });

  const vaped = (minutesAgo = 0) =>
    run(async () => {
      const db = await getDb();
      const now = new Date();
      const r = await declareVape(db, {
        now,
        endedAt: minutesAgo > 0 ? new Date(now.getTime() - minutesAgo * 60_000) : undefined,
      });
      if (!r.ok) {
        setMsg(
          r.code === 'no_active'
            ? 'Aucun chrono en cours — déjà enregistré.'
            : r.code === 'clock_anomaly'
              ? 'L\'horloge du téléphone semble décalée : annule ce chrono puis relance-le.'
              : 'Heure incohérente (avant le départ ou dans le futur).',
        );
        return;
      }
      setConfirmClaim(false);
      const parts = [`Enregistré : ${formatDuration(r.durationSec)} sans vapoter. Ce n'est pas un échec définitif.`];
      if (r.newRecord) parts.push('Nouveau record personnel !');
      if (r.unclaimedSteps > 0) parts.push(`${r.unclaimedSteps} palier(s) à confirmer ci-dessous.`);
      setMsg(parts.join(' '));
    });

  const undo = () =>
    run(async () => {
      const db = await getDb();
      const r = await undoLastDeclaration(db);
      setMsg(r.ok ? 'Déclaration annulée : le chrono reprend là où il en était.' : 'Impossible d\'annuler (un chrono est déjà en cours).');
    });

  const amend = (minutes: number) =>
    run(async () => {
      const db = await getDb();
      const r = await amendLastDeclarationTime(db, new Date(Date.now() - minutes * 60_000));
      setMsg(
        r.ok
          ? `Heure corrigée : ${formatDuration(r.durationSec)} sans vapoter. L'ancienne heure est conservée.`
          : 'Cette heure n\'est pas possible (avant le départ ou après la déclaration).',
      );
    });

  const cancelActive = () =>
    run(async () => {
      if (!dash?.active) return;
      const db = await getDb();
      const r = await voidVapeSession(db, dash.active.id);
      setMsg(r.ok ? 'Chrono annulé (gardé dans l\'historique, hors record).' : 'Rien à annuler.');
    });

  const claim = () =>
    run(async () => {
      const db = await getDb();
      const r = await claimVapeRewards(db, { confirmed: true });
      setConfirmClaim(false);
      if (r.ok) setMsg(r.message);
      else if (r.code === 'nothing_to_claim') setMsg('Rien de nouveau à récupérer.');
      else setMsg('Horloge incohérente : rien n\'a été crédité.');
    });

  const craving = (format: CravingFormat) =>
    run(async () => {
      const db = await getDb();
      const r = await declareCraving(db, format);
      setCravingChoice(false);
      if (r.ok) {
        setMsg('Envie notée. Respire, tu peux la laisser passer — aucun or pour avoir seulement déclaré.');
        return;
      }
      if (r.code === 'already_running') setMsg('Une envie est déjà en cours de traitement.');
      else if (r.code === 'session_busy') setMsg('Un autre chrono « sans vapoter » est actif ailleurs : termine-le d\'abord.');
      else setMsg('Impossible de lancer le défi envie pour le moment.');
    });

  const resolve = (outcome: 'held' | 'gave_in' | 'skip') =>
    run(async () => {
      if (!dash?.craving) return;
      const db = await getDb();
      const r = await resolveCraving(db, dash.craving.attemptId, outcome);
      if (!r.ok) {
        setMsg(r.code === 'too_early' ? 'Pas encore : attends la fin du compte à rebours pour valider.' : 'Clôture impossible, réessaie.');
        return;
      }
      if (outcome === 'held') {
        setMsg(
          r.goldGranted
            ? 'Envie surmontée, bravo ! +3 or (récompense unique pour ce palier de défi).'
            : 'Envie surmontée, bravo ! Pas d\'or cette fois (récompense déjà obtenue pour ce palier, ou plafond du jour).',
        );
      } else if (outcome === 'gave_in') {
        setMsg(
          r.mainClosed
            ? 'Noté sans jugement. Ton chrono a été clôturé : tu peux repartir quand tu veux.'
            : 'Noté sans jugement. Tu peux relancer le chrono quand tu veux.',
        );
      } else {
        setMsg('Envie laissée non renseignée — aucun résultat enregistré.');
      }
    });

  if (!dash) {
    return (
      <FantasyPanel accent>
        <Body muted>Chargement du chrono…</Body>
      </FantasyPanel>
    );
  }

  const active = dash.active;
  const elapsed = activeElapsed?.sec ?? 0;
  const next = active && !activeElapsed?.anomaly ? nextStepInfo(elapsed) : null;
  const recordShown = active ? Math.max(dash.bestClosedSec, elapsed) : dash.bestClosedSec;
  const claim_ = dash.claim;
  const cravingRemaining = dash.craving ? Math.max(0, dash.craving.targetSec - safeElapsedSec(dash.craving.startedAt, nowMs).sec) : 0;
  const cravingElapsed = dash.craving ? safeElapsedSec(dash.craving.startedAt, nowMs).sec : 0;

  return (
    <View>
      <FantasyPanel accent>
        {active ? (
          <>
            <Text style={styles.kicker}>Sans vapoter depuis</Text>
            <Text style={styles.timer} accessibilityLabel={`Temps sans vapoter : ${formatDuration(elapsed)}`}>
              {formatChallengeHms(elapsed)}
            </Text>
            <Body muted>Départ : {formatWhen(active.startedAt)}</Body>
            {activeElapsed?.anomaly ? (
              <Text style={styles.warn}>
                L'horloge du téléphone est antérieure au départ du chrono : aucun temps ni or n'est compté. Annule ce chrono
                (menu « Corriger ») ou remets l'heure à jour.
              </Text>
            ) : null}
            {next ? (
              <ProgressBar
                progress={next.progress}
                label={`Prochain palier : ${next.label} — dans ${formatDuration(next.remainingSec)}`}
              />
            ) : null}
          </>
        ) : (
          <>
            <Text style={styles.kicker}>Chrono sans vapoter</Text>
            {dash.lastClosed ? (
              <>
                <Text style={styles.idle}>Dernier intervalle : {formatDuration(dash.lastClosed.durationSec)}</Text>
                <Body muted>Terminé le {formatWhen(dash.lastClosed.endedAt)}. Prêt à repartir ?</Body>
              </>
            ) : (
              <Body muted>
                Lance le chrono quand tu commences une période sans vapoter. Il continue même app fermée ; les paliers de 30 min
                se confirment toi-même — rien n'est jugé automatiquement.
              </Body>
            )}
            <View style={styles.rowTop}>
              <Button
                label={dash.lastClosed ? 'Repartir maintenant' : 'Démarrer le chrono'}
                onPress={() => void start()}
                disabled={busy}
              />
            </View>
          </>
        )}

        <View style={styles.recordRow}>
          <Text style={styles.recordLabel}>Record</Text>
          <Text style={styles.recordValue}>{recordShown > 0 ? formatDuration(recordShown) : '—'}</Text>
        </View>
        {active && elapsed > dash.bestClosedSec && dash.bestClosedSec > 0 ? <Text style={styles.recordLive}>Tu es en train de battre ton record !</Text> : null}

        {claim_ ? (
          <View style={styles.claimBox}>
            {dash.dailyGoldRemaining <= 0 ? (
              <Body muted>
                {claim_.stepsPending} palier(s) atteint(s). Plafond d'or du jour atteint ({dash.dailyGoldCap} or) : la progression
                continue, sans or supplémentaire aujourd'hui.
              </Body>
            ) : confirmClaim ? (
              <>
                <Body>
                  Tu confirmes ne pas avoir vapoté pendant ces {formatDuration(claim_.confirmedSec)} ? Personne ne le vérifie : c'est
                  ta parole. Si ce n'est pas exact, corrige l'heure avant de récupérer.
                </Body>
                <View style={styles.row}>
                  <Button
                    label={`Oui, je confirme (+${claim_.creditableGold} or)`}
                    onPress={() => void claim()}
                    disabled={busy}
                  />
                  <Button label="Pas sûr·e" variant="ghost" onPress={() => setConfirmClaim(false)} disabled={busy} />
                </View>
              </>
            ) : (
              <>
                <Body>
                  {claim_.stepsPending > 0 ? `${claim_.stepsPending} palier(s) de 30 min à confirmer` : 'Bonus de record à confirmer'}
                  {claim_.recordsPending.length > 0 ? ' + bonus de record' : ''} — jusqu'à{' '}
                  <Text style={styles.gold}>+{claim_.creditableGold} or</Text> (plafond du jour : {dash.dailyGoldRemaining} or
                  restants).
                </Body>
                <Button label="Confirmer et récupérer" onPress={() => setConfirmClaim(true)} disabled={busy} />
              </>
            )}
          </View>
        ) : null}
      </FantasyPanel>

      {msg ? <Text style={styles.msg}>{msg}</Text> : null}

      {dash.lastClosed && !active ? (
        <View style={styles.row}>
          {dash.lastClosed.canUndo ? (
            <Button label="Annuler « J'ai vapoté » (erreur)" variant="ghost" compact onPress={() => void undo()} disabled={busy} />
          ) : null}
          {PAST_PRESETS.map((p) => (
            <Chip key={p.minutes} label={`Vapoté ${p.label}`} onPress={() => void amend(p.minutes)} />
          ))}
        </View>
      ) : null}

      {dash.craving ? (
        <FantasyPanel>
          <Text style={styles.panelTitle}>
            {dash.craving.format === 'breathing' ? 'Respire — 3 minutes' : 'Laisse passer l\'envie'}
          </Text>
          <Text style={styles.cravingTimer}>
            {cravingRemaining > 0 ? `Encore ${formatChallengeHms(cravingRemaining)}` : 'Objectif atteint'}
          </Text>
          <ProgressBar progress={dash.craving.targetSec > 0 ? Math.min(1, cravingElapsed / dash.craving.targetSec) : 0} />
          <Body muted>
            Une envie dure en général quelques minutes. Bois de l'eau, bouge un peu. Valide seulement si c'est vrai :
            ton honnêteté est la seule preuve.
          </Body>
          <View style={styles.row}>
            <Button label="J'ai tenu" onPress={() => void resolve('held')} disabled={busy || cravingRemaining > 0} />
            <Button label="J'ai cédé" variant="neutral" onPress={() => void resolve('gave_in')} disabled={busy} />
            <Button label="Ne pas renseigner" variant="ghost" onPress={() => void resolve('skip')} disabled={busy} />
          </View>
        </FantasyPanel>
      ) : cravingChoice ? (
        <FantasyPanel>
          <Text style={styles.panelTitle}>Une envie ? Choisis comment la traverser</Text>
          <Body muted>Déclarer l'envie ne donne pas d'or ; seul un défi réellement tenu peut en rapporter.</Body>
          <View style={styles.row}>
            <Button label="Retarder (chrono court)" onPress={() => void craving('delay_craving')} disabled={busy} />
            <Button label="Respirer 3 min" variant="secondary" onPress={() => void craving('breathing')} disabled={busy} />
            <Button label="Annuler" variant="ghost" onPress={() => setCravingChoice(false)} disabled={busy} />
          </View>
        </FantasyPanel>
      ) : null}

      <View style={styles.actions}>
        <View style={styles.actionCell}>
          <Button
            label="J'ai vapoté"
            variant="neutral"
            onPress={() => void vaped()}
            disabled={busy || active == null}
          />
        </View>
        <View style={styles.actionCell}>
          <Button
            label="J'ai une envie"
            onPress={() => setCravingChoice(true)}
            disabled={busy || dash.craving != null}
          />
        </View>
      </View>
      {dash.legacyTimerRunning && !active ? (
        <Text style={styles.warn}>Un ancien chrono vape (record / intervalle) est en cours : termine-le avant de démarrer ce chrono.</Text>
      ) : null}

      {dash.recentRewards.length > 0 ? (
        <View style={styles.rewards}>
          <Text style={styles.panelTitle}>Dernières récompenses</Text>
          {dash.recentRewards.slice(0, 3).map((r, i) => (
            <Text key={`${r.createdAt}-${i}`} style={styles.rewardLine}>
              +{r.amount} or · {r.reason}
            </Text>
          ))}
          <Text style={styles.small}>Solde : {dash.goldBalance} or</Text>
        </View>
      ) : null}

      {dash.history.length > 0 ? (
        <CollapsibleSection title="Intervalles récents" hint={`${dash.history.length} derniers`}>
          {dash.history.map((h) => (
            <Text key={h.id} style={[styles.histLine, h.voided && styles.histVoid]}>
              {formatWhen(h.startedAt)} → {h.endedAt ? formatWhen(h.endedAt) : '…'} ·{' '}
              {h.voided ? 'annulé' : formatDuration(h.durationSec)}
              {h.amended ? ' · heure corrigée' : ''}
            </Text>
          ))}
        </CollapsibleSection>
      ) : null}

      {dash.recentCravings.length > 0 ? (
        <CollapsibleSection title="Envies récentes" hint={`${dash.recentCravings.length} dernières`}>
          {dash.recentCravings.map((a) => (
            <Text key={a.id} style={styles.histLine}>
              {formatWhen(a.startedAt)} · {a.format === 'breathing' ? 'Respiration' : 'Retarder'} · {outcomeLabel(a.outcome)}
            </Text>
          ))}
        </CollapsibleSection>
      ) : null}

      {active ? (
        <CollapsibleSection title="Corriger une erreur" hint="Heure de vape oubliée, mauvais départ">
          <Body muted>Déclarer une vape passée ferme l'intervalle à cette heure (jamais avant le départ).</Body>
          <View style={styles.row}>
            {PAST_PRESETS.map((p) => (
              <Chip key={p.minutes} label={`Vapoté ${p.label}`} onPress={() => void vaped(p.minutes)} />
            ))}
          </View>
          <Button label="Annuler ce chrono (lancé par erreur)" variant="ghost" onPress={() => void cancelActive()} disabled={busy} />
        </CollapsibleSection>
      ) : null}

      <Button label="Anciens défis vape (record, intervalle…)" variant="ghost" onPress={() => router.push('/tools/vape-adaptive')} />
    </View>
  );
}

const styles = StyleSheet.create({
  kicker: { ...typography.label, color: colors.muted, textAlign: 'center' },
  timer: { ...typography.timer, color: colors.ember, textAlign: 'center', marginVertical: spacing.sm },
  idle: { ...typography.subtitle, color: colors.goldBright, textAlign: 'center', marginTop: spacing.sm },
  rowTop: { marginTop: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm, gap: spacing.xs },
  recordRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  recordLabel: { ...typography.caption, color: colors.muted },
  recordValue: { ...typography.subtitle, color: colors.gold },
  recordLive: { ...typography.caption, color: colors.success, marginTop: 2 },
  claimBox: {
    marginTop: spacing.md,
    padding: spacing.sm,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.goldDim,
    backgroundColor: colors.cardHighlight,
  },
  gold: { color: colors.goldBright, fontWeight: '700' },
  msg: { ...typography.body, color: colors.ember, marginTop: spacing.sm },
  warn: { ...typography.caption, color: colors.warn, marginTop: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  actionCell: { flex: 1 },
  panelTitle: { ...typography.subtitle, color: colors.gold, marginBottom: spacing.xs },
  cravingTimer: { ...typography.title, color: colors.ember, textAlign: 'center', marginVertical: spacing.xs },
  rewards: { marginTop: spacing.md },
  rewardLine: { ...typography.caption, color: colors.ink, marginTop: 2 },
  small: { ...typography.caption, color: colors.muted, marginTop: 4 },
  histLine: { ...typography.caption, color: colors.ink, marginTop: 4 },
  histVoid: { color: colors.muted, textDecorationLine: 'line-through' },
});
