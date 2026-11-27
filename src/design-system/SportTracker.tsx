import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Body, Button, Chip, Field } from './ui';
import { colors, spacing, typography } from './theme';
import { FantasyPanel } from './FantasyPanel';
import { ProgressBar } from './ProgressBar';
import { CollapsibleSection } from './CollapsibleSection';
import { getDb } from '../data/db/client';
import type { SportGoalRow, SportSession } from '../data/db/repositories/sportRepo';
import { formatClockInput, wallClockToInstant } from '../domain/rules/alcohol';
import {
  SPORT_ACTIVITIES,
  SPORT_ACTIVITY_BY_ID,
  SPORT_METRIC_LABEL,
  distanceToKmText,
  durationToMinutesText,
  formatDistance,
  formatDuration,
  formatMetricValue,
  formatReps,
  isValidGoalTarget,
  parseDistanceKmInput,
  parseDurationMinutesInput,
  parseRepsInput,
  validateSessionForm,
  valueForMetric,
  type SessionFormInput,
  type SportActivityId,
  type SportMetric,
  type SportOutcome,
} from '../domain/rules/sport';
import {
  acceptSportSuggestion,
  addSession,
  adoptHabitGoal,
  cancelSession,
  dismissSportSuggestion,
  editSession,
  getSportDashboard,
  getSportDayTotals,
  getSportGoalHistory,
  setSportGoal,
  type DayAgg,
  type SportActivitySummary,
  type SportDashboard,
  type SportDayTotals,
} from '../domain/services/sportTrackerService';
import { addDays } from '../domain/rules/dates';
import { createId } from '../utils/id';
import { friendlyDbError } from '../utils/dbErrors';

type OutcomeChoice = 'auto' | 'achieved' | 'failed' | 'free';

interface FormState {
  durationMin: string;
  reps: string;
  distanceKm: string;
  freeMetric: 'reps' | 'duration';
  disciplineName: string;
  date: string;
  time: string;
  note: string;
}

const TIME_SHIFTS: Array<{ label: string; minutes: number }> = [
  { label: 'Maintenant', minutes: 0 },
  { label: 'Il y a 1 h', minutes: 60 },
  { label: 'Il y a 3 h', minutes: 180 },
  { label: 'Hier même heure', minutes: 1440 },
];

const ERROR_TEXT: Record<string, string> = {
  invalid_session: 'Valeurs de séance invalides.',
  invalid_time: 'Date ou heure invalide (format AAAA-MM-JJ et HH:MM).',
  future_time: 'Cette heure est dans le futur.',
  invalid_outcome: 'Ce résultat ne correspond pas à cette séance.',
  no_goal: 'Aucun objectif actif pour cette activité : choisis « Sans objectif ».',
  stale_goal: 'L\'objectif a changé entre-temps : ferme puis rouvre le formulaire.',
  missing_performance: 'Cet objectif porte sur une autre mesure : renseigne-la ou choisis « Sans objectif ».',
  below_target: '« Atteint » demande une performance au moins égale à l\'objectif : choisis « Échoué » (ta performance est conservée) ou corrige la valeur.',
  not_found: 'Cette séance n\'existe plus.',
  cancelled: 'Cette séance est déjà annulée.',
};

function shortDate(localDate: string): string {
  const [, m, d] = localDate.split('-');
  return `${d}/${m}`;
}

