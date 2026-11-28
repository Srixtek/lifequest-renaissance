import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Body, Button } from './ui';
import { colors, spacing, typography } from './theme';
import { FantasyPanel } from './FantasyPanel';
import { CollapsibleSection } from './CollapsibleSection';
import { getDb } from '../data/db/client';
import type { DiversCompletionRow } from '../data/db/repositories/diversRepo';
import { DIVERS_ACTIVITY_BY_ID, DIVERS_THEME_LABEL } from '../data/content/diversActivities';
import {
  cancelDiversCompletion,
  confirmDiversActivity,
  getDiversDashboard,
  passDiversSuggestion,
  replaceDiversSuggestion,
  type DiversDashboard,
  type DiversSuggestionSlot,
} from '../domain/services/diversTrackerService';
import { createId } from '../utils/id';
import { friendlyDbError } from '../utils/dbErrors';

function formatWhen(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('fr-FR', { timeZone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function SuggestionCard({
  slot,
  busy,
  canReplace,
  onConfirm,
  onPass,
  onReplace,
}: {
  slot: DiversSuggestionSlot;
  busy: boolean;
  canReplace: boolean;
  onConfirm: () => void;
  onPass: () => void;
  onReplace: () => void;
}) {
  const a = slot.activity;
  if (slot.passed) {
    return (
      <View style={[styles.suggestion, styles.entryOff]}>
        <Text style={styles.suggestionTitle}>{a.title} — ignorée aujourd'hui</Text>
        <Text style={styles.small}>
          Masquée pour la journée, sans pénalité. {canReplace ? '« Remplacer » donne une autre idée (1 fois par jour).' : 'Remplacement du jour déjà utilisé.'}
        </Text>
        {canReplace ? (
          <View style={styles.actions}>
            <Button label="Remplacer" variant="secondary" compact onPress={onReplace} disabled={busy} />
          </View>
        ) : null}
      </View>
    );
  }
  return (
    <View style={styles.suggestion}>
      <Text style={styles.suggestionTitle}>{a.title}</Text>
      <Body muted>{a.description}</Body>
      <Text style={styles.meta}>
        {DIVERS_THEME_LABEL[a.theme]} · ~{a.durationMin} min
      </Text>
      <Text style={styles.hint}>{a.confirmHint}</Text>
      <View style={styles.actions}>
        <View style={styles.actionMain}>
          <Button label="Je l'ai fait" onPress={onConfirm} disabled={busy} />
        </View>
        <Button label="Passer" variant="ghost" compact onPress={onPass} disabled={busy} />
        {canReplace ? (
          <Button label="Remplacer" variant="secondary" compact onPress={onReplace} disabled={busy} />
        ) : null}
      </View>
    </View>
  );
}

function HistoryRow({
  row,
  timeZone,
  busy,
  cancelAsk,
  onAskCancel,
  onCancel,
  onDismissAsk,
}: {
  row: DiversCompletionRow;
  timeZone?: string;
  busy: boolean;
  cancelAsk: string | null;
  onAskCancel: () => void;
  onCancel: () => void;
  onDismissAsk: () => void;
}) {
  const title = DIVERS_ACTIVITY_BY_ID[row.activityId]?.title ?? row.activityId;
  const off = row.status === 'cancelled';
  return (
    <View style={[styles.entry, off && styles.entryOff]}>
      <Text style={[styles.entryTitle, off && styles.struck]}>
        {formatWhen(row.confirmedAt, timeZone)} · {title}
      </Text>
      {off ? (
        <Text style={styles.small}>Annulé — conservé dans l'historique.</Text>
      ) : cancelAsk === row.id ? (
        <View style={styles.row}>
          <Button label="Oui, annuler" variant="danger" compact onPress={onCancel} disabled={busy} />
          <Button label="Non" variant="ghost" compact onPress={onDismissAsk} />
        </View>
      ) : (
        <Button label="Annuler cette confirmation" variant="ghost" compact onPress={onAskCancel} disabled={busy} />
      )}
    </View>
  );
}

export function DiversTracker() {
  const [dash, setDash] = useState<DiversDashboard | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelAsk, setCancelAsk] = useState<string | null>(null);
  const confirmIds = useRef<Record<string, string>>({});
  const lock = useRef(false);

  const reload = useCallback(async () => {
    try {
      const db = await getDb();
      setDash(await getDiversDashboard(db));
    } catch (err) {
      setMsg(friendlyDbError(err));
    }
  }, []);

  useFocusEffect(useCallback(() => { void reload(); }, [reload]));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void reload(); });
    return () => sub.remove();
  }, [reload]);

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

  const requestIdFor = (activityId: string) => {
    if (!confirmIds.current[activityId]) confirmIds.current[activityId] = createId('dreq');
    return confirmIds.current[activityId];
  };

  const confirm = (activityId: string) =>
    run(async () => {
      const db = await getDb();
      const r = await confirmDiversActivity(db, activityId, requestIdFor(activityId));
      if (!r.ok) {
        setMsg(
          r.code === 'passed'
            ? 'Suggestion ignorée aujourd\'hui : utilise « Remplacer » pour obtenir une autre idée.'
            : 'Cette suggestion n\'est plus affichée : rafraîchis l\'écran.',
        );
        await reload();
        return;
      }
      setMsg(r.message);
      if (!r.duplicate) confirmIds.current[activityId] = createId('dreq');
      await reload();
    });

  const pass = (slotIndex: 0 | 1) =>
    run(async () => {
      const db = await getDb();
      const r = await passDiversSuggestion(db, slotIndex);
      if (r.ok) {
        setDash(r.dashboard);
        setMsg('Suggestion ignorée pour aujourd\'hui. « Remplacer » (1 fois par jour) donne une autre idée.');
      }
    });

  const replace = (slotIndex: 0 | 1) =>
    run(async () => {
      const db = await getDb();
      const r = await replaceDiversSuggestion(db, slotIndex);
      if (!r.ok) {
        setMsg(
          r.code === 'limit_reached'
            ? 'Un seul remplacement par jour pour le moment.'
            : r.code === 'already_done'
              ? 'Cette activité est déjà confirmée : elle ne peut pas être remplacée.'
              : 'Remplacement impossible.',
        );
        return;
      }
      setDash(r.dashboard);
      setMsg('Suggestion remplacée.');
    });

  const cancel = (id: string) =>
    run(async () => {
      const db = await getDb();
      const r = await cancelDiversCompletion(db, id);
      if (!r.ok) {
        setMsg(
          r.code === 'already_cancelled'
            ? 'Déjà annulé.'
            : r.code === 'rewarded'
              ? 'Cette confirmation a déjà servi à une récompense de mission : elle ne peut plus être annulée.'
              : 'Annulation impossible.',
        );
        return;
      }
      setCancelAsk(null);
      setMsg('Confirmation retirée (trace conservée).');
      await reload();
    });

  if (!dash) {
    return (
      <FantasyPanel accent>
        <Body muted>Chargement des petites activités…</Body>
      </FantasyPanel>
    );
  }

  const tz = dash.timeZone;
  const canReplace = dash.replacementsRemaining > 0;

  return (
    <View>
      <FantasyPanel accent>
        <Text style={styles.kicker}>Petites activités (facultatif)</Text>
        <Body muted>
          Deux idées par jour, sans obligation ni pénalité. Confirme seulement ce que tu as vraiment fait.
        </Body>
        <Text style={styles.small}>
          Aucun XP direct. L'or ne vient que des « Trois missions du jour » (Habitudes), après acceptation de la mission puis confirmation ici.
        </Text>
        {msg ? <Text style={styles.msg}>{msg}</Text> : null}
      </FantasyPanel>

      <FantasyPanel>
        <Text style={styles.panelTitle}>Suggestions du jour</Text>
        {dash.suggestions.map((s) => (
          <SuggestionCard
            key={s.slotIndex}
            slot={s}
            busy={busy}
            canReplace={canReplace}
            onConfirm={() => void confirm(s.activityId)}
            onPass={() => void pass(s.slotIndex)}
            onReplace={() => void replace(s.slotIndex)}
          />
        ))}
        {dash.replacementsRemaining === 0 ? (
          <Text style={styles.small}>Remplacement du jour déjà utilisé.</Text>
        ) : null}
      </FantasyPanel>

      {dash.todayCompletions.length > 0 ? (
        <FantasyPanel>
          <Text style={styles.panelTitle}>Confirmé aujourd'hui</Text>
          {dash.todayCompletions.map((c) => (
            <HistoryRow
              key={c.id}
              row={c}
              timeZone={tz}
              busy={busy}
              cancelAsk={cancelAsk}
              onAskCancel={() => setCancelAsk(c.id)}
              onCancel={() => void cancel(c.id)}
              onDismissAsk={() => setCancelAsk(null)}
            />
          ))}
        </FantasyPanel>
      ) : null}

      <CollapsibleSection title="Historique récent" defaultOpen={false}>
        <FantasyPanel>
          {dash.recentHistory.length === 0 ? <Body muted>Rien pour l'instant.</Body> : null}
          {dash.recentHistory.map((c) => (
            <HistoryRow
              key={`hist-${c.id}`}
              row={c}
              timeZone={tz}
              busy={busy}
              cancelAsk={cancelAsk}
              onAskCancel={() => setCancelAsk(c.id)}
              onCancel={() => void cancel(c.id)}
              onDismissAsk={() => setCancelAsk(null)}
            />
          ))}
        </FantasyPanel>
      </CollapsibleSection>
    </View>
  );
}

const styles = StyleSheet.create({
  kicker: { ...typography.label, color: colors.muted, textAlign: 'center' },
  panelTitle: { ...typography.subtitle, color: colors.gold, marginBottom: spacing.xs },
  small: { ...typography.caption, color: colors.muted, marginTop: 4 },
  msg: { ...typography.body, color: colors.ember, marginTop: spacing.sm },
  suggestion: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.cardHighlight,
  },
  suggestionTitle: { ...typography.subtitle, color: colors.ink },
  meta: { ...typography.caption, color: colors.muted, marginTop: 4 },
  hint: { ...typography.caption, color: colors.ink, marginTop: spacing.xs, fontStyle: 'italic' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
  actionMain: { flex: 1, minWidth: 140 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
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
});