import { useCallback, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Body, Button, Chip, Screen, TabScrollView } from '@/src/design-system/ui';
import { FantasyPanel } from '@/src/design-system/FantasyPanel';
import { QuestBoardCard } from '@/src/design-system/QuestBoardCard';
import { EmptyState } from '@/src/design-system/QuestCard';
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
import {
  abandonRenewableQuest,
  acceptRenewableQuest,
  claimRenewableQuest,
  failRenewableTimer,
  getRenewableQuestBoard,
  partialStopRenewableTimer,
  refreshRenewableState,
  startRenewableTimer,
  succeedRenewableTimer,
  type RenewableQuestBoard,
  type RenewableBoardEntry,
} from '@/src/domain/services/renewableQuestService';
import { RenewableQuestCard } from '@/src/design-system/RenewableQuestCard';
import type { RenewableQuestCategory } from '@/src/data/content/renewableQuestTemplates';
import { CATEGORY_LABELS } from '@/src/data/content/renewableQuestTemplates';
import {
  confirmForgeUpgrade,
  dismissCombat,
  getKingdomView,
  performCombatAction,
  skillNameForClass,
  startCombat,
} from '@/src/domain/services/kingdomService';
import { skillAffordable } from '@/src/domain/combat/combatEngine';
import { MIST_WOLF_ID, THORN_GUARDIAN_ID, type EnemyId } from '@/src/data/content/kingdom';
import { useAppStore } from '@/src/state/appStore';

