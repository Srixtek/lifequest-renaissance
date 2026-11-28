import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Body, Button } from './ui';
import { colors, spacing, typography } from './theme';
import { FantasyPanel } from './FantasyPanel';
import { CollapsibleSection } from './CollapsibleSection';
import { getDb } from '../data/db/client';
import {
  acceptDailyQuest,
  getDailyQuestBlock,
  listDailyQuestHistory,
  replaceDailyQuest,
  type DailyCardState,
  type DailyHistoryEntry,
  type DailyQuestBlock,
  type DailyQuestCard,
} from '../domain/services/dailyQuestService';
import { abandonRenewableQuest, claimRenewableQuest } from '../domain/services/renewableQuestService';
import { friendlyDbError } from '../utils/dbErrors';

const BADGE: Record<DailyCardState, { label: string; color: string }> = {
  offered: { label: 'Disponible', color: colors.muted },
  active: { label: 'En cours', color: colors.ember },
  ready: { label: 'Prête', color: colors.gold },
  claimed: { label: 'Terminée', color: colors.success },
  failed: { label: 'Abandonnée', color: colors.warn },
  expired: { label: 'Expirée', color: colors.muted },
};

const OUTCOME_LABEL: Record<DailyHistoryEntry['outcome'], string> = {
  claimed: 'Réclamée',
  failed: 'Abandonnée / échouée',
  replaced: 'Remplacée',
  expired: 'Expirée (non acceptée)',
  active: 'En cours',
  ready: 'Prête',
  offered: 'Proposée',
};

export type DailyActivityTarget = 'sport' | 'proches' | 'divers' | 'adventure';

function activityTarget(card: DailyQuestCard): DailyActivityTarget {
  switch (card.template.proof) {
    case 'sport_session':
      return 'sport';
    case 'proches_call':
      return 'proches';
    case 'divers_activity':
      return 'divers';
    default:
      return 'adventure';
  }
}

function MissionCard({
  card,
  busy,
  slotsFull,
  onAccept,
  onReplace,
  onClaim,
  onAbandon,
  onOpen,
}: {
  card: DailyQuestCard;
  busy: boolean;
  slotsFull: boolean;
  onAccept: () => void;
  onReplace: () => void;
  onClaim: () => void;
  onAbandon: () => void;
  onOpen: () => void;
}) {
  const t = card.template;
  const badge = BADGE[card.state];
  const off = card.state === 'expired' || card.state === 'failed';
  return (
    <View style={[styles.card, off && styles.cardOff]}>
      <View style={styles.cardHead}>
        <View style={styles.headMain}>
          <Text style={styles.meta}>
            {t.dailyTag ?? 'Bien-être'} · {t.difficulty} · {t.durationLabel}
            {card.carriedOver ? ` · acceptée le ${card.localDate}` : ''}
          </Text>
          <Text style={styles.cardTitle}>{t.title}</Text>
        </View>
        <View style={[styles.badge, { borderColor: badge.color }]}>
          <Text style={[styles.badgeText, { color: badge.color }]}>{badge.label}</Text>
        </View>
      </View>
      <Text style={styles.instruction}>{card.instruction}</Text>

      {card.state === 'offered' ? (
        <Text style={styles.reward}>Récompense prévue : jusqu'à {t.rewardGold} or (selon le plafond du jour)</Text>
      ) : null}
      {card.state === 'active' || card.state === 'ready' ? (
        <>
          <Text style={[styles.progress, card.state === 'ready' && styles.progressOk]}>
            {card.progress?.label ?? 'Pas encore commencée'}
          </Text>
          <Text style={styles.reward}>Récompense prévue : jusqu'à {t.rewardGold} or</Text>
        </>
      ) : null}
      {card.state === 'claimed' ? (
        <Text style={styles.reward}>
          {card.creditedGold && card.creditedGold > 0
            ? `+${card.creditedGold} or crédités`
            : '0 or crédité (plafond du jour atteint) — mission terminée'}
        </Text>
      ) : null}
      {card.state === 'expired' ? (
        <Text style={styles.small}>Non acceptée avant la fin de la journée : aucune pénalité.</Text>
      ) : null}
      {card.state === 'failed' ? <Text style={styles.small}>Retirée du carnet, sans pénalité.</Text> : null}

      {card.state === 'offered' ? (
        <>
          <View style={styles.actions}>
            <View style={styles.actionMain}>
              <Button label="Accepter" onPress={onAccept} disabled={busy || slotsFull} />
            </View>
            {card.canReplace ? (
              <Button label="Remplacer" variant="secondary" compact onPress={onReplace} disabled={busy} />
            ) : null}
          </View>
          {slotsFull ? (
            <Text style={styles.small}>
              Emplacements pleins : termine ou abandonne une quête acceptée (Aventure ou ci-dessous) pour accepter celle-ci.
            </Text>
          ) : null}
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
        <Button label={`Réclamer (jusqu'à ${t.rewardGold} or)`} onPress={onClaim} disabled={busy} />
      ) : null}
    </View>
  );
}

