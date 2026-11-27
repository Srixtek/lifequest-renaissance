import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Body, Button, Chip, Field } from './ui';
import { colors, spacing, typography } from './theme';
import { FantasyPanel } from './FantasyPanel';
import { ProgressBar } from './ProgressBar';
import { CollapsibleSection } from './CollapsibleSection';
import { getDb } from '../data/db/client';
import type { ProchesCall, ProchesContact } from '../data/db/repositories/prochesRepo';
import { formatClockInput, wallClockToInstant } from '../domain/rules/alcohol';
import {
  PROCHES_RELATION_LABEL,
  parseContactName,
  parseWeeklyCallTarget,
  type ProchesRelation,
} from '../domain/rules/proches';
import {
  addCall,
  addContact,
  addContactAndCall,
  archiveContact,
  cancelCall,
  editCall,
  getProchesDashboard,
  listContacts,
  listDayCalls,
  setWeeklyCallGoal,
  updateContactName,
  type ProchesDashboard,
} from '../domain/services/prochesTrackerService';
import { addDays } from '../domain/rules/dates';
import { createId } from '../utils/id';
import { friendlyDbError } from '../utils/dbErrors';

function formatWhen(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('fr-FR', { timeZone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function shortDate(localDate: string): string {
  const [, m, d] = localDate.split('-');
  return `${d}/${m}`;
}

const TIME_SHIFTS: Array<{ label: string; minutes: number }> = [
  { label: 'Maintenant', minutes: 0 },
  { label: 'Il y a 30 min', minutes: 30 },
  { label: 'Il y a 1 h', minutes: 60 },
  { label: 'Hier même heure', minutes: 1440 },
];

const ERROR_TEXT: Record<string, string> = {
  invalid_time: 'Date ou heure invalide (format AAAA-MM-JJ et HH:MM).',
  future_time: 'Cette heure est dans le futur.',
  not_found: 'Cette entrée n\'existe plus.',
  cancelled: 'Cette entrée est déjà annulée.',
  invalid_name: 'Indique un nom ou un surnom.',
  invalid_goal: 'Objectif invalide : choisis entre 1 et 7 appels.',
};

interface CallFormState {
  contactId: string;
  date: string;
  time: string;
  note: string;
  quickName: string;
  quickRelation: ProchesRelation | '';
}

export function ProchesTracker() {
  const [dash, setDash] = useState<ProchesDashboard | null>(null);
  const [contacts, setContacts] = useState<ProchesContact[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [entries, setEntries] = useState<ProchesCall[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CallFormState | null>(null);
  const [requestId, setRequestId] = useState(() => createId('preq'));
  const [cancelAsk, setCancelAsk] = useState<string | null>(null);
  const [goalDraft, setGoalDraft] = useState('');
  const [newContactOpen, setNewContactOpen] = useState(false);
  const [newContactName, setNewContactName] = useState('');
  const [newContactRelation, setNewContactRelation] = useState<ProchesRelation | ''>('');
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const lock = useRef(false);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedDate;

  const reload = useCallback(async () => {
    try {
      const db = await getDb();
      const d = await getProchesDashboard(db);
      setDash(d);
      setContacts(await listContacts(db, true));
      setEntries(await listDayCalls(db, selectedRef.current ?? d.today, true));
      if (d.weekTarget != null) setGoalDraft(String(d.weekTarget));
    } catch (err) {
      setMsg(friendlyDbError(err));
    }
  }, []);

  useFocusEffect(useCallback(() => { void reload(); }, [reload]));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void reload(); });
    return () => sub.remove();
  }, [reload]);
  useEffect(() => { void reload(); }, [selectedDate, reload]);

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
    }
  };

  const tz = dash?.timeZone;

  const openAdd = () => {
    const now = new Date();
    const clock = formatClockInput(now, tz);
    setEditingId(null);
    setForm({
      contactId: '',
      date: clock.date,
      time: clock.time,
      note: '',
      quickName: '',
      quickRelation: '',
    });
    setRequestId(createId('preq'));
    setFormOpen(true);
    setMsg(null);
  };

  const openEdit = (c: ProchesCall) => {
    const clock = formatClockInput(new Date(c.calledAt), tz);
    setEditingId(c.id);
    setForm({ contactId: c.contactId, date: clock.date, time: clock.time, note: c.note ?? '', quickName: '', quickRelation: '' });
    setFormOpen(true);
    setMsg(null);
  };

  const closeForm = () => {
    setFormOpen(false);
    setForm(null);
    setEditingId(null);
  };

  const patch = (p: Partial<CallFormState>) => setForm((f) => (f ? { ...f, ...p } : f));

  const shiftTime = (minutes: number) => {
    if (!form) return;
    const d = new Date();
    d.setMinutes(d.getMinutes() - minutes);
    const clock = formatClockInput(d, tz);
    patch({ date: clock.date, time: clock.time });
  };

  const submitCall = () =>
    run(async () => {
      if (!form) return;
      const db = await getDb();
      const calledAt = wallClockToInstant(form.date, form.time, tz);
      if (!calledAt) {
        setMsg(ERROR_TEXT.invalid_time);
        return;
      }
      if (!editingId && !form.contactId && form.quickName.trim()) {
        const calledAt = wallClockToInstant(form.date, form.time, tz);
        if (!calledAt) {
          setMsg(ERROR_TEXT.invalid_time);
          return;
        }
        const r = await addContactAndCall(db, {
          name: form.quickName,
          relation: form.quickRelation || null,
          calledAt,
          note: form.note,
          clientRequestId: requestId,
        });
        if (!r.ok) {
          setMsg(ERROR_TEXT[r.code] ?? (r.code === 'invalid_name' ? 'Indique un nom ou un surnom.' : 'Enregistrement impossible.'));
          return;
        }
        setMsg(r.duplicate ? 'Cet appel était déjà enregistré (double clic ignoré).' : `Appel avec ${r.call.contactName} enregistré.`);
        setRequestId(createId('preq'));
        closeForm();
        await reload();
        return;
      }
      const contactId = form.contactId;
      if (!contactId) {
        setMsg(activeContacts.length === 0 ? 'Aucun proche : crée-en un via « création rapide » ou le répertoire.' : 'Choisis un proche dans la liste.');
        return;
      }
      if (editingId) {
        const r = await editCall(db, editingId, { calledAt, note: form.note });
        if (!r.ok) {
          setMsg(ERROR_TEXT[r.code] ?? 'Correction impossible.');
          return;
        }
        setMsg(r.changed ? 'Appel corrigé.' : 'Aucun changement.');
      } else {
        const r = await addCall(db, {
          contactId,
          calledAt,
          note: form.note,
          clientRequestId: requestId,
        });
        if (!r.ok) {
          setMsg(ERROR_TEXT[r.code] ?? 'Enregistrement impossible.');
          return;
        }
        setMsg(r.duplicate ? 'Cet appel était déjà enregistré (double clic ignoré).' : `Appel avec ${r.call.contactName} enregistré.`);
        setRequestId(createId('preq'));
      }
      closeForm();
      await reload();
    });

  const cancelEntry = (id: string) =>
    run(async () => {
      const db = await getDb();
      const r = await cancelCall(db, id);
      if (!r.ok) {
        setMsg(ERROR_TEXT[r.code] ?? 'Annulation impossible.');
        return;
      }
      setCancelAsk(null);
      setMsg('Appel retiré des statistiques (trace conservée).');
      await reload();
    });

  const saveGoal = () =>
    run(async () => {
      const p = parseWeeklyCallTarget(goalDraft);
      if (!p.ok) {
        setMsg(p.error);
        return;
      }
      const db = await getDb();
      const r = await setWeeklyCallGoal(db, p.value);
      if (!r.ok) {
        setMsg(ERROR_TEXT.invalid_goal);
        return;
      }
      setMsg(r.changed ? `Objectif : ${p.value} appel(s)/semaine à partir du ${shortDate(r.effectiveFrom)}.` : 'Objectif inchangé.');
      await reload();
    });

  const addNewContact = () =>
    run(async () => {
      const n = parseContactName(newContactName);
      if (!n.ok) {
        setMsg(n.error);
        return;
      }
      const db = await getDb();
      const r = await addContact(db, { name: n.value, relation: newContactRelation || null });
      if (!r.ok) {
        setMsg(ERROR_TEXT[r.code] ?? 'Ajout impossible.');
        return;
      }
      setNewContactName('');
      setNewContactRelation('');
      setNewContactOpen(false);
      setMsg(`${r.contact.name} ajouté au répertoire.`);
      await reload();
    });

  const doRename = (id: string) =>
    run(async () => {
      const db = await getDb();
      const r = await updateContactName(db, id, renameDraft);
      if (!r.ok) {
        setMsg(ERROR_TEXT[r.code] ?? 'Renommage impossible.');
        return;
      }
      setRenameId(null);
      setMsg('Nom mis à jour.');
      await reload();
    });

  const doArchive = (id: string) =>
    run(async () => {
      const db = await getDb();
      const r = await archiveContact(db, id);
      if (!r.ok) {
        setMsg(r.code === 'already_archived' ? 'Déjà archivé.' : 'Archivage impossible.');
        return;
      }
      setMsg('Proche archivé : les anciens appels restent visibles.');
      await reload();
    });

  const monthMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of dash?.monthDays ?? []) m.set(d.localDate, d.count);
    return m;
  }, [dash?.monthDays]);

  if (!dash) {
    return (
      <FantasyPanel accent>
        <Body muted>Chargement du suivi proches…</Body>
      </FantasyPanel>
    );
  }

  const shownDate = selectedDate ?? dash.today;
  const isToday = shownDate === dash.today;
  const goal = dash.weekTarget;
  const progress = goal != null && goal > 0 ? Math.min(1, dash.weekCallCount / goal) : 0;
  const activeContacts = contacts.filter((c) => c.status === 'active');
  const shownCount = entries.filter((e) => e.status === 'active').length;
  const delta =
    dash.previousWeekCallCount != null ? dash.weekCallCount - dash.previousWeekCallCount : null;

  return (
    <View>
      <FantasyPanel accent>
        <Text style={styles.kicker}>Semaine en cours</Text>
        <Text style={styles.big}>{dash.weekCallCount} appel{dash.weekCallCount > 1 ? 's' : ''}</Text>
        <Body muted>
          {dash.weekDistinctContacts} personne{dash.weekDistinctContacts > 1 ? 's' : ''} contactée{dash.weekDistinctContacts > 1 ? 's' : ''} · du {shortDate(dash.weekStart)} au {shortDate(dash.weekEnd)}
        </Body>
        {goal != null ? (
          <ProgressBar
            progress={progress}
            label={
              dash.weekCallCount >= goal
                ? `${dash.weekCallCount} / ${goal} — objectif atteint`
                : `${dash.weekCallCount} / ${goal} — encore ${goal - dash.weekCallCount}`
            }
          />
        ) : (
          <Body muted>Pas d'objectif : le défaut est {goalDraft || '2'} appels/semaine.</Body>
        )}
        {delta != null ? (
          <Text style={styles.small}>
            Semaine précédente : {dash.previousWeekCallCount} appel{dash.previousWeekCallCount !== 1 ? 's' : ''} ({delta >= 0 ? '+' : ''}{delta})
          </Text>
        ) : null}
        <Text style={styles.small}>Aucun XP ni récompense : ce journal est distinct des habitudes « Appeler un proche ».</Text>
        <View style={styles.rowTop}>
          <Button label="Enregistrer un appel" onPress={openAdd} disabled={busy} />
        </View>
        {msg ? <Text style={styles.msg}>{msg}</Text> : null}
      </FantasyPanel>

      {dash.recentContacts.length > 0 ? (
        <FantasyPanel>
          <Text style={styles.panelTitle}>Personnes contactées récemment</Text>
          {dash.recentContacts.map((c) => (
            <Text key={c.contactId} style={styles.line}>
              {c.name} · {formatWhen(c.lastCalledAt, tz)}
            </Text>
          ))}
        </FantasyPanel>
      ) : null}

      {formOpen && form ? (
        <FantasyPanel>
          <Text style={styles.panelTitle}>{editingId ? 'Corriger l\'appel' : 'Enregistrer un appel'}</Text>
          {!editingId ? (
            <>
              <Text style={styles.fieldLabel}>Proche</Text>
              <View style={styles.chips}>
                {activeContacts.map((c) => (
                  <Chip key={c.id} label={c.name} selected={form.contactId === c.id} onPress={() => patch({ contactId: c.id, quickName: '' })} />
                ))}
              </View>
              {activeContacts.length === 0 ? <Body muted>Aucun proche : crée-en un ci-dessous.</Body> : null}
              <Text style={styles.fieldLabel}>Ou création rapide</Text>
              <Field value={form.quickName} onChangeText={(v) => patch({ quickName: v, contactId: '' })} placeholder="Nom / surnom" accessibilityLabel="Nom du proche" />
              <View style={styles.chips}>
                {(['family', 'friend', 'other'] as const).map((r) => (
                  <Chip key={r} label={PROCHES_RELATION_LABEL[r]} selected={form.quickRelation === r} onPress={() => patch({ quickRelation: form.quickRelation === r ? '' : r })} />
                ))}
              </View>
            </>
          ) : (
            <Body muted>Proche : {entries.find((e) => e.id === editingId)?.contactName ?? '—'}</Body>
          )}
          <Text style={styles.fieldLabel}>Date et heure de l'appel</Text>
          <View style={styles.chips}>
            {TIME_SHIFTS.map((s) => (
              <Chip key={s.label} label={s.label} onPress={() => shiftTime(s.minutes)} />
            ))}
          </View>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Field value={form.date} onChangeText={(v) => patch({ date: v })} placeholder="AAAA-MM-JJ" accessibilityLabel="Date de l'appel" />
            </View>
            <View style={{ width: 96, marginLeft: spacing.xs }}>
              <Field value={form.time} onChangeText={(v) => patch({ time: v })} placeholder="HH:MM" accessibilityLabel="Heure de l'appel" />
            </View>
          </View>
          <Text style={styles.small}>Avant {dash.dayStartHour} h, l'appel compte pour la veille.</Text>
          <Text style={styles.fieldLabel}>Note (facultatif)</Text>
          <Field value={form.note} onChangeText={(v) => patch({ note: v })} placeholder="Sujet de l'appel…" accessibilityLabel="Note" />
          <View style={styles.actions}>
            <View style={styles.actionCell}>
              <Button label={editingId ? 'Enregistrer la correction' : 'Confirmer l\'appel'} onPress={() => void submitCall()} disabled={busy} />
            </View>
            <View style={styles.actionCell}>
              <Button label="Fermer" variant="ghost" onPress={closeForm} disabled={busy} />
            </View>
          </View>
        </FantasyPanel>
      ) : null}

      <FantasyPanel>
        <Text style={styles.panelTitle}>Calendrier du mois</Text>
        <View style={styles.chips}>
          {Array.from({ length: new Date(dash.monthEnd + 'T12:00:00Z').getUTCDate() }, (_, i) => {
            const d = `${dash.monthStart.slice(0, 8)}${String(i + 1).padStart(2, '0')}`;
            if (d > dash.today) return null;
            const n = monthMap.get(d) ?? 0;
            return (
              <Chip
                key={d}
                label={`${shortDate(d)}${n > 0 ? ` · ${n}` : ''}`}
                selected={d === shownDate}
                onPress={() => setSelectedDate(d === dash.today ? null : d)}
              />
            );
          })}
        </View>
        <View style={styles.dayNav}>
          <Button label="←" variant="secondary" compact onPress={() => setSelectedDate(addDays(shownDate, -1))} disabled={busy} />
          <Text style={styles.dayTitle}>
            {isToday ? 'Aujourd\'hui' : shownDate} · {shownCount} appel{shownCount !== 1 ? 's' : ''}
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
        {entries.length === 0 ? <Body muted>Aucun appel ce jour-là.</Body> : null}
        {entries.map((c) => (
          <View key={c.id} style={[styles.entry, c.status === 'cancelled' && styles.entryOff]}>
            <Text style={[styles.entryTitle, c.status === 'cancelled' && styles.struck]}>
              {formatWhen(c.calledAt, tz)} · {c.contactName}
              {c.contactArchived ? ' (archivé)' : ''}
            </Text>
            {c.note ? <Text style={styles.small}>{c.note}</Text> : null}
            {c.status === 'active' ? (
              cancelAsk === c.id ? (
                <View style={styles.row}>
                  <Button label="Oui, annuler" variant="danger" compact onPress={() => void cancelEntry(c.id)} disabled={busy} />
                  <Button label="Non" variant="ghost" compact onPress={() => setCancelAsk(null)} />
                </View>
              ) : (
                <View style={styles.row}>
                  <Button label="Corriger" variant="secondary" compact onPress={() => openEdit(c)} disabled={busy} />
                  <Button label="Annuler l'appel" variant="ghost" compact onPress={() => setCancelAsk(c.id)} disabled={busy} />
                </View>
              )
            ) : (
              <Text style={styles.small}>Annulé — conservé dans l'historique.</Text>
            )}
          </View>
        ))}
      </FantasyPanel>

      <CollapsibleSection title="Objectif hebdomadaire" defaultOpen={false}>
        <FantasyPanel>
          <Body muted>Cible entre 1 et 7 appels. Défaut : 2. Les semaines passées gardent l'objectif d'alors.</Body>
          <Field value={goalDraft} onChangeText={setGoalDraft} keyboardType="number-pad" placeholder="2" accessibilityLabel="Objectif hebdomadaire" />
          <Button label="Enregistrer l'objectif" variant="secondary" onPress={() => void saveGoal()} disabled={busy} />
        </FantasyPanel>
      </CollapsibleSection>

      <CollapsibleSection title="Répertoire des proches" defaultOpen={false}>
        <FantasyPanel>
          {activeContacts.length === 0 ? <Body muted>Aucun proche pour l'instant.</Body> : null}
          {activeContacts.map((c) => (
            <View key={c.id} style={styles.entry}>
              {renameId === c.id ? (
                <View style={styles.row}>
                  <Field value={renameDraft} onChangeText={setRenameDraft} accessibilityLabel="Nouveau nom" />
                  <Button label="OK" compact onPress={() => void doRename(c.id)} disabled={busy} />
                  <Button label="×" variant="ghost" compact onPress={() => setRenameId(null)} />
                </View>
              ) : (
                <>
                  <Text style={styles.entryTitle}>
                    {c.name}{c.relation ? ` · ${PROCHES_RELATION_LABEL[c.relation]}` : ''}
                  </Text>
                  {c.note ? <Text style={styles.small}>{c.note}</Text> : null}
                  <View style={styles.row}>
                    <Button label="Renommer" variant="secondary" compact onPress={() => { setRenameId(c.id); setRenameDraft(c.name); }} disabled={busy} />
                    <Button label="Archiver" variant="ghost" compact onPress={() => void doArchive(c.id)} disabled={busy} />
                  </View>
                </>
              )}
            </View>
          ))}
          {newContactOpen ? (
            <View style={{ marginTop: spacing.sm }}>
              <Field value={newContactName} onChangeText={setNewContactName} placeholder="Nom ou surnom" accessibilityLabel="Nom du nouveau proche" />
              <View style={styles.chips}>
                {(['family', 'friend', 'other'] as const).map((r) => (
                  <Chip key={r} label={PROCHES_RELATION_LABEL[r]} selected={newContactRelation === r} onPress={() => setNewContactRelation(newContactRelation === r ? '' : r)} />
                ))}
              </View>
              <View style={styles.row}>
                <Button label="Ajouter" onPress={() => void addNewContact()} disabled={busy} />
                <Button label="Fermer" variant="ghost" onPress={() => setNewContactOpen(false)} />
              </View>
            </View>
          ) : (
            <Button label="Ajouter un proche" variant="secondary" onPress={() => setNewContactOpen(true)} disabled={busy} />
          )}
        </FantasyPanel>
      </CollapsibleSection>
    </View>
  );
}

const styles = StyleSheet.create({
  kicker: { ...typography.label, color: colors.muted, textAlign: 'center' },
  big: { ...typography.title, color: colors.goldBright, textAlign: 'center', marginVertical: spacing.xs },
  small: { ...typography.caption, color: colors.muted, marginTop: 4 },
  msg: { ...typography.body, color: colors.ember, marginTop: spacing.sm },
  panelTitle: { ...typography.subtitle, color: colors.gold, marginBottom: spacing.xs },
  fieldLabel: { ...typography.caption, color: colors.ink, marginTop: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  rowTop: { marginTop: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.xs },
  actions: { flexDirection: 'row', marginTop: spacing.md, gap: spacing.sm },
  actionCell: { flex: 1 },
  dayNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: spacing.sm },
  dayTitle: { ...typography.caption, color: colors.ink, flex: 1, textAlign: 'center', marginHorizontal: spacing.xs },
  entry: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.cardHighlight,
  },
  entryOff: { opacity: 0.6 },
  entryTitle: { ...typography.body, color: colors.ink },
  struck: { textDecorationLine: 'line-through' },
  line: { ...typography.body, color: colors.ink, marginBottom: 4 },
});