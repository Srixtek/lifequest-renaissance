import { useCallback, useRef, useState } from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Body, Button, Chip, Screen, Title } from '@/src/design-system/ui';
import { FantasyPanel } from '@/src/design-system/FantasyPanel';
import { QuestBoardCard } from '@/src/design-system/QuestBoardCard';
import { colors, spacing, typography } from '@/src/design-system/theme';
import { getDb } from '@/src/data/db/client';
import { friendlyDbError } from '@/src/utils/dbErrors';
import {
  abandonQuest,
  acceptQuest,
  claimQuest,
  getQuestBoard,
  type QuestBoard,
  type QuestBoardEntry,
} from '@/src/domain/services/questService';
import { chooseAdventure, equipLantern, getAdventureView } from '@/src/domain/services/adventureService';
import { useAppStore } from '@/src/state/appStore';

export default function AdventureScreen() {
  const refresh = useAppStore((s) => s.refresh);
  const [view, setView] = useState<Awaited<ReturnType<typeof getAdventureView>> | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [tab, setTab] = useState<'quests' | 'explore'>('quests');
  const [board, setBoard] = useState<QuestBoard | null>(null);
  const [questMsg, setQuestMsg] = useState<string | null>(null);
  const [questBusy, setQuestBusy] = useState(false);
  const questLock = useRef(false);

  const load = useCallback(async () => {
    const db = await getDb();
    setView(await getAdventureView(db));
    setBoard(await getQuestBoard(db));
  }, []);

  const runQuestAction = async (action: (db: Awaited<ReturnType<typeof getDb>>) => Promise<{ message: string }>) => {
    if (questLock.current) return;
    questLock.current = true;
    setQuestBusy(true);
    try {
      const db = await getDb();
      const r = await action(db);
      setQuestMsg(r.message);
    } catch (err) {
      setQuestMsg(friendlyDbError(err));
    } finally {
      try {
        await refresh();
        await load();
      } finally {
        questLock.current = false;
        setQuestBusy(false);
      }
    }
  };

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!view || !board) {
    return (
      <Screen>
        <Body>Chargement…</Body>
      </Screen>
    );
  }

  const byState = (...states: QuestBoardEntry['state'][]) => board.entries.filter((e) => states.includes(e.state));
  const full = board.acceptedCount >= board.maxAccepted;
  const renderCards = (entries: QuestBoardEntry[]) =>
    entries.map((e) => (
      <QuestBoardCard
        key={e.def.id}
        entry={e}
        busy={questBusy}
        acceptDisabledReason={
          full ? `Carnet plein (${board.maxAccepted}/${board.maxAccepted}) : termine ou abandonne une quête.` : null
        }
        onAccept={() => runQuestAction((db) => acceptQuest(db, e.def.id))}
        onClaim={() => runQuestAction((db) => claimQuest(db, e.def.id))}
        onAbandon={() => runQuestAction((db) => abandonQuest(db, e.def.id))}
      />
    ));

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl, paddingTop: spacing.sm }}>
        <View style={styles.tabs}>
          <Chip label="Tableau de quêtes" selected={tab === 'quests'} onPress={() => setTab('quests')} />
          <Chip label="Explorer Eloria" selected={tab === 'explore'} onPress={() => setTab('explore')} />
        </View>
        {tab === 'quests' ? (
          <>
            <FantasyPanel accent>
              <Text style={styles.goldValue}>{board.goldBalance} or</Text>
              <Body muted>
                {`Carnet : ${board.acceptedCount}/${board.maxAccepted} quêtes acceptées. L'or n'est pas encore dépensable : la boutique d'Eloria arrivera plus tard. Tu choisis tes quêtes, à ton rythme.`}
              </Body>
            </FantasyPanel>
            {questMsg ? <Body muted>{questMsg}</Body> : null}
            {byState('ready').length ? <Text style={styles.section}>Prêtes à réclamer</Text> : null}
            {renderCards(byState('ready'))}
            {byState('accepted').length ? <Text style={styles.section}>Acceptées</Text> : null}
            {renderCards(byState('accepted'))}
            {byState('available').length ? <Text style={styles.section}>Disponibles</Text> : null}
            {renderCards(byState('available'))}
            {byState('claimed').length ? <Text style={styles.section}>Terminées</Text> : null}
            {renderCards(byState('claimed'))}
          </>
        ) : (
          <>
            <Title>{view.node.title}</Title>
            <Body>{view.node.description}</Body>
            {view.locked ? (
              <Text style={styles.warn}>Zone voilée — équipe la lanterne pour y voir clair.</Text>
            ) : null}
            <View style={{ height: spacing.md }} />
            <Button
              label="Équiper la lanterne"
              variant="ghost"
              onPress={async () => {
                const db = await getDb();
                const r = await equipLantern(db);
                setMsg(r.message);
                await refresh();
                await load();
              }}
            />
            {view.node.choices.map((c) => (
              <Button
                key={c.id}
                label={c.label}
                onPress={async () => {
                  const db = await getDb();
                  const r = await chooseAdventure(db, c.id);
                  setMsg(r.message);
                  await refresh();
                  await load();
                }}
              />
            ))}
            {msg ? <Body muted>{msg}</Body> : null}
            <Body muted>Visité : {view.visited.join(' → ')}</Body>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  warn: { color: colors.warn, marginTop: spacing.sm },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.sm },
  section: { ...typography.label, color: colors.gold, marginTop: spacing.lg },
  goldValue: { ...typography.title, color: colors.gold, marginBottom: spacing.xs },
});
