import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Body, Button } from './ui';
import { colors, spacing, typography } from './theme';
import { FantasyPanel } from './FantasyPanel';
import { CollapsibleSection } from './CollapsibleSection';
import { getDb } from '../data/db/client';
import {
  abandonWeeklyQuest,
  acceptWeeklyQuest,
  claimWeeklyQuest,
  getWeeklyQuestBlock,
  listWeeklyQuestHistory,
  replaceWeeklyQuest,
  type WeeklyCardState,
  type WeeklyHistoryEntry,
  type WeeklyQuestBlock,
  type WeeklyQuestCard,
} from '../domain/services/weeklyQuestService';
import { resolveWeeklyTarget } from '../domain/services/weeklyQuestNavigation';
import type { DailyCategoryTarget } from '../domain/services/dailyQuestNavigation';
import { friendlyDbError } from '../utils/dbErrors';

const BADGE: Record<WeeklyCardState, { label: string; color: string }> = {
  offered: { label: 'Disponible', color: colors.muted },
  active: { label: 'En cours', color: colors.ember },
  ready: { label: 'Prête', color: colors.gold },
  claimed: { label: 'Terminée', color: colors.success },
  failed: { label: 'Échue', color: colors.warn },
  abandoned: { label: 'Abandonnée', color: colors.warn },
  expired: { label: 'Expirée', color: colors.muted },
};

const OUTCOME_LABEL: Record<WeeklyHistoryEntry['outcome'], string> = {
  claimed: 'Réclamée',
  failed: 'Échue (incomplète), sans pénalité',
  abandoned: 'Abandonnée',
  replaced: 'Remplacée',
  expired: 'Expirée (non acceptée)',
  active: 'En cours',
  ready: 'Prête',
  offered: 'Proposée',
};

