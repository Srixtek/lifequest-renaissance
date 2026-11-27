import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Body, Button, Chip, Field } from './ui';
import { colors, spacing, typography } from './theme';
import { FantasyPanel } from './FantasyPanel';
import { ProgressBar } from './ProgressBar';
import { CollapsibleSection } from './CollapsibleSection';
import { getDb } from '../data/db/client';
import { HELP_LINES } from '../data/content/helpLines';
import type { AlcoholConsumption } from '../data/db/repositories/alcoholRepo';
import {
  ALCOHOL_PRESETS,
  ALCOHOL_TYPE_LABEL,
  computeAlcoholMg,
  formatClockInput,
  formatDrinks,
  formatDrinksLabel,
  formatElapsedSince,
  formatGrams,
  parseWeeklyGoalDrinks,
  scaledToText,
  validateDrinkForm,
  wallClockToInstant,
  type AlcoholDrinkType,
  type DrinkFormInput,
} from '../domain/rules/alcohol';
import {
  acceptGoalSuggestion,
  addConsumption,
  cancelConsumption,
  confirmStartMarker,
  declareZeroDay,
  dismissGoalSuggestion,
  editConsumption,
  getAlcoholDashboard,
  listDayEntries,
  revokeZeroDayDeclaration,
  setWeeklyGoal,
  type AlcoholDashboard,
  type DayStatus,
  type DaySummary,
  type WeekSummary,
} from '../domain/services/alcoholTrackerService';
import { addDays } from '../domain/rules/dates';
import { createId } from '../utils/id';
import { friendlyDbError } from '../utils/dbErrors';