export default function AdventureScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string; instanceId?: string; openCombat?: string; openForge?: string }>();
  const refresh = useAppStore((s) => s.refresh);
  const [kingdom, setKingdom] = useState<Awaited<ReturnType<typeof getKingdomView>> | null>(null);
  const [kingdomMsg, setKingdomMsg] = useState<string | null>(null);
  const [tab, setTab] = useState<'royaume' | 'quests'>('royaume');
  const [board, setBoard] = useState<QuestBoard | null>(null);
  const [renewableBoard, setRenewableBoard] = useState<RenewableQuestBoard | null>(null);
  const [questCategory, setQuestCategory] = useState<RenewableQuestCategory | 'toutes'>('toutes');
  const [winFlashId, setWinFlashId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [questMsg, setQuestMsg] = useState<string | null>(null);
  const [questBusy, setQuestBusy] = useState(false);
  const [kingdomBusy, setKingdomBusy] = useState(false);
  const [forgeOpen, setForgeOpen] = useState(false);
  const [forgeConfirm, setForgeConfirm] = useState(false);
  const [combatOpen, setCombatOpen] = useState(false);
  const [pickedEnemy, setPickedEnemy] = useState<EnemyId>(THORN_GUARDIAN_ID);
  const questLock = useRef(false);
  const kingdomLock = useRef(false);

  const load = useCallback(async () => {
    const db = await getDb();
    setBoard(await getQuestBoard(db));
    setRenewableBoard(await getRenewableQuestBoard(db));
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
        setPickedEnemy((kingdom?.combat.enemyId as EnemyId) ?? THORN_GUARDIAN_ID);
      }
      return;
    }
    if (zone === 'camp') {
      router.push('/(tabs)/camp');
    }
  };

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useFocusEffect(
    useCallback(() => {
      const tabParam = params.tab;
      if (tabParam === 'quests' || tabParam === 'royaume') {
        setTab(tabParam);
      }
      if (params.openCombat === '1') {
        setCombatOpen(true);
        setForgeOpen(false);
      }
      if (params.openForge === '1') {
        setForgeOpen(true);
        setCombatOpen(false);
      }
      if (params.instanceId) {
        setHighlightId(String(params.instanceId));
        const t = setTimeout(() => setHighlightId(null), 4000);
        return () => clearTimeout(t);
      }
      return undefined;
    }, [params.tab, params.instanceId, params.openCombat, params.openForge]),
  );

  if (!board || !kingdom || !renewableBoard) {
    return (
      <Screen>
        <Body>Chargement…</Body>
      </Screen>
    );
  }

  const byState = (...states: QuestBoardEntry['state'][]) => board.entries.filter((e) => states.includes(e.state));
  const legendInProgress = [...byState('ready'), ...byState('accepted')];
  const full = board.acceptedCount >= board.maxAccepted;
  const renewFull = renewableBoard.acceptedCount >= renewableBoard.maxAccepted;
  const filterRenewable = (e: RenewableBoardEntry) =>
    questCategory === 'toutes' || questCategory === 'legendes'
      ? true
      : e.template.category === questCategory;
  const renewableVisible = renewableBoard.entries.filter(filterRenewable);
  const renewableInProgress = renewableVisible.filter((e) => e.state === 'ready' || e.state === 'active');
  const renewableOffers = renewableVisible.filter((e) => e.state === 'offered');
  const runRenewable = async (
    instanceId: string,
    action: (db: Awaited<ReturnType<typeof getDb>>) => Promise<{ message: string; ok?: boolean }>,
    flashWin?: boolean,
  ) => {
    if (questLock.current) return;
    questLock.current = true;
    setQuestBusy(true);
    try {
      const db = await getDb();
      await refreshRenewableState(db, instanceId);
      const r = await action(db);
      setQuestMsg(r.message);
      if (flashWin && r.ok === true) {
        setWinFlashId(instanceId);
        setTimeout(() => setWinFlashId(null), 1800);
      }
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
  const renderRenewable = (entries: RenewableBoardEntry[]) =>
    entries.map((e) => (
      <RenewableQuestCard
        key={e.instanceId}
        entry={e}
        busy={questBusy}
        winFlash={winFlashId === e.instanceId}
        highlighted={highlightId === e.instanceId}
        acceptDisabledReason={
          renewFull ? `Carnet renouvelable plein (${renewableBoard.maxAccepted}).` : null
        }
        onAccept={() => runRenewable(e.instanceId, (db) => acceptRenewableQuest(db, e.instanceId))}
        onClaim={() => runRenewable(e.instanceId, (db) => claimRenewableQuest(db, e.instanceId), true)}
        onAbandon={() => runRenewable(e.instanceId, (db) => abandonRenewableQuest(db, e.instanceId))}
        onStartTimer={() => runRenewable(e.instanceId, (db) => startRenewableTimer(db, e.instanceId))}
        onFailTimer={() => runRenewable(e.instanceId, (db) => failRenewableTimer(db, e.instanceId))}
        onSucceedTimer={() => runRenewable(e.instanceId, (db) => succeedRenewableTimer(db, e.instanceId), true)}
        onPartialStop={() => runRenewable(e.instanceId, (db) => partialStopRenewableTimer(db, e.instanceId))}
      />
    ));
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

  const skillReady = skillAffordable(kingdom.combat);

  return (
    <TabScrollView>
        <Body muted>Le bastion d&apos;Eloria — touche une zone sur la carte, ou ouvre les quêtes ci-dessous.</Body>
        <View style={styles.tabs}>
          <Chip label="Bastion" selected={tab === 'royaume'} onPress={() => setTab('royaume')} />
          <Chip label="Quêtes" selected={tab === 'quests'} onPress={() => setTab('quests')} />
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
            {kingdom.gold === 0 && !kingdom.combat.active && !forgeOpen && !combatOpen ? (
              <Body muted>
                Aucun or pour l&apos;instant : accepte une quête (onglet Quêtes), puis reviens améliorer la forge ici.
              </Body>
            ) : null}
            {kingdomMsg ? <Body muted>{kingdomMsg}</Body> : null}
            {forgeOpen ? (
              <FantasyPanel style={styles.forgePanel}>
                <Text style={styles.forgeTitle}>
                  Forge · {FORGE_LEVEL_LABELS[kingdom.forge.level]} (niv. {kingdom.forge.level})
                </Text>
                <Text style={styles.forgeMeta}>
                  Dégâts {kingdom.forge.baseDamagePreview}
                  {kingdom.forge.nextLevel && kingdom.forge.upgradeCost
                    ? ` · prochain : ${FORGE_LEVEL_LABELS[kingdom.forge.nextLevel]} — ${kingdom.forge.upgradeCost} or`
                    : ' · niveau max'}
                </Text>
                {kingdom.forge.nextLevel && kingdom.forge.upgradeCost ? (
                  forgeConfirm ? (
                    <View style={styles.forgeActions}>
                      <Text style={styles.forgeConfirm}>Dépenser {kingdom.forge.upgradeCost} or ?</Text>
                      <Button
                        label="Confirmer"
                        disabled={kingdomBusy || !kingdom.canUpgrade}
                        onPress={() =>
                          runKingdom(async (db) => {
                            const r = await confirmForgeUpgrade(db, kingdom.forge.level);
                            setForgeConfirm(false);
                            return { message: r.message };
                          })
                        }
                        compact
                      />
                      <Button label="Annuler" variant="ghost" onPress={() => setForgeConfirm(false)} compact />
                    </View>
                  ) : (
                    <Button
                      label={
                        kingdom.canUpgrade
                          ? `Améliorer · ${kingdom.forge.upgradeCost} or`
                          : `Améliorer · ${kingdom.forge.upgradeCost} or (insuffisant)`
                      }
                      disabled={!kingdom.canUpgrade || kingdomBusy}
                      onPress={() => setForgeConfirm(true)}
                      compact
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
              <FantasyPanel>
                <Text style={styles.section}>Choisir l&apos;adversaire</Text>
                <View style={styles.enemyRow}>
                  {kingdom.enemies.map((e) => (
                    <Chip
                      key={e.id}
                      label={`${e.name} (${e.baseHp} PV)`}
                      selected={pickedEnemy === e.id}
                      onPress={() => setPickedEnemy(e.id as EnemyId)}
                    />
                  ))}
                </View>
                <Button
                  label="Engager le combat"
                  onPress={() =>
                    runKingdom(async (db) => {
                      const r = await startCombat(db, pickedEnemy);
                      return { message: r.message };
                    })
                  }
                  disabled={kingdomBusy}
                />
              </FantasyPanel>
            ) : null}
          </>
        ) : null}
        {tab === 'quests' ? (
          <>
            <FantasyPanel accent>
              <Text style={styles.goldValue}>{renewableBoard.goldBalance} or</Text>
              <Body muted>
                {`Renouvelables : ${renewableBoard.acceptedCount}/${renewableBoard.maxAccepted} · Or quêtes aujourd'hui : encore ${renewableBoard.dailyGoldRemaining} / cap journalier.`}
              </Body>
            </FantasyPanel>
            {questMsg ? <Body muted>{questMsg}</Body> : null}
            <View style={styles.tabs}>
              <Chip label="Toutes" selected={questCategory === 'toutes'} onPress={() => setQuestCategory('toutes')} />
              {(Object.keys(CATEGORY_LABELS) as RenewableQuestCategory[]).map((c) => (
                <Chip
                  key={c}
                  label={CATEGORY_LABELS[c]}
                  selected={questCategory === c}
                  onPress={() => setQuestCategory(c)}
                />
              ))}
            </View>
            {questCategory !== 'legendes' ? (
              <>
                <Text style={styles.section}>Recommandées</Text>
                {renewableBoard.recommended.filter(filterRenewable).length === 0 ? (
                  <Body muted>Aucune quête recommandée pour ce filtre.</Body>
                ) : (
                  renderRenewable(renewableBoard.recommended.filter(filterRenewable))
                )}
                <Text style={styles.section}>En cours</Text>
                {renewableInProgress.length === 0 ? (
                  <EmptyState title="Aucune quête renouvelable en cours" hint="Accepte une quête ci-dessous." />
                ) : (
                  renderRenewable(renewableInProgress)
                )}
                <Text style={styles.section}>Disponibles</Text>
                {renewableOffers.length === 0 ? (
                  <Body muted>Pas d&apos;offre pour l&apos;instant — reviens plus tard.</Body>
                ) : (
                  renderRenewable(renewableOffers)
                )}
              </>
            ) : null}
            {questCategory === 'legendes' || questCategory === 'toutes' ? (
              <>
                <Text style={styles.section}>Légendes (quêtes uniques)</Text>
                {legendInProgress.length === 0 && byState('available').length === 0 ? (
                  <Body muted>Les quêtes légendaires sont terminées ou en attente.</Body>
                ) : (
                  <>
                    {renderCards(legendInProgress)}
                    {renderCards(byState('available'))}
                  </>
                )}
                {byState('claimed').length ? renderCards(byState('claimed')) : null}
              </>
            ) : null}
          </>
        ) : null}
    </TabScrollView>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.sm, gap: 0 },
  section: { ...typography.label, color: colors.gold, marginTop: spacing.lg },
  sectionSecondary: { color: colors.muted, marginTop: spacing.md },
  goldValue: { ...typography.title, color: colors.gold, marginBottom: spacing.xs },
  enemyRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.sm, gap: spacing.xs },
  forgePanel: { marginTop: spacing.sm },
  forgeTitle: { ...typography.subtitle, color: colors.gold, marginBottom: spacing.xs },
  forgeMeta: { ...typography.caption, color: colors.muted, marginBottom: spacing.sm, lineHeight: 18 },
  forgeActions: { gap: spacing.xs },
  forgeConfirm: { ...typography.caption, color: colors.ink, marginBottom: spacing.xs },
});