function WeeklyCard({
  card,
  busy,
  blocked,
  onAccept,
  onReplace,
  onClaim,
  onAbandon,
  onOpen,
}: {
  card: WeeklyQuestCard;
  busy: boolean;
  blocked: string | null;
  onAccept: () => void;
  onReplace: () => void;
  onClaim: () => void;
  onAbandon: () => void;
  onOpen: () => void;
}) {
  const t = card.template;
  const badge = BADGE[card.state];
  const off = card.state === 'expired' || card.state === 'failed' || card.state === 'abandoned';
  const running = card.state === 'active' || card.state === 'ready';
  const pct = Math.round((card.done / card.steps) * 100);
  return (
    <View style={[styles.card, off && styles.cardOff]}>
      <View style={styles.cardHead}>
        <View style={styles.headMain}>
          <Text style={styles.meta}>
            {card.categoryLabel} · {t.dailyTag} · {card.steps} étapes · du {card.weekStart} au {card.weekEnd}
          </Text>
          <Text style={styles.cardTitle}>{t.title}</Text>
        </View>
        <View style={[styles.badge, { borderColor: badge.color }]}>
          <Text style={[styles.badgeText, { color: badge.color }]}>{badge.label}</Text>
        </View>
      </View>
      <Text style={styles.instruction}>{t.objective}</Text>

      {running || card.state === 'claimed' ? (
        <>
          <Text style={[styles.progress, card.state !== 'active' && styles.progressOk]}>
            Progression : {card.done}/{card.steps}
          </Text>
          <View style={styles.barTrack} accessibilityRole="progressbar" accessibilityLabel={`${card.done} sur ${card.steps}`}>
            <View style={[styles.barFill, { width: `${pct}%` }]} />
          </View>
          {card.doneLabels.map((l) => (
            <Text key={l} style={styles.small}>
              ✓ {l}
            </Text>
          ))}
        </>
      ) : null}
      {card.state === 'active' && card.hint ? <Text style={styles.small}>{card.hint}</Text> : null}
      {card.carriedOver && running ? (
        <Text style={styles.small}>Semaine terminée : les actions faites depuis ne comptent plus.</Text>
      ) : null}

      {card.state === 'claimed' ? (
        <Text style={styles.reward}>
          {card.creditedGold && card.creditedGold > 0
            ? `+${card.creditedGold} or crédités`
            : '0 or crédité (plafond du jour atteint) — mission terminée'}
        </Text>
      ) : (
        <Text style={styles.reward}>Récompense prévue : jusqu'à {t.rewardGold} or (selon le plafond du jour)</Text>
      )}
      {card.state === 'expired' ? <Text style={styles.small}>Non acceptée avant la fin de la semaine : aucune pénalité.</Text> : null}
      {card.state === 'failed' ? <Text style={styles.small}>Incomplète à l'échéance : aucune pénalité.</Text> : null}
      {card.state === 'abandoned' ? <Text style={styles.small}>Retirée du carnet, sans pénalité.</Text> : null}

      {card.state === 'offered' ? (
        <>
          <View style={styles.actions}>
            <View style={styles.actionMain}>
              <Button label="Accepter" onPress={onAccept} disabled={busy || blocked != null} />
            </View>
            {card.canReplace ? (
              <Button label="Remplacer" variant="secondary" compact onPress={onReplace} disabled={busy} />
            ) : null}
          </View>
          {blocked ? <Text style={styles.small}>{blocked}</Text> : null}
        </>
      ) : null}
      {card.state === 'active' ? (
        <View style={styles.actions}>
          <View style={styles.actionMain}>
            <Button label="Aller à l'activité" variant="secondary" onPress={onOpen} disabled={busy} />
          </View>
          <Button label="Abandonner" variant="ghost" compact onPress={onAbandon} disabled={busy} />
        </View>
      ) : null}
      {card.state === 'ready' ? (
        <View style={styles.actions}>
          <View style={styles.actionMain}>
            <Button label={`Réclamer (jusqu'à ${t.rewardGold} or)`} onPress={onClaim} disabled={busy} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

export function WeeklyQuestsBlock({ onOpenActivity }: { onOpenActivity: (target: DailyCategoryTarget) => void }) {
  const [block, setBlock] = useState<WeeklyQuestBlock | null>(null);
  const [history, setHistory] = useState<WeeklyHistoryEntry[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);

  const reload = useCallback(async () => {
    try {
      const db = await getDb();
      setBlock(await getWeeklyQuestBlock(db));
      setHistory(await listWeeklyQuestHistory(db));
    } catch (err) {
      setMsg(friendlyDbError(err));
    }
  }, []);

  useFocusEffect(useCallback(() => { void reload(); }, [reload]));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void reload(); });
    return () => sub.remove();
  }, [reload]);

  const run = async (fn: () => Promise<string>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      setMsg(await fn());
    } catch (err) {
      setMsg(friendlyDbError(err));
    } finally {
      try {
        await reload();
      } finally {
        lock.current = false;
        setBusy(false);
      }
    }
  };

  if (!block) {
    return (
      <FantasyPanel>
        <Body muted>Chargement des missions de la semaine…</Body>
      </FantasyPanel>
    );
  }

  const blockedReason = block.weeklyAccepted
    ? 'Une seule mission de la semaine à la fois : termine ou abandonne celle en cours.'
    : block.slotsFull
      ? 'Emplacements pleins : termine ou abandonne une quête acceptée pour accepter celle-ci.'
      : null;

  return (
    <View>
      <FantasyPanel>
        <Text style={styles.kicker}>Missions de la semaine (facultatif)</Text>
        <Body muted>
          Semaine du {block.weekStart} au {block.weekEnd} (lundi → dimanche). Accepte une mission AVANT de faire les
          actions : seules celles faites ensuite, dans la semaine, comptent. Aucune obligation, aucune pénalité.
        </Body>
        <Text style={styles.small}>
          Emplacements de quêtes acceptées : {block.acceptedCount}/{block.maxAccepted} (partagés avec les missions du
          jour). Or du jour (plafond partagé) : encore {block.dailyGoldRemaining}/{block.goldCap}. Solde :{' '}
          {block.goldBalance} or.
        </Text>
        {msg ? <Text style={styles.msg}>{msg}</Text> : null}
      </FantasyPanel>

      {block.cards.map((c) => (
        <WeeklyCard
          key={c.offerId}
          card={c}
          busy={busy}
          blocked={blockedReason}
          onAccept={() =>
            void run(async () => (await acceptWeeklyQuest(await getDb(), c.offerId)).message)
          }
          onReplace={() =>
            void run(async () => (await replaceWeeklyQuest(await getDb(), c.offerId)).message)
          }
          onClaim={() =>
            void run(async () => {
              if (!c.instanceId) return 'Mission introuvable.';
              const r = await claimWeeklyQuest(await getDb(), c.instanceId);
              if (!r.ok) return r.message;
              return r.gold > 0
                ? `+${r.gold} or crédités. Nouveau solde : ${r.balance} or.`
                : `Mission terminée : 0 or crédité (plafond du jour atteint). Solde : ${r.balance} or.`;
            })
          }
          onAbandon={() =>
            void run(async () => {
              if (!c.instanceId) return 'Mission introuvable.';
              return (await abandonWeeklyQuest(await getDb(), c.instanceId)).message;
            })
          }
          onOpen={() => onOpenActivity(resolveWeeklyTarget(c))}
        />
      ))}
      <Text style={styles.small}>
        {block.replacementsRemaining > 0
          ? 'Tu peux remplacer UNE offre non acceptée cette semaine.'
          : 'Remplacement de la semaine déjà utilisé.'}
      </Text>

      <CollapsibleSection title="Historique des missions de la semaine" defaultOpen={false}>
        <FantasyPanel>
          {history.length === 0 ? <Body muted>Rien pour l'instant.</Body> : null}
          {history.map((h) => (
            <View key={h.offerId} style={styles.histRow}>
              <Text style={styles.histTitle}>
                {h.weekStart} · {h.title}
              </Text>
              <Text style={styles.small}>
                {OUTCOME_LABEL[h.outcome]}
                {h.outcome === 'claimed' ? ` — ${h.creditedGold ?? 0} or crédité` : ''}
              </Text>
            </View>
          ))}
        </FantasyPanel>
      </CollapsibleSection>
    </View>
  );
}

const styles = StyleSheet.create({
  kicker: { ...typography.label, color: colors.muted, textAlign: 'center' },
  small: { ...typography.caption, color: colors.muted, marginTop: 4 },
  msg: { ...typography.body, color: colors.ember, marginTop: spacing.sm },
  card: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.cardHighlight,
  },
  cardOff: { opacity: 0.6 },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  headMain: { flex: 1, minWidth: 0 },
  meta: { ...typography.caption, color: colors.muted },
  cardTitle: { ...typography.subtitle, color: colors.ink },
  badge: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { fontSize: 11, fontWeight: '600' },
  instruction: { ...typography.caption, color: colors.ink, marginTop: spacing.xs },
  progress: { ...typography.caption, color: colors.muted, marginTop: spacing.xs },
  progressOk: { color: colors.success, fontWeight: '600' },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: colors.line, marginTop: spacing.xs, overflow: 'hidden' },
  barFill: { height: 8, backgroundColor: colors.gold },
  reward: { ...typography.caption, color: colors.gold, fontWeight: '700', marginTop: spacing.xs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
  actionMain: { flex: 1, minWidth: 140 },
  histRow: { marginTop: spacing.xs },
  histTitle: { ...typography.body, color: colors.ink },
});