function formatWhen(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('fr-FR', { timeZone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function metricText(metric: SportMetric, value: number): string {
  return formatMetricValue(metric, value);
}

function sessionLine(s: SportSession): string {
  const parts: string[] = [];
  if (s.reps != null) parts.push(formatReps(s.reps));
  if (s.durationSec != null) parts.push(formatDuration(s.durationSec));
  if (s.distanceM != null) parts.push(formatDistance(s.distanceM));
  return parts.join(' · ');
}

function outcomeLabel(s: SportSession): string {
  if (s.outcome === 'achieved') return `objectif atteint (${metricText(s.goalMetric!, s.goalTarget!)})`;
  if (s.outcome === 'failed') return `objectif non atteint (${metricText(s.goalMetric!, s.goalTarget!)})`;
  return 'séance libre';
}

function dayAggLine(a: DayAgg): string {
  if (a.count === 0) return 'Aucune séance';
  const n = `${a.count} séance${a.count > 1 ? 's' : ''}`;
  const parts: string[] = [n];
  if (a.totalReps != null) parts.push(formatReps(a.totalReps));
  if (a.totalDurationSec != null) parts.push(formatDuration(a.totalDurationSec));
  if (a.totalDistanceM != null) parts.push(formatDistance(a.totalDistanceM));
  return parts.join(' · ');
}

function bestOfAgg(metric: SportMetric, a: DayAgg): number | null {
  return metric === 'reps' ? a.bestReps : metric === 'duration_sec' ? a.bestDurationSec : a.bestDistanceM;
}

function emptyForm(now: Date, timeZone?: string): FormState {
  const clock = formatClockInput(now, timeZone);
  return {
    durationMin: '',
    reps: '',
    distanceKm: '',
    freeMetric: 'duration',
    disciplineName: '',
    date: clock.date,
    time: clock.time,
    note: '',
  };
}

function formFromSession(s: SportSession, timeZone?: string): FormState {
  const clock = formatClockInput(new Date(s.performedAt), timeZone);
  return {
    durationMin: s.durationSec != null ? durationToMinutesText(s.durationSec) : '',
    reps: s.reps != null ? String(s.reps) : '',
    distanceKm: s.distanceM != null ? distanceToKmText(s.distanceM) : '',
    freeMetric: s.reps != null ? 'reps' : 'duration',
    disciplineName: s.disciplineName ?? '',
    date: clock.date,
    time: clock.time,
    note: s.note ?? '',
  };
}

export function SportTracker() {
  const router = useRouter();
  const [dash, setDash] = useState<SportDashboard | null>(null);
  const [activityId, setActivityId] = useState<SportActivityId | null>(null);
  const [week, setWeek] = useState<SportDayTotals[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SportSession | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [outcomeChoice, setOutcomeChoice] = useState<OutcomeChoice>('auto');
  const [requestId, setRequestId] = useState(() => createId('sreq'));
  const [cancelAsk, setCancelAsk] = useState<string | null>(null);
  const [goalOpen, setGoalOpen] = useState(false);
  const [goalDraft, setGoalDraft] = useState('');
  const [goalMetric, setGoalMetric] = useState<SportMetric>('reps');
  const [history, setHistory] = useState<SportGoalRow[]>([]);
  const lock = useRef(false);
  const activityRef = useRef<SportActivityId | null>(null);
  activityRef.current = activityId;

  const reload = useCallback(async () => {
    try {
      const db = await getDb();
      const d = await getSportDashboard(db);
      setDash(d);
      const current = activityRef.current ?? d.mainActivityId;
      if (activityRef.current == null) setActivityId(d.mainActivityId);
      setWeek(await getSportDayTotals(db, current, addDays(d.today, -6), d.today));
      setHistory(await getSportGoalHistory(db, current));
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

  useEffect(() => {
    void reload();
  }, [activityId, reload]);

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

  const tz = dash?.timeZone;
  const current: SportActivitySummary | null = useMemo(
    () => (dash && activityId ? dash.activities.find((a) => a.activity.id === activityId) ?? null : null),
    [dash, activityId],
  );
  const def = activityId ? SPORT_ACTIVITY_BY_ID[activityId] : null;
  const goal = current?.goal ?? null;

  const input: SessionFormInput | null = useMemo(
    () =>
      form && activityId
        ? {
            activityId,
            reps: form.reps,
            durationMin: form.durationMin,
            distanceKm: form.distanceKm,
            freeMetric: form.freeMetric,
            disciplineName: form.disciplineName,
            note: form.note,
          }
        : null,
    [form, activityId],
  );
  const validated = useMemo(() => (input ? validateSessionForm(input) : null), [input]);

  const resolvedOutcome: SportOutcome = useMemo(() => {
    const g = editing ? (editing.goalId ? { metric: editing.goalMetric!, target: editing.goalTarget! } : null) : goal;
    if (!g) return 'free';
    if (outcomeChoice === 'free') return 'free';
    if (outcomeChoice === 'achieved' || outcomeChoice === 'failed') return outcomeChoice;
    if (!validated?.ok) return 'free';
    const v = valueForMetric(g.metric, validated.value);
    if (v == null) return 'free';
    return v >= g.target ? 'achieved' : 'failed';
  }, [editing, goal, outcomeChoice, validated]);

  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm(new Date(), tz));
    setFormErrors({});
    setOutcomeChoice('auto');
    setRequestId(createId('sreq'));
    setFormOpen(true);
    setCancelAsk(null);
  };

  const openEdit = (s: SportSession) => {
    setEditing(s);
    setForm(formFromSession(s, tz));
    setFormErrors({});
    setOutcomeChoice(s.outcome === 'free' ? 'free' : s.outcome);
    setFormOpen(true);
    setCancelAsk(null);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
    setForm(null);
    setFormErrors({});
  };

  const patch = (p: Partial<FormState>) => setForm((f) => (f ? { ...f, ...p } : f));

  const shiftTime = (minutes: number) => {
    const clock = formatClockInput(new Date(Date.now() - minutes * 60_000), tz);
    patch({ date: clock.date, time: clock.time });
  };

  const selectActivity = (id: SportActivityId) => {
    if (id === activityId) return;
    setActivityId(id);
    closeForm();
    setGoalOpen(false);
    setCancelAsk(null);
  };

  const successMessage = (s: SportSession, newRecordTexts: string[]): string => {
    const perf = sessionLine(s);
    const rec = newRecordTexts.length ? ` Nouveau record personnel : ${newRecordTexts.join(', ')}.` : '';
    if (s.outcome === 'failed') {
      return `Tentative enregistrée : ${perf} (objectif ${metricText(s.goalMetric!, s.goalTarget!)}, non atteint). Ta performance compte dans tes totaux et ton record ; l'objectif reste à atteindre.${rec}`;
    }
    if (s.outcome === 'achieved') {
      return `Objectif atteint : ${perf} (objectif ${metricText(s.goalMetric!, s.goalTarget!)}).${rec}`;
    }
    return `Séance enregistrée : ${perf}.${rec}`;
  };

  const submit = () =>
    run(async () => {
      if (!form || !validated || !activityId) return;
      if (!validated.ok) {
        setFormErrors(validated.errors as Record<string, string>);
        return;
      }
      const performedAt = wallClockToInstant(form.date, form.time, tz);
      if (!performedAt) {
        setFormErrors({ date: ERROR_TEXT.invalid_time });
        return;
      }
      const db = await getDb();
      if (editing) {
        const r = await editSession(db, editing.id, {
          session: validated.value,
          performedAt,
          outcome: resolvedOutcome,
        });
        if (!r.ok) {
          setFormErrors({ date: ERROR_TEXT[r.code] ?? 'Correction impossible.' });
          return;
        }
        setMsg(
          r.changed
            ? 'Correction enregistrée. Les totaux et records sont recalculés ; l\'ancienne valeur est conservée dans l\'historique des corrections.'
            : 'Aucun changement.',
        );
      } else {
        const r = await addSession(db, {
          session: validated.value,
          performedAt,
          outcome: resolvedOutcome,
          goalId: resolvedOutcome === 'free' ? null : goal?.id ?? null,
          clientRequestId: requestId,
        });
        if (!r.ok) {
          setFormErrors({ date: ERROR_TEXT[r.code] ?? 'Enregistrement impossible.' });
          return;
        }
        setMsg(
          r.duplicate
            ? 'Déjà enregistrée : rien n\'a été ajouté une seconde fois.'
            : successMessage(
                r.session,
                r.newRecords.map((n) => metricText(n.metric, n.value)),
              ),
        );
        setRequestId(createId('sreq'));
      }
      closeForm();
    });

  const cancelEntry = (id: string) =>
    run(async () => {
      const db = await getDb();
      const r = await cancelSession(db, id);
      setCancelAsk(null);
      setMsg(
        r.ok
          ? 'Séance annulée. Elle n\'est plus comptée (totaux, records), mais reste dans l\'historique des corrections.'
          : ERROR_TEXT[r.code === 'already_cancelled' ? 'cancelled' : 'not_found'],
      );
    });

  const openGoalEditor = () => {
    if (!def || def.goalMetrics.length === 0) return;
    const metric = goal?.metric ?? def.goalMetrics[0];
    setGoalMetric(metric);
    setGoalDraft(
      goal ? (metric === 'reps' ? String(goal.target) : metric === 'duration_sec' ? durationToMinutesText(goal.target) : distanceToKmText(goal.target)) : '',
    );
    setGoalOpen((o) => !o);
  };

  const saveGoal = () =>
    run(async () => {
      if (!activityId) return;
      const p =
        goalMetric === 'reps'
          ? parseRepsInput(goalDraft)
          : goalMetric === 'duration_sec'
            ? parseDurationMinutesInput(goalDraft)
            : parseDistanceKmInput(goalDraft);
      if (!p.ok) {
        setMsg(p.error);
        return;
      }
      if (!isValidGoalTarget(goalMetric, p.value)) {
        setMsg('Objectif trop petit ou trop grand.');
        return;
      }
      const db = await getDb();
      const r = await setSportGoal(db, { activityId, metric: goalMetric, target: p.value });
      setMsg(
        r.ok
          ? r.changed
            ? `Objectif enregistré : ${metricText(goalMetric, p.value)}. Les séances passées gardent l'objectif d'alors.`
            : 'Objectif inchangé.'
          : 'Objectif invalide.',
      );
      setGoalOpen(false);
    });

  const removeGoal = () =>
    run(async () => {
      if (!activityId || !goal) return;
      const db = await getDb();
      await setSportGoal(db, { activityId, metric: goal.metric, target: null });
      setMsg('Objectif retiré. L\'historique et les séances sont conservés.');
      setGoalOpen(false);
    });

  const acceptSuggestion = () =>
    run(async () => {
      if (!activityId || !current?.suggestion) return;
      const db = await getDb();
      const r = await acceptSportSuggestion(db, activityId, current.suggestion.proposedTarget);
      setMsg(r.ok ? 'Nouvel objectif enregistré. Tu peux le modifier à tout moment.' : 'Cette suggestion a changé : vérifie-la puis réessaie.');
    });

  const dismissSuggestion = () =>
    run(async () => {
      if (!activityId) return;
      const db = await getDb();
      await dismissSportSuggestion(db, activityId);
      setMsg('Suggestion ignorée : ton objectif ne change pas. Elle ne reviendra pas avant quelques nouvelles tentatives.');
    });

  const adopt = (goalId: string) =>
    run(async () => {
      const db = await getDb();
      const r = await adoptHabitGoal(db, goalId);
      setMsg(
        r.ok
          ? 'Objectif repris dans le journal Sport. Ton habitude d\'origine n\'est pas modifiée.'
          : r.code === 'ambiguous'
            ? 'Plusieurs habitudes correspondent à cette activité : aucun rattachement automatique.'
            : 'Cette habitude ne peut pas être rattachée sans ambiguïté.',
      );
    });

  if (!dash || !activityId || !current || !def) {
    return (
      <FantasyPanel accent>
        <Body muted>Chargement du suivi sportif…</Body>
      </FantasyPanel>
    );
  }

  const primary = def.primaryMetric;
  const goalBest = goal ? bestOfAgg(goal.metric, current.today) : null;
  const goalProgress = goal && goalBest != null ? Math.min(1, goalBest / goal.target) : 0;
  const goalFmt = (g: { metric: SportMetric; target: number }) => metricText(g.metric, g.target);
  const recordLines = (s: SportActivitySummary) =>
    (Object.entries(s.records) as Array<[SportMetric, { value: number; localDate: string }]>).map(
      ([m, r]) => `${SPORT_METRIC_LABEL[m]} : ${metricText(m, r.value)} (${shortDate(r.localDate)})`,
    );
  const trendText =
    current.trend === 'up'
      ? 'Tes séances récentes sont en hausse.'
      : current.trend === 'down'
        ? 'Tes séances récentes sont un peu en dessous des précédentes : ça arrive, rien d\'obligatoire.'
        : current.trend === 'flat'
          ? 'Tes séances récentes sont stables.'
          : null;
  const editGoal = editing ? (editing.goalId ? { metric: editing.goalMetric!, target: editing.goalTarget! } : null) : goal;
  const livePerf =
    validated?.ok && editGoal ? valueForMetric(editGoal.metric, validated.value) : null;

  return (
    <View>
      <View style={styles.chips}>
        {SPORT_ACTIVITIES.map((a) => (
          <Chip key={a.id} label={a.label} selected={a.id === activityId} onPress={() => selectActivity(a.id)} />
        ))}
      </View>

      <FantasyPanel accent>
        <Text style={styles.kicker}>{def.label} · aujourd'hui</Text>
        <Text style={styles.big} accessibilityLabel={`Aujourd'hui : ${dayAggLine(current.today)}`}>
          {dayAggLine(current.today)}
        </Text>
        {current.today.count === 0 ? (
          <Body muted>Rien n'est enregistré aujourd'hui. Pas de séance, pas de pénalité : tu avances à ton rythme.</Body>
        ) : current.today.count > 1 && primary ? (
          <Text style={styles.small}>
            Total du jour ≠ meilleure séance : meilleure séance {bestOfAgg(primary, current.today) != null ? metricText(primary, bestOfAgg(primary, current.today)!) : '—'}.
          </Text>
        ) : null}

        <View style={styles.statsRow}>
          <View style={styles.statCell}>
            <Text style={styles.statLabel}>Meilleure séance du jour</Text>
            <Text style={styles.statValue}>
              {primary && bestOfAgg(primary, current.today) != null ? metricText(primary, bestOfAgg(primary, current.today)!) : '—'}
            </Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statLabel}>Semaine en cours</Text>
            <Text style={styles.statValue}>{dayAggLine(current.week)}</Text>
          </View>
        </View>
        {current.week.achieved + current.week.failed > 0 ? (
          <Text style={styles.small}>
            Cette semaine : {current.week.achieved} objectif(s) atteint(s) · {current.week.failed} non atteint(s) (les performances comptent dans les deux cas).
          </Text>
        ) : null}

        {def.goalMetrics.length > 0 ? (
          goal ? (
            <>
              <Text style={styles.goalLine}>
                Objectif actuel : {goalFmt(goal)} <Text style={styles.small}>(depuis le {shortDate(goal.effectiveFrom)})</Text>
              </Text>
              {goalBest != null ? (
                <ProgressBar
                  progress={goalProgress}
                  label={`Meilleure séance du jour : ${metricText(goal.metric, goalBest)} sur ${goalFmt(goal)}`}
                />
              ) : null}
            </>
          ) : (
            <Body muted>Pas d'objectif pour cette activité : tu peux enregistrer des séances librement.</Body>
          )
        ) : (
          <Body muted>Séance libre : durée ou répétitions, avec le nom de ta discipline si tu veux. Ni réussite ni échec.</Body>
        )}

        {current.suggestion ? (
          <View style={styles.suggestion}>
            <Text style={styles.suggestionText}>{current.suggestion.message}</Text>
            <View style={styles.row}>
              <Button label="Accepter" compact onPress={() => void acceptSuggestion()} disabled={busy} />
              <Button
                label="Choisir moi-même"
                variant="secondary"
                compact
                onPress={() => {
                  setGoalMetric(current.suggestion!.metric);
                  setGoalDraft(
                    current.suggestion!.metric === 'reps'
                      ? String(current.suggestion!.proposedTarget)
                      : current.suggestion!.metric === 'duration_sec'
                        ? durationToMinutesText(current.suggestion!.proposedTarget)
                        : distanceToKmText(current.suggestion!.proposedTarget),
                  );
                  setGoalOpen(true);
                }}
                disabled={busy}
              />
              <Button label="Pas maintenant" variant="ghost" compact onPress={() => void dismissSuggestion()} disabled={busy} />
            </View>
          </View>
        ) : null}

        <View style={styles.rowTop}>
          <Button label="Enregistrer une séance" onPress={openAdd} disabled={busy} />
        </View>
        <View style={styles.row}>
          {def.goalMetrics.length > 0 ? (
            <Button label={goal ? 'Modifier l\'objectif' : 'Définir un objectif'} variant="secondary" compact onPress={openGoalEditor} disabled={busy} />
          ) : null}
          <Button label="Défis Sport (chrono)" variant="ghost" compact onPress={() => router.push('/tools/challenges?type=sport')} />
        </View>
        {msg ? <Text style={styles.msg}>{msg}</Text> : null}
      </FantasyPanel>

      {goalOpen && def.goalMetrics.length > 0 ? (
        <FantasyPanel>
          <Text style={styles.panelTitle}>Objectif · {def.label}</Text>
          {def.goalMetrics.length > 1 ? (
            <View style={styles.chips}>
              {def.goalMetrics.map((m) => (
                <Chip key={m} label={m === 'duration_sec' ? 'Durée' : 'Distance'} selected={goalMetric === m} onPress={() => setGoalMetric(m)} />
              ))}
            </View>
          ) : null}
          <Text style={styles.fieldLabel}>
            {goalMetric === 'reps' ? 'Répétitions visées' : goalMetric === 'duration_sec' ? 'Durée visée (min)' : 'Distance visée (km)'}
          </Text>
          <Field
            value={goalDraft}
            onChangeText={setGoalDraft}
            keyboardType="decimal-pad"
            accessibilityLabel="Valeur de l'objectif"
            placeholder={goalMetric === 'reps' ? 'ex. 20' : goalMetric === 'duration_sec' ? 'ex. 30' : 'ex. 5'}
          />
          <View style={styles.actions}>
            <View style={styles.actionCell}>
              <Button label="Enregistrer l'objectif" onPress={() => void saveGoal()} disabled={busy} />
            </View>
            <View style={styles.actionCell}>
              <Button label="Fermer" variant="ghost" onPress={() => setGoalOpen(false)} disabled={busy} />
            </View>
          </View>
          {goal ? <Button label="Retirer l'objectif" variant="ghost" compact onPress={() => void removeGoal()} disabled={busy} /> : null}
          <Body muted>Tu fixes ton propre objectif. Les séances passées restent évaluées avec la cible qui était en vigueur.</Body>
        </FantasyPanel>
      ) : null}

      {formOpen && form ? (
        <FantasyPanel>
          <Text style={styles.panelTitle}>
            {editing ? 'Corriger la séance' : 'Enregistrer une séance'} · {def.label}
          </Text>

          {def.kind === 'free' ? (
            <>
              <View style={styles.chips}>
                <Chip label="Durée" selected={form.freeMetric === 'duration'} onPress={() => patch({ freeMetric: 'duration' })} />
                <Chip label="Répétitions" selected={form.freeMetric === 'reps'} onPress={() => patch({ freeMetric: 'reps' })} />
              </View>
              <Text style={styles.fieldLabel}>Discipline (facultatif)</Text>
              <Field
                value={form.disciplineName}
                onChangeText={(v) => patch({ disciplineName: v })}
                placeholder="ex. Yoga, vélo…"
                accessibilityLabel="Nom de la discipline"
              />
              {formErrors.discipline ? <Text style={styles.err}>{formErrors.discipline}</Text> : null}
            </>
          ) : null}

          {def.kind === 'reps' || (def.kind === 'free' && form.freeMetric === 'reps') ? (
            <>
              <Text style={styles.fieldLabel}>Répétitions réalisées</Text>
              <Field
                value={form.reps}
                onChangeText={(v) => patch({ reps: v })}
                keyboardType="number-pad"
                accessibilityLabel="Répétitions réalisées"
              />
              {formErrors.reps ? <Text style={styles.err}>{formErrors.reps}</Text> : null}
            </>
          ) : null}

          {def.kind === 'distance_time' || (def.kind === 'free' && form.freeMetric === 'duration') ? (
            <>
              <Text style={styles.fieldLabel}>Durée (min){def.kind === 'distance_time' ? ' — ou distance' : ''}</Text>
              <Field
                value={form.durationMin}
                onChangeText={(v) => patch({ durationMin: v })}
                keyboardType="decimal-pad"
                accessibilityLabel="Durée en minutes"
              />
              {formErrors.duration ? <Text style={styles.err}>{formErrors.duration}</Text> : null}
            </>
          ) : null}

          {def.kind === 'distance_time' ? (
            <>
              <Text style={styles.fieldLabel}>Distance (km, facultatif)</Text>
              <Field
                value={form.distanceKm}
                onChangeText={(v) => patch({ distanceKm: v })}
                keyboardType="decimal-pad"
                accessibilityLabel="Distance en kilomètres"
              />
              {formErrors.distance ? <Text style={styles.err}>{formErrors.distance}</Text> : null}
            </>
          ) : null}

          {editGoal && (!editing || editing.goalId) ? (
            <>
              <Text style={styles.fieldLabel}>Objectif : {goalFmt(editGoal)}</Text>
              <View style={styles.chips}>
                {editing ? null : <Chip label="Selon mon résultat" selected={outcomeChoice === 'auto'} onPress={() => setOutcomeChoice('auto')} />}
                <Chip label="Atteint" selected={outcomeChoice === 'achieved'} onPress={() => setOutcomeChoice('achieved')} />
                <Chip label="Échoué" selected={outcomeChoice === 'failed'} onPress={() => setOutcomeChoice('failed')} />
                {editing ? null : <Chip label="Sans objectif" selected={outcomeChoice === 'free'} onPress={() => setOutcomeChoice('free')} />}
              </View>
              <Text style={styles.small} accessibilityLiveRegion="polite">
                {resolvedOutcome === 'achieved'
                  ? `Résultat : objectif atteint${livePerf != null ? ` (${metricText(editGoal.metric, livePerf)} sur ${goalFmt(editGoal)})` : ''}.`
                  : resolvedOutcome === 'failed'
                    ? `Résultat : non atteint${livePerf != null ? ` (${metricText(editGoal.metric, livePerf)} sur ${goalFmt(editGoal)})` : ''} — ta performance est conservée et comptée.`
                    : 'Résultat : séance libre, ni réussite ni échec.'}
              </Text>
            </>
          ) : (
            <Text style={styles.small}>Séance libre : elle ne revendique ni réussite ni échec.</Text>
          )}

          <Text style={styles.fieldLabel}>Date et heure</Text>
          <View style={styles.chips}>
            {TIME_SHIFTS.map((s) => (
              <Chip key={s.label} label={s.label} onPress={() => shiftTime(s.minutes)} />
            ))}
          </View>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Field value={form.date} onChangeText={(v) => patch({ date: v })} placeholder="AAAA-MM-JJ" accessibilityLabel="Date de la séance" />
            </View>
            <View style={{ width: 96, marginLeft: spacing.xs }}>
              <Field value={form.time} onChangeText={(v) => patch({ time: v })} placeholder="HH:MM" accessibilityLabel="Heure de la séance" />
            </View>
          </View>
          {formErrors.date ? <Text style={styles.err}>{formErrors.date}</Text> : null}
          <Text style={styles.small}>Avant {dash.dayStartHour} h du matin, la séance compte pour la journée précédente.</Text>
          <Text style={styles.fieldLabel}>Note (facultatif)</Text>
          <Field value={form.note} onChangeText={(v) => patch({ note: v })} placeholder="ex. séries de 8" accessibilityLabel="Note" />
          {formErrors.note ? <Text style={styles.err}>{formErrors.note}</Text> : null}
          {formErrors.activity ? <Text style={styles.err}>{formErrors.activity}</Text> : null}
          <View style={styles.actions}>
            <View style={styles.actionCell}>
              <Button label={editing ? 'Enregistrer la correction' : 'Enregistrer la séance'} onPress={() => void submit()} disabled={busy} />
            </View>
            <View style={styles.actionCell}>
              <Button label="Fermer" variant="ghost" onPress={closeForm} disabled={busy} />
            </View>
          </View>
        </FantasyPanel>
      ) : null}

      <FantasyPanel>
        <Text style={styles.panelTitle}>Dernières séances · {def.label}</Text>
        <View style={styles.chips}>
          {week
            .slice()
            .reverse()
            .map((d) => (
              <View key={d.localDate} style={styles.dayChip}>
                <Text style={styles.dayChipDate}>{shortDate(d.localDate)}</Text>
                <Text style={styles.dayChipValue}>
                  {d.agg.count === 0 ? '—' : `${d.agg.count}× ${d.agg.totalReps != null ? d.agg.totalReps : d.agg.totalDurationSec != null ? formatDuration(d.agg.totalDurationSec) : formatDistance(d.agg.totalDistanceM ?? 0)}`}
                </Text>
              </View>
            ))}
        </View>
        <Text style={styles.small}>« — » = aucune séance enregistrée ce jour-là (≠ une séance à zéro).</Text>
        {trendText ? <Text style={styles.small}>{trendText}</Text> : null}
        {current.recent.length === 0 ? <Body muted>Aucune séance enregistrée pour cette activité.</Body> : null}
        {current.recent.map((s) => (
          <View key={s.id} style={styles.entry}>
            <Text style={styles.entryTitle}>
              {formatWhen(s.performedAt, tz)}
              {s.disciplineName ? ` · ${s.disciplineName}` : ''} · {sessionLine(s)}
            </Text>
            <Text style={styles.small}>
              {outcomeLabel(s)}
              {s.note ? ` · ${s.note}` : ''}
              {s.corrections > 0 ? ` · corrigée ${s.corrections} fois` : ''}
            </Text>
            {cancelAsk === s.id ? (
              <View style={styles.row}>
                <Button label="Oui, annuler cette séance" variant="danger" compact onPress={() => void cancelEntry(s.id)} disabled={busy} />
                <Button label="Non" variant="ghost" compact onPress={() => setCancelAsk(null)} />
              </View>
            ) : (
              <View style={styles.row}>
                <Button label="Corriger" variant="secondary" compact onPress={() => openEdit(s)} disabled={busy} />
                <Button label="Annuler la séance" variant="ghost" compact onPress={() => setCancelAsk(s.id)} disabled={busy} />
              </View>
            )}
          </View>
        ))}
      </FantasyPanel>

      <CollapsibleSection title="Records personnels" hint="Meilleures performances, toutes activités">
        {dash.activities
          .filter((a) => a.activity.id !== 'free')
          .map((a) => {
            const lines = recordLines(a);
            return (
              <View key={a.activity.id} style={styles.recordBlock}>
                <Text style={styles.fieldLabel}>{a.activity.label}</Text>
                {lines.length === 0 ? <Body muted>Pas encore de record.</Body> : lines.map((l) => <Text key={l} style={styles.recordLine}>{l}</Text>)}
              </View>
            );
          })}
        <Text style={styles.small}>
          Un record est recalculé depuis tes séances valides (tentatives non atteintes comprises) : corriger ou annuler une séance le met à jour.
        </Text>
      </CollapsibleSection>

      <CollapsibleSection title="Objectifs suivis" hint="Objectifs actuels, historique, habitudes Sport">
        {dash.activities
          .filter((a) => a.activity.goalMetrics.length > 0)
          .map((a) => (
            <Text key={a.activity.id} style={styles.recordLine}>
              {a.activity.label} : {a.goal ? goalFmt(a.goal) : 'aucun objectif'}
              {a.goal?.source === 'suggestion' ? ' (suggestion acceptée)' : a.goal?.source === 'habit' ? ' (repris d\'une habitude)' : ''}
            </Text>
          ))}
        {history.length > 0 ? (
          <>
            <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>Historique · {def.label}</Text>
            {history
              .slice()
              .reverse()
              .map((h) => (
                <Text key={h.id} style={styles.small}>
                  {shortDate(h.effectiveFrom)} · {h.targetValue != null ? metricText(h.metric, h.targetValue) : 'objectif retiré'}
                  {h.reason ? ` — ${h.reason}` : ''}
                </Text>
              ))}
          </>
        ) : null}
        {dash.habitLinks.some((l) => l.match) ? (
          <>
            <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>Tes habitudes Sport</Text>
            {dash.habitLinks
              .filter((l) => l.match)
              .map((l) => (
                <View key={l.goalId} style={styles.habitRow}>
                  <Text style={styles.small}>
                    « {l.title} » → {SPORT_ACTIVITY_BY_ID[l.match!.activityId].label} ({metricText(l.match!.metric, l.match!.target)})
                    {l.adopted ? ' · suivi dans le journal' : ''}
                  </Text>
                  {l.ambiguous ? (
                    <Text style={styles.small}>Plusieurs habitudes pour cette activité : pas de rattachement automatique.</Text>
                  ) : !l.adopted ? (
                    <Button label="Suivre dans le journal" variant="secondary" compact onPress={() => void adopt(l.goalId)} disabled={busy} />
                  ) : null}
                </View>
              ))}
          </>
        ) : null}
        <Body muted>
          Les habitudes créées dans Paramètres restent dans « Mes habitudes » ci-dessous : leur suivi historique (XP) est inchangé.
        </Body>
      </CollapsibleSection>

      <CollapsibleSection title="À savoir" hint="Journal sportif, récompenses">
        <Body>
          Ce journal enregistre tes efforts réels : une tentative non atteinte est conservée et comptée, jamais transformée en réussite.
          Aucun jour de repos imposé, aucune pénalité pour un jour sans sport.
        </Body>
        <Body muted>
          Le journal ne donne ni XP ni or pour l'instant : tes séances réussies sont conservées pour de futures quêtes. Le suivi
          historique « Sport ou mouvement » et les défis chronométrés restent séparés.
        </Body>
      </CollapsibleSection>
    </View>
  );
}

const styles = StyleSheet.create({
  kicker: { ...typography.label, color: colors.muted, textAlign: 'center' },
  big: { ...typography.title, color: colors.goldBright, textAlign: 'center', marginVertical: spacing.xs },
  statsRow: { flexDirection: 'row', marginTop: spacing.sm },
  statCell: { flex: 1, alignItems: 'center', paddingHorizontal: 2 },
  statLabel: { ...typography.caption, color: colors.muted, textAlign: 'center' },
  statValue: { ...typography.subtitle, color: colors.gold, textAlign: 'center' },
  goalLine: { ...typography.body, color: colors.ink, marginTop: spacing.md },
  rowTop: { marginTop: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm, gap: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.xs },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  actionCell: { flex: 1 },
  msg: { ...typography.body, color: colors.ember, marginTop: spacing.sm },
  err: { ...typography.caption, color: colors.danger, marginTop: 2 },
  small: { ...typography.caption, color: colors.muted, marginTop: 4 },
  panelTitle: { ...typography.subtitle, color: colors.gold, marginBottom: spacing.xs },
  fieldLabel: { ...typography.caption, color: colors.ink, marginTop: spacing.sm },
  entry: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.cardHighlight,
  },
  entryTitle: { ...typography.body, color: colors.ink },
  dayChip: {
    minWidth: 62,
    marginRight: spacing.xs,
    marginBottom: spacing.xs,
    padding: spacing.xs,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
  },
  dayChipDate: { ...typography.caption, color: colors.muted },
  dayChipValue: { ...typography.caption, color: colors.ink },
  suggestion: {
    marginTop: spacing.md,
    padding: spacing.sm,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.goldDim,
    backgroundColor: colors.cardHighlight,
  },
  suggestionText: { ...typography.body, color: colors.ink },
  recordBlock: { marginBottom: spacing.xs },
  recordLine: { ...typography.caption, color: colors.ink, marginTop: 4 },
  habitRow: { marginTop: spacing.xs },
});