export function DailyQuestsBlock({ onOpenActivity }: { onOpenActivity: (target: DailyActivityTarget) => void }) {
  const [block, setBlock] = useState<DailyQuestBlock | null>(null);
  const [history, setHistory] = useState<DailyHistoryEntry[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);

  const reload = useCallback(async () => {
    try {
      const db = await getDb();
      setBlock(await getDailyQuestBlock(db));
      setHistory(await listDailyQuestHistory(db));
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
      <FantasyPanel accent>
        <Body muted>Chargement des missions du jour…</Body>
      </FantasyPanel>
    );
  }

  const accept = (c: DailyQuestCard) =>
    run(async () => {
      const db = await getDb();
      return (await acceptDailyQuest(db, c.offerId)).message;
    });
  const replace = (c: DailyQuestCard) =>
    run(async () => {
      const db = await getDb();
      return (await replaceDailyQuest(db, c.offerId)).message;
    });
  const claim = (c: DailyQuestCard) =>
    run(async () => {
      if (!c.instanceId) return 'Mission introuvable.';
      const db = await getDb();
      const r = await claimRenewableQuest(db, c.instanceId);
      if (!r.ok) return r.message;
      const credited = r.gold ?? 0;
      return credited > 0
        ? `+${credited} or crédités. Nouveau solde : ${r.balance ?? '—'} or.`
        : `Mission terminée : 0 or crédité (plafond du jour atteint). Solde : ${r.balance ?? '—'} or.`;
    });
  const abandon = (c: DailyQuestCard) =>
    run(async () => {
      if (!c.instanceId) return 'Mission introuvable.';
      const db = await getDb();
      return (await abandonRenewableQuest(db, c.instanceId)).message;
    });

  return (
    <View>
      <FantasyPanel accent>
        <Text style={styles.kicker}>Trois missions du jour (facultatif)</Text>
        <Body muted>
          Accepte une mission AVANT de faire l'action : seules les actions faites après l'acceptation comptent. Aucune
          obligation, aucune pénalité.
        </Body>
        <Text style={styles.small}>
          Emplacements de quêtes acceptées : {block.acceptedCount}/{block.maxAccepted}. Or du jour (plafond partagé avec
          la vape) : encore {block.dailyGoldRemaining}/{block.goldCap}. Solde : {block.goldBalance} or.
        </Text>
        <Text style={styles.small}>
          Les missions changent à ton début de journée ({String(block.dayStartHour).padStart(2, '0')}h
          {block.timeZone ? `, ${block.timeZone}` : ''}). Le plafond d'or, lui, se remet à zéro à minuit UTC : les deux
          moments ne coïncident pas.
        </Text>
        {msg ? <Text style={styles.msg}>{msg}</Text> : null}
      </FantasyPanel>

      {block.cards.map((c) => (
        <MissionCard
          key={c.offerId}
          card={c}
          busy={busy}
          slotsFull={block.slotsFull}
          onAccept={() => void accept(c)}
          onReplace={() => void replace(c)}
          onClaim={() => void claim(c)}
          onAbandon={() => void abandon(c)}
          onOpen={() => onOpenActivity(activityTarget(c))}
        />
      ))}
      <Text style={styles.small}>
        {block.replacementsRemaining > 0
          ? 'Tu peux remplacer UNE mission non acceptée aujourd\'hui.'
          : 'Remplacement du jour déjà utilisé.'}
      </Text>

      <CollapsibleSection title="Historique des missions" defaultOpen={false}>
        <FantasyPanel>
          {history.length === 0 ? <Body muted>Rien pour l'instant.</Body> : null}
          {history.map((h) => (
            <View key={h.offerId} style={styles.histRow}>
              <Text style={styles.histTitle}>
                {h.localDate} · {h.categoryLabel} · {h.title}
              </Text>
              <Text style={styles.small}>
                {OUTCOME_LABEL[h.outcome]}
                {h.outcome === 'claimed' ? ` — ${h.creditedGold ?? 0} or crédité${h.evidenceKey ? ` (preuve ${h.evidenceKey})` : ''}` : ''}
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
  reward: { ...typography.caption, color: colors.gold, fontWeight: '700', marginTop: spacing.xs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
  actionMain: { flex: 1, minWidth: 140 },
  histRow: { marginTop: spacing.xs },
  histTitle: { ...typography.body, color: colors.ink },
});
