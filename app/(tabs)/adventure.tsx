import { useCallback, useRef, useState } from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Body, Button, Chip, Screen, Title } from '@/src/design-system/ui';
import { FantasyPanel } from '@/src/design-system/FantasyPanel';
import { QuestBoardCard } from '@/src/design-system/QuestBoardCard';
import { KingdomScene, type KingdomZone } from '@/src/design-system/KingdomScene';
import { CombatPanel } from '@/src/design-system/CombatPanel';
import { colors, spacing, typography } from '@/src/design-system/theme';
import { FORGE_LEVEL_LABELS } from '@/src/data/content/kingdom';
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
import {
  confirmForgeUpgrade,
  dismissCombat,
  getKingdomView,
  performCombatAction,
  skillNameForClass,
  startCombat,
} from '@/src/domain/services/kingdomService';
import { useAppStore } from '@/src/state/appStore';

export default function AdventureScreen() {
  const refresh = useAppStore((s) => s.refresh);
  const [view, setView] = useState<Awaited<ReturnType<typeof getAdventureView>> | null>(null);
  const [kingdom, setKingdom] = useState<Awaited<ReturnType<typeof getKingdomView>> | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [kingdomMsg, setKingdomMsg] = useState<string | null>(null);
  const [tab, setTab] = useState<'royaume' | 'quests' | 'trail'>('royaume');
  const [board, setBoard] = useState<QuestBoard | null>(null);
  const [questMsg, setQuestMsg] = useState<string | null>(null);
  const [questBusy, setQuestBusy] = useState(false);
  const [kingdomBusy, setKingdomBusy] = useState(false);
  const [forgeOpen, setForgeOpen] = useState(false);
  const [forgeConfirm, setForgeConfirm] = useState(false);
  const [combatOpen, setCombatOpen] = useState(false);
  const questLock = useRef(false);
  const kingdomLock = useRef(false);

  const load = useCallback(async () => {
    const db = await getDb();
    setView(await getAdventureView(db));
    setBoard(await getQuestBoard(db));
    setKingdom(await getKingdomView(db));
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

  const runKingdom = async (fn: (db: Awaited<ReturnType<typeof getDb>>) => Promise<{ message: string }>) => {
    if (kingdomLock.current) return;
    kingdomLock.current = true;
    setKingdomBusy(true);
    try {
      const db = await getDb();
      const r = await fn(db);
      setKingdomMsg(r.message);
    } catch (err) {
      setKingdomMsg(friendlyDbError(err));
    } finally {
      try {
        await refresh();
        await load();
      } finally {
        kingdomLock.current = false;
        setKingdomBusy(false);
      }
    }
  };

  const onZone = async (zone: KingdomZone) => {
    if (zone === 'forge') {
      setForgeOpen(true);
      setCombatOpen(false);
      return;
    }
    if (zone === 'combat') {
      setCombatOpen(true);
      setForgeOpen(false);
      if (!kingdom?.combat.active && !kingdom?.combat.outcome) {
        await runKingdom(async (db) => {
          const r = await startCombat(db);
          return { message: r.message };
        });
      }
      return;
    }
    if (zone === 'forest') setKingdomMsg("La forêt recèle encore d'autres menaces… prochainement.");
    if (zone === 'camp') setKingdomMsg('Le camp tient bon. Les routes habituelles restent intactes.');
  };

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!view || !board || !kingdom) {
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

  const skillReady = kingdom.combat.skillCooldown <= 0;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl, paddingTop: spacing.sm }}>
        <Title>Royaume</Title>
        <Body muted>Le bastion d&apos;Eloria — forge, combat et quêtes du carnet.</Body>
        <View style={styles.tabs}>
          <Chip label="Bastion" selected={tab === 'royaume'} onPress={() => setTab('royaume')} />
          <Chip label="Quêtes" selected={tab === 'quests'} onPress={() => setTab('quests')} />
          <Chip label="Ancien sentier" selected={tab === 'trail'} onPress={() => setTab('trail')} />
        </View>
        {tab === 'royaume' ? (
          <>
            <FantasyPanel accent>
              <Text style={styles.goldValue}>{kingdom.gold} or</Text>
              <Body muted>
                {`Forge : ${kingdom.forge.label} (+${kingdom.forge.damageBonus} dégâts). ${
                  kingdom.hasTrophy ? 'Bannière du bastion obtenue.' : 'Première victoire : bannière.'
                }`}
              </Body>
            </FantasyPanel>
            <KingdomScene forgeLevel={kingdom.forge.level} onZone={onZone} />
            {kingdomMsg ? <Body muted>{kingdomMsg}</Body> : null}
            {forgeOpen ? (
              <FantasyPanel>
                <Text style={styles.section}>Forge du bastion</Text>
                <Body>
                  Niveau {kingdom.forge.level} — {FORGE_LEVEL_LABELS[kingdom.forge.level]}
                </Body>
                <Body muted>
                  Dégâts au combat : {kingdom.forge.baseDamagePreview}. Prochain niveau :{' '}
                  {kingdom.forge.nextLevel
                    ? `${FORGE_LEVEL_LABELS[kingdom.forge.nextLevel]} (${kingdom.forge.upgradeCost} or)`
                    : 'maximum atteint'}
                </Body>
                {kingdom.forge.nextLevel && kingdom.forge.upgradeCost ? (
                  forgeConfirm ? (
                    <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
                      <Body>Confirmer la dépense de {kingdom.forge.upgradeCost} or ?</Body>
                      <Button
                        label="Confirmer l'amélioration"
                        disabled={kingdomBusy || !kingdom.canUpgrade}
                        onPress={() =>
                          runKingdom(async (db) => {
                            const r = await confirmForgeUpgrade(db, kingdom.forge.level);
                            setForgeConfirm(false);
                            return { message: r.message };
                          })
                        }
                      />
                      <Button label="Annuler" variant="ghost" onPress={() => setForgeConfirm(false)} />
                    </View>
                  ) : (
                    <Button
                      label={`Améliorer (${kingdom.forge.upgradeCost} or)`}
                      disabled={!kingdom.canUpgrade || kingdomBusy}
                      onPress={() => setForgeConfirm(true)}
                    />
                  )
                ) : null}
              </FantasyPanel>
            ) : null}
            {combatOpen && (kingdom.combat.active || kingdom.combat.outcome) ? (
              <CombatPanel
                combat={kingdom.combat}
                classId={kingdom.classId}
                skillLabel={skillNameForClass(kingdom.classId)}
                skillReady={skillReady}
                busy={kingdomBusy}
                onAttack={() => {
                  const turn = kingdom.combat.turnNumber;
                  const rev = kingdom.combat.updatedAt;
                  return runKingdom(async (db) => {
                    const r = await performCombatAction(db, 'attack', turn, rev);
                    return { message: r.message };
                  });
                }}
                onDefend={() => {
                  const turn = kingdom.combat.turnNumber;
                  const rev = kingdom.combat.updatedAt;
                  return runKingdom(async (db) => {
                    const r = await performCombatAction(db, 'defend', turn, rev);
                    return { message: r.message };
                  });
                }}
                onSkill={() => {
                  const turn = kingdom.combat.turnNumber;
                  const rev = kingdom.combat.updatedAt;
                  return runKingdom(async (db) => {
                    const r = await performCombatAction(db, 'skill', turn, rev);
                    return { message: r.message };
                  });
                }}
                onLeave={() =>
                  runKingdom(async (db) => {
                    await dismissCombat(db);
                    setCombatOpen(false);
                    return { message: 'Retour au bastion.' };
                  })
                }
              />
            ) : combatOpen ? (
              <Button
                label="Affronter le Gardien des Ronces"
                onPress={() =>
                  runKingdom(async (db) => {
                    const r = await startCombat(db);
                    return { message: r.message };
                  })
                }
                disabled={kingdomBusy}
              />
            ) : null}
          </>
        ) : null}
        {tab === 'quests' ? (
          <>
            <FantasyPanel accent>
              <Text style={styles.goldValue}>{board.goldBalance} or</Text>
              <Body muted>
                {`Carnet : ${board.acceptedCount}/${board.maxAccepted} quêtes acceptées. L'or peut améliorer la forge au bastion. Tu choisis tes quêtes, à ton rythme.`}
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
        ) : null}
        {tab === 'trail' ? (
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
        ) : null}
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