function formatWhen(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('fr-FR', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function shortDate(localDate: string): string {
  const [, m, d] = localDate.split('-');
  return `${d}/${m}`;
}

function dayLabel(d: DaySummary): string {
  if (d.status === 'drinks') return formatDrinksLabel(d.totalMg);
  if (d.status === 'zero_declared') return '0 déclaré';
  return 'Aucune donnée renseignée';
}

function statusText(status: DayStatus, totalMg: number): string {
  if (status === 'drinks') return formatDrinksLabel(totalMg);
  if (status === 'zero_declared') return '0 déclaré (aucune boisson)';
  return 'Aucune donnée renseignée';
}

interface FormState {
  type: AlcoholDrinkType;
  name: string;
  volumeMl: string;
  abvPct: string;
  quantity: string;
  date: string;
  time: string;
  note: string;
}

function emptyForm(type: AlcoholDrinkType, now: Date, timeZone?: string): FormState {
  const preset = ALCOHOL_PRESETS.find((p) => p.type === type)!;
  const clock = formatClockInput(now, timeZone);
  return {
    type,
    name: ALCOHOL_TYPE_LABEL[type] === 'Autre' ? '' : ALCOHOL_TYPE_LABEL[type],
    volumeMl: preset.volumeMl ?? '',
    abvPct: preset.abvPct ?? '',
    quantity: '1',
    date: clock.date,
    time: clock.time,
    note: '',
  };
}

function formFromConsumption(c: AlcoholConsumption, timeZone?: string): FormState {
  const clock = formatClockInput(new Date(c.consumedAt), timeZone);
  return {
    type: c.drinkType,
    name: c.name ?? '',
    volumeMl: scaledToText(c.volumeMlX10, 1),
    abvPct: scaledToText(c.abvX10, 1),
    quantity: scaledToText(c.quantityX100, 2),
    date: clock.date,
    time: clock.time,
    note: c.note ?? '',
  };
}

const TIME_SHIFTS: Array<{ label: string; minutes: number }> = [
  { label: 'Maintenant', minutes: 0 },
  { label: 'Il y a 30 min', minutes: 30 },
  { label: 'Il y a 1 h', minutes: 60 },
  { label: 'Il y a 2 h', minutes: 120 },
  { label: 'Hier même heure', minutes: 1440 },
];

const ERROR_TEXT: Record<string, string> = {
  invalid_drink: 'Valeurs de boisson invalides.',
  invalid_time: 'Date ou heure invalide (format AAAA-MM-JJ et HH:MM).',
  future_time: 'Cette heure est dans le futur.',
  not_found: 'Cette saisie n\'existe plus.',
  cancelled: 'Cette saisie est déjà annulée.',
};

export function AlcoholTracker() {
  const [dash, setDash] = useState<AlcoholDashboard | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [entries, setEntries] = useState<AlcoholConsumption[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [requestId, setRequestId] = useState(() => createId('areq'));
  const [cancelAsk, setCancelAsk] = useState<string | null>(null);
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [goalDraft, setGoalDraft] = useState('');
  const lock = useRef(false);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedDate;

  const reload = useCallback(async () => {
    try {
      const db = await getDb();
      const d = await getAlcoholDashboard(db);
      setDash(d);
      setEntries(await listDayEntries(db, selectedRef.current ?? d.today, true));
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

  useEffect(() => {
    void reload();
  }, [selectedDate, reload]);

  const hasSince = dash?.since != null;
  useEffect(() => {
    if (!hasSince) return;
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [hasSince]);

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

  const openAdd = (type: AlcoholDrinkType = 'beer') => {
    setEditingId(null);
    setForm(emptyForm(type, new Date(), tz));
    setFormErrors({});
    setRequestId(createId('areq'));
    setFormOpen(true);
  };

  const openEdit = (c: AlcoholConsumption) => {
    setEditingId(c.id);
    setForm(formFromConsumption(c, tz));
    setFormErrors({});
    setFormOpen(true);
    setCancelAsk(null);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setForm(null);
    setFormErrors({});
  };

  const patch = (p: Partial<FormState>) => setForm((f) => (f ? { ...f, ...p } : f));

  const choosePreset = (type: AlcoholDrinkType) => {
    const preset = ALCOHOL_PRESETS.find((p) => p.type === type)!;
    patch({
      type,
      name: type === 'other' ? '' : ALCOHOL_TYPE_LABEL[type],
      volumeMl: preset.volumeMl ?? '',
      abvPct: preset.abvPct ?? '',
    });
  };

  const shiftTime = (minutes: number) => {
    const clock = formatClockInput(new Date(Date.now() - minutes * 60_000), tz);
    patch({ date: clock.date, time: clock.time });
  };

  const validated = useMemo(() => {
    if (!form) return null;
    const input: DrinkFormInput = {
      type: form.type,
      name: form.name,
      volumeMl: form.volumeMl,
      abvPct: form.abvPct,
      quantity: form.quantity,
      note: form.note,
    };
    return validateDrinkForm(input);
  }, [form]);

  const preview = validated?.ok ? computeAlcoholMg(validated.value) : null;

  const submit = () =>
    run(async () => {
      if (!form || !validated) return;
      if (!validated.ok) {
        setFormErrors(validated.errors as Record<string, string>);
        return;
      }
      const consumedAt = wallClockToInstant(form.date, form.time, tz);
      if (!consumedAt) {
        setFormErrors({ date: ERROR_TEXT.invalid_time });
        return;
      }
      const db = await getDb();
      if (editingId) {
        const r = await editConsumption(db, editingId, { drink: validated.value, consumedAt });
        if (!r.ok) {
          setFormErrors({ date: ERROR_TEXT[r.code] ?? 'Correction impossible.' });
          return;
        }
        setMsg(
          r.changed
            ? `Correction enregistrée : ${formatDrinksLabel(r.consumption.alcoholMg)}. Les totaux sont recalculés ; l'ancienne valeur est conservée.`
            : 'Aucun changement.',
        );
      } else {
        const r = await addConsumption(db, { drink: validated.value, consumedAt, clientRequestId: requestId });
        if (!r.ok) {
          setFormErrors({ date: ERROR_TEXT[r.code] ?? 'Enregistrement impossible.' });
          return;
        }
        setMsg(
          r.duplicate
            ? 'Déjà enregistrée : rien n\'a été ajouté une seconde fois.'
            : `Ajouté : ${formatDrinksLabel(r.consumption.alcoholMg)} (${formatGrams(r.consumption.alcoholMg)} d'alcool pur).` +
                (r.revokedZeroDay ? ' La déclaration « aucune boisson » de ce jour a été retirée.' : ''),
        );
        setRequestId(createId('areq'));
      }
      closeForm();
    });

  const cancelEntry = (id: string) =>
    run(async () => {
      const db = await getDb();
      const r = await cancelConsumption(db, id);
      setCancelAsk(null);
      setMsg(
        r.ok
          ? 'Saisie annulée. Elle n\'est plus comptée, mais reste dans l\'historique des corrections.'
          : (ERROR_TEXT[r.code === 'already_cancelled' ? 'cancelled' : 'not_found']),
      );
    });

  const declareZero = (localDate: string) =>
    run(async () => {
      const db = await getDb();
      const r = await declareZeroDay(db, localDate);
      setMsg(
        r.ok
          ? `Noté : aucune boisson le ${shortDate(localDate)}. C'est ta déclaration, pas une vérification.`
          : r.code === 'has_consumption'
            ? 'Des boissons sont enregistrées ce jour-là : corrige ou annule-les d\'abord.'
            : 'Date impossible.',
      );
    });

  const undoZero = (localDate: string) =>
    run(async () => {
      const db = await getDb();
      await revokeZeroDayDeclaration(db, localDate);
      setMsg('Déclaration « aucune boisson » retirée : le jour redevient « aucune donnée renseignée ».');
    });

  const confirmStart = () =>
    run(async () => {
      const when = wallClockToInstant(startDate || formatClockInput(new Date(), tz).date, startTime || formatClockInput(new Date(), tz).time, tz);
      if (!when) {
        setMsg(ERROR_TEXT.invalid_time);
        return;
      }
      const db = await getDb();
      const r = await confirmStartMarker(db, when);
      setMsg(
        r.ok
          ? 'Départ confirmé. Le chrono compte depuis cette heure, d\'après ta déclaration.'
          : r.code === 'before_last_drink'
            ? 'Une boisson est enregistrée après cette heure : le chrono repart déjà de cette boisson.'
            : ERROR_TEXT[r.code],
      );
    });

  const saveGoal = (raw: string) =>
    run(async () => {
      const p = parseWeeklyGoalDrinks(raw);
      if (!p.ok) {
        setMsg(p.error);
        return;
      }
      const db = await getDb();
      const r = await setWeeklyGoal(db, p.mg);
      setGoalDraft('');
      setMsg(
        r.ok
          ? r.changed
            ? `Objectif enregistré : ${formatDrinksLabel(p.mg)} par semaine, à partir de la semaine du ${shortDate(r.effectiveFrom)}. Les semaines passées gardent leur objectif d'alors.`
            : 'Objectif inchangé.'
          : 'Objectif invalide.',
      );
    });

  const acceptSuggestion = () =>
    run(async () => {
      if (!dash?.suggestion) return;
      const db = await getDb();
      const r = await acceptGoalSuggestion(db, dash.suggestion.proposedMg);
      setMsg(r.ok ? 'Nouvel objectif enregistré. Tu peux le modifier à tout moment.' : 'Cette suggestion a changé : vérifie-la puis réessaie.');
    });

  const dismissSuggestion = () =>
    run(async () => {
      const db = await getDb();
      await dismissGoalSuggestion(db);
      setMsg('Suggestion ignorée : ton objectif ne change pas. Elle ne reviendra pas avant quelques semaines.');
    });

  if (!dash) {
    return (
      <FantasyPanel accent>
        <Body muted>Chargement du suivi alcool…</Body>
      </FantasyPanel>
    );
  }

  const shownDate = selectedDate ?? dash.today;
  const isToday = shownDate === dash.today;
  const goalMg = dash.goal?.targetMg ?? null;
  const progress = goalMg != null && goalMg > 0 ? Math.min(1, dash.weekMg / goalMg) : goalMg === 0 && dash.weekMg === 0 ? 0 : 1;
  const sinceElapsed = dash.since
    ? dash.since.clockAnomaly
      ? 0
      : Math.max(0, Math.floor((nowMs - Date.parse(dash.since.sinceIso)) / 1000))
    : 0;
  const shownDay = dash.last7Days.find((d) => d.localDate === shownDate);
  const activeEntries = entries.filter((c) => c.status === 'active');

  return (
    <View>
      <FantasyPanel accent>
        <Text style={styles.kicker}>Aujourd'hui</Text>
        <Text style={styles.big} accessibilityLabel={`Aujourd'hui : ${statusText(dash.todayStatus, dash.todayMg)}`}>
          {dash.todayStatus === 'drinks' ? formatDrinksLabel(dash.todayMg) : dash.todayStatus === 'zero_declared' ? '0 déclaré' : 'Aucune donnée'}
        </Text>
        {dash.todayStatus === 'no_data' ? (
          <Body muted>Rien n'est enregistré aujourd'hui. Ce n'est pas un zéro tant que tu ne l'as pas déclaré.</Body>
        ) : null}

        <View style={styles.statsRow}>
          <View style={styles.statCell}>
            <Text style={styles.statLabel}>7 derniers jours</Text>
            <Text style={styles.statValue}>{formatDrinks(dash.last7Mg)}</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statLabel}>Semaine en cours</Text>
            <Text style={styles.statValue}>{formatDrinks(dash.weekMg)}</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statLabel}>Objectif / sem.</Text>
            <Text style={styles.statValue}>{goalMg != null ? formatDrinks(goalMg) : '—'}</Text>
          </View>
        </View>
        <Text style={styles.small}>
          Verres standard (10 g d'alcool pur). Semaine du {shortDate(dash.weekStart)} au {shortDate(dash.weekEnd)} ·{' '}
          {dash.week.documentedDays}/{dash.week.elapsedDays} jour(s) renseigné(s).
        </Text>
        {goalMg != null ? (
          <ProgressBar
            progress={progress}
            label={
              dash.weekMg <= goalMg
                ? `${formatDrinks(dash.weekMg)} sur ${formatDrinks(goalMg)} — reste ${formatDrinks(goalMg - dash.weekMg)}`
                : `${formatDrinks(dash.weekMg)} sur ${formatDrinks(goalMg)} — au-dessus de l'objectif (information, pas un échec)`
            }
          />
        ) : (
          <Body muted>Pas d'objectif hebdomadaire pour l'instant : tu peux en fixer un plus bas.</Body>
        )}

        <View style={styles.sinceBox}>
          {dash.since ? (
            <>
              <Text style={styles.kicker}>
                {dash.since.kind === 'last_drink' ? 'Depuis la dernière boisson enregistrée' : 'Depuis le départ que tu as confirmé'}
              </Text>
              <Text style={styles.since} accessibilityLabel={`Temps écoulé : ${formatElapsedSince(sinceElapsed)}`}>
                {formatElapsedSince(sinceElapsed)}
              </Text>
              <Text style={styles.small}>
                {formatWhen(dash.since.sinceIso, tz)} · d'après tes saisies : une absence de saisie ne prouve pas une absence de
                consommation.
              </Text>
              {dash.since.clockAnomaly ? (
                <Text style={styles.warn}>L'horloge du téléphone est antérieure à cette heure : vérifie la date de ton téléphone.</Text>
              ) : null}
            </>
          ) : (
            <>
              <Text style={styles.kicker}>Chrono sans alcool</Text>
              <Body muted>
                Aucune boisson enregistrée : on ne suppose rien sur ton passé. Si tu veux un chrono, confirme toi-même la date et
                l'heure de départ.
              </Body>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Field
                    value={startDate || formatClockInput(new Date(nowMs), tz).date}
                    onChangeText={setStartDate}
                    placeholder="AAAA-MM-JJ"
                    accessibilityLabel="Date de départ"
                  />
                </View>
                <View style={{ width: 96, marginLeft: spacing.xs }}>
                  <Field
                    value={startTime || formatClockInput(new Date(nowMs), tz).time}
                    onChangeText={setStartTime}
                    placeholder="HH:MM"
                    accessibilityLabel="Heure de départ"
                  />
                </View>
              </View>
              <Button label="Confirmer ce départ" variant="secondary" onPress={() => void confirmStart()} disabled={busy} />
            </>
          )}
        </View>

        <View style={styles.rowTop}>
          <Button label="Ajouter une boisson" onPress={() => openAdd()} disabled={busy} />
        </View>
        {dash.todayStatus === 'no_data' ? (
          <View style={styles.rowTop}>
            <Button label="Aucune boisson aujourd'hui" variant="secondary" onPress={() => void declareZero(dash.today)} disabled={busy} />
          </View>
        ) : null}
        {dash.todayStatus === 'zero_declared' ? (
          <View style={styles.rowTop}>
            <Button label="Retirer « aucune boisson aujourd'hui »" variant="ghost" compact onPress={() => void undoZero(dash.today)} disabled={busy} />
          </View>
        ) : null}
        {msg ? <Text style={styles.msg}>{msg}</Text> : null}
      </FantasyPanel>

      {formOpen && form ? (
        <FantasyPanel>
          <Text style={styles.panelTitle}>{editingId ? 'Corriger la saisie' : 'Ajouter une boisson'}</Text>
          <View style={styles.chips}>
            {ALCOHOL_PRESETS.map((p) => (
              <Chip key={p.type} label={p.label} selected={form.type === p.type} onPress={() => choosePreset(p.type)} />
            ))}
          </View>
          {form.type === 'other' && !editingId ? (
            <Body muted>« Autre » : indique toi-même le volume et le degré, rien n'est supposé.</Body>
          ) : (
            <Body muted>Valeurs modifiables : adapte-les à ce que tu as vraiment bu.</Body>
          )}
          <Text style={styles.fieldLabel}>Nom (facultatif)</Text>
          <Field value={form.name} onChangeText={(v) => patch({ name: v })} placeholder="ex. IPA, Bordeaux…" accessibilityLabel="Nom de la boisson" />
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>Volume (ml)</Text>
              <Field value={form.volumeMl} onChangeText={(v) => patch({ volumeMl: v })} keyboardType="decimal-pad" accessibilityLabel="Volume en millilitres" />
              {formErrors.volumeMl ? <Text style={styles.err}>{formErrors.volumeMl}</Text> : null}
            </View>
            <View style={{ flex: 1, marginLeft: spacing.xs }}>
              <Text style={styles.fieldLabel}>Degré (% vol)</Text>
              <Field value={form.abvPct} onChangeText={(v) => patch({ abvPct: v })} keyboardType="decimal-pad" accessibilityLabel="Degré d'alcool" />
              {formErrors.abvPct ? <Text style={styles.err}>{formErrors.abvPct}</Text> : null}
            </View>
            <View style={{ flex: 1, marginLeft: spacing.xs }}>
              <Text style={styles.fieldLabel}>Nombre</Text>
              <Field value={form.quantity} onChangeText={(v) => patch({ quantity: v })} keyboardType="decimal-pad" accessibilityLabel="Nombre de consommations identiques" />
              {formErrors.quantity ? <Text style={styles.err}>{formErrors.quantity}</Text> : null}
            </View>
          </View>
          <Text style={styles.fieldLabel}>Date et heure</Text>
          <View style={styles.chips}>
            {TIME_SHIFTS.map((s) => (
              <Chip key={s.label} label={s.label} onPress={() => shiftTime(s.minutes)} />
            ))}
          </View>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Field value={form.date} onChangeText={(v) => patch({ date: v })} placeholder="AAAA-MM-JJ" accessibilityLabel="Date de la boisson" />
            </View>
            <View style={{ width: 96, marginLeft: spacing.xs }}>
              <Field value={form.time} onChangeText={(v) => patch({ time: v })} placeholder="HH:MM" accessibilityLabel="Heure de la boisson" />
            </View>
          </View>
          {formErrors.date ? <Text style={styles.err}>{formErrors.date}</Text> : null}
          <Text style={styles.small}>
            Avant {dash.dayStartHour} h du matin, la boisson compte pour la journée précédente.
          </Text>
          <Text style={styles.fieldLabel}>Note (facultatif)</Text>
          <Field value={form.note} onChangeText={(v) => patch({ note: v })} placeholder="ex. repas de famille" accessibilityLabel="Note" />
          <Text style={styles.preview} accessibilityLiveRegion="polite">
            {preview != null
              ? `= ${formatDrinksLabel(preview)} · ${formatGrams(preview)} d'alcool pur`
              : 'Remplis volume, degré et nombre pour voir le calcul.'}
          </Text>
          <View style={styles.actions}>
            <View style={styles.actionCell}>
              <Button label={editingId ? 'Enregistrer la correction' : 'Enregistrer la boisson'} onPress={() => void submit()} disabled={busy} />
            </View>
            <View style={styles.actionCell}>
              <Button label="Fermer" variant="ghost" onPress={closeForm} disabled={busy} />
            </View>
          </View>
        </FantasyPanel>
      ) : null}

      <FantasyPanel>
        <Text style={styles.panelTitle}>Historique récent</Text>
        <View style={styles.chips}>
          {dash.last7Days
            .slice()
            .reverse()
            .map((d) => (
              <Chip
                key={d.localDate}
                label={`${shortDate(d.localDate)} · ${d.status === 'drinks' ? formatDrinks(d.totalMg) : d.status === 'zero_declared' ? '0' : '?'}`}
                selected={d.localDate === shownDate}
                onPress={() => setSelectedDate(d.localDate === dash.today ? null : d.localDate)}
              />
            ))}
        </View>
        <Text style={styles.small}>« ? » = aucune donnée renseignée (≠ 0). « 0 » = aucune boisson déclarée.</Text>
        <View style={styles.dayNav}>
          <Button label="←" variant="secondary" compact onPress={() => setSelectedDate(addDays(shownDate, -1))} disabled={busy} />
          <Text style={styles.dayTitle}>
            {isToday ? 'Aujourd\'hui' : shownDate} {shownDay ? `· ${dayLabel(shownDay)}` : ''}
          </Text>
          <Button
            label="→"
            variant="secondary"
            compact
            onPress={() => {
              const next = addDays(shownDate, 1);
              setSelectedDate(next >= dash.today ? null : next);
            }}
            disabled={busy || isToday}
          />
        </View>
        {entries.length === 0 ? <Body muted>Aucune boisson enregistrée ce jour-là.</Body> : null}
        {entries.map((c) => (
          <View key={c.id} style={[styles.entry, c.status === 'cancelled' && styles.entryCancelled]}>
            <Text style={[styles.entryTitle, c.status === 'cancelled' && styles.struck]}>
              {formatWhen(c.consumedAt, tz)} · {c.name || ALCOHOL_TYPE_LABEL[c.drinkType]} · {formatDrinksLabel(c.alcoholMg)}
            </Text>
            <Text style={styles.small}>
              {c.quantityX100 === 100 ? '1 ×' : `${scaledToText(c.quantityX100, 2)} ×`} {scaledToText(c.volumeMlX10, 1)} ml à {scaledToText(c.abvX10, 1)} %
              {c.note ? ` · ${c.note}` : ''}
              {c.corrections > 0 ? ` · corrigée ${c.corrections} fois` : ''}
              {c.status === 'cancelled' ? ' · annulée (conservée dans l\'historique)' : ''}
            </Text>
            {c.status === 'active' ? (
              cancelAsk === c.id ? (
                <View style={styles.row}>
                  <Button label="Oui, annuler cette saisie" variant="danger" compact onPress={() => void cancelEntry(c.id)} disabled={busy} />
                  <Button label="Non" variant="ghost" compact onPress={() => setCancelAsk(null)} />
                </View>
              ) : (
                <View style={styles.row}>
                  <Button label="Corriger" variant="secondary" compact onPress={() => openEdit(c)} disabled={busy} />
                  <Button label="Annuler la saisie" variant="ghost" compact onPress={() => setCancelAsk(c.id)} disabled={busy} />
                </View>
              )
            ) : null}
          </View>
        ))}
        {activeEntries.length === 0 && shownDay?.status === 'no_data' && !isToday ? (
          <View style={styles.rowTop}>
            <Button label="Aucune boisson ce jour-là" variant="secondary" compact onPress={() => void declareZero(shownDate)} disabled={busy} />
          </View>
        ) : null}
        {shownDay?.status === 'zero_declared' && !isToday ? (
          <View style={styles.rowTop}>
            <Button label="Retirer « aucune boisson »" variant="ghost" compact onPress={() => void undoZero(shownDate)} disabled={busy} />
          </View>
        ) : null}
      </FantasyPanel>

      <CollapsibleSection title="Objectif et semaines" hint="Objectif hebdomadaire, comparaison entre semaines">
        <GoalSection
          dash={dash}
          goalDraft={goalDraft}
          setGoalDraft={setGoalDraft}
          busy={busy}
          onSave={() => void saveGoal(goalDraft)}
          onAccept={() => void acceptSuggestion()}
          onDismiss={() => void dismissSuggestion()}
          onAdjust={() => setGoalDraft(dash.suggestion ? formatDrinks(dash.suggestion.proposedMg) : '')}
        />
      </CollapsibleSection>

      <CollapsibleSection title="Repères santé" hint="À savoir, en toute discrétion">
        <Body>
          Si tu bois régulièrement et beaucoup, arrêter brutalement peut être dangereux (sevrage). Parle-en à un médecin ou à un
          professionnel de santé avant de changer fortement. {HELP_LINES[1].name} : {HELP_LINES[1].phone} ({HELP_LINES[1].hours}, anonyme). En cas de convulsions ou de confusion : {HELP_LINES[2].phone}.
        </Body>
        <Body muted>
          Ce suivi est un simple outil : il ne pose aucun diagnostic et ne prescrit rien. Aucune récompense n'est liée aux
          boissons enregistrées.
        </Body>
        {dash.legacyGoalActive ? (
          <Body muted>
            Ton ancien suivi « verres déclarés » reste disponible plus bas, séparément : ses valeurs ne sont pas des unités
            standard calculées et ne sont pas ajoutées à ce journal.
          </Body>
        ) : null}
      </CollapsibleSection>
    </View>
  );
}

function weekLine(w: WeekSummary): string {
  const label = `Sem. du ${shortDate(w.weekStart)}`;
  if (w.documentedDays === 0) return `${label} : aucune donnée renseignée`;
  const goal =
    w.vsGoal === 'within'
      ? ' · dans l\'objectif'
      : w.vsGoal === 'over'
        ? ' · au-dessus de l\'objectif'
        : '';
  const lowerBound = w.documentedDays < Math.max(w.elapsedDays, 1) ? ' (au moins)' : '';
  return `${label} : ${formatDrinks(w.totalMg)} verres${lowerBound} · ${w.documentedDays}/${w.elapsedDays} j renseignés${goal}`;
}

function GoalSection(props: {
  dash: AlcoholDashboard;
  goalDraft: string;
  setGoalDraft: (v: string) => void;
  busy: boolean;
  onSave: () => void;
  onAccept: () => void;
  onDismiss: () => void;
  onAdjust: () => void;
}) {
  const { dash } = props;
  const cmp = dash.comparison;
  return (
    <View>
      <Text style={styles.fieldLabel}>
        Objectif actuel : {dash.goal ? `${formatDrinksLabel(dash.goal.targetMg)} par semaine` : 'aucun'}
      </Text>
      <Field
        value={props.goalDraft}
        onChangeText={props.setGoalDraft}
        keyboardType="decimal-pad"
        placeholder="Verres standard par semaine (ex. 10)"
        accessibilityLabel="Objectif hebdomadaire en verres standard"
      />
      <Button label="Enregistrer l'objectif" variant="secondary" onPress={props.onSave} disabled={props.busy} />
      <Body muted>
        Tu fixes ton propre objectif. Les semaines passées restent évaluées avec l'objectif qui était en vigueur.
      </Body>

      {dash.suggestion ? (
        <View style={styles.suggestion}>
          <Text style={styles.suggestionText}>{dash.suggestion.message}</Text>
          <View style={styles.row}>
            <Button label="Accepter" compact onPress={props.onAccept} disabled={props.busy} />
            <Button label="Modifier" variant="secondary" compact onPress={props.onAdjust} disabled={props.busy} />
            <Button label="Pas maintenant" variant="ghost" compact onPress={props.onDismiss} disabled={props.busy} />
          </View>
        </View>
      ) : null}

      <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>Semaines récentes</Text>
      {dash.weeks.slice(0, 4).map((w) => (
        <Text key={w.weekStart} style={styles.weekLine}>
          {weekLine(w)}
        </Text>
      ))}
      {cmp ? (
        <Text style={styles.small}>
          Entre les semaines du {shortDate(cmp.previousWeekStart)} et du {shortDate(cmp.latestWeekStart)} (bien renseignées) :{' '}
          {cmp.deltaMg === 0
            ? 'même total.'
            : `${cmp.deltaMg < 0 ? '−' : '+'}${formatDrinks(Math.abs(cmp.deltaMg))} verres.`}
        </Text>
      ) : (
        <Text style={styles.small}>La comparaison apparaît dès que deux semaines terminées sont bien renseignées (5 jours sur 7).</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  kicker: { ...typography.label, color: colors.muted, textAlign: 'center' },
  big: { ...typography.title, color: colors.goldBright, textAlign: 'center', marginVertical: spacing.xs },
  statsRow: { flexDirection: 'row', marginTop: spacing.sm },
  statCell: { flex: 1, alignItems: 'center' },
  statLabel: { ...typography.caption, color: colors.muted, textAlign: 'center' },
  statValue: { ...typography.subtitle, color: colors.gold },
  sinceBox: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  since: { ...typography.title, color: colors.ember, textAlign: 'center', marginVertical: spacing.xs },
  rowTop: { marginTop: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm, gap: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.xs },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  actionCell: { flex: 1 },
  msg: { ...typography.body, color: colors.ember, marginTop: spacing.sm },
  warn: { ...typography.caption, color: colors.warn, marginTop: spacing.sm },
  err: { ...typography.caption, color: colors.danger, marginTop: 2 },
  small: { ...typography.caption, color: colors.muted, marginTop: 4 },
  panelTitle: { ...typography.subtitle, color: colors.gold, marginBottom: spacing.xs },
  fieldLabel: { ...typography.caption, color: colors.ink, marginTop: spacing.sm },
  preview: { ...typography.subtitle, color: colors.goldBright, marginTop: spacing.md },
  dayNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md },
  dayTitle: { ...typography.caption, color: colors.ink, flex: 1, textAlign: 'center', marginHorizontal: spacing.xs },
  entry: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.cardHighlight,
  },
  entryCancelled: { opacity: 0.6 },
  entryTitle: { ...typography.body, color: colors.ink },
  struck: { textDecorationLine: 'line-through' },
  suggestion: {
    marginTop: spacing.md,
    padding: spacing.sm,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.goldDim,
    backgroundColor: colors.cardHighlight,
  },
  suggestionText: { ...typography.body, color: colors.ink },
  weekLine: { ...typography.caption, color: colors.ink, marginTop: 4 },
});
