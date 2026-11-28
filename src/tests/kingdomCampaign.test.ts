import {
  applyPlayerAction,
  createInitialCombat,
  skillAffordable,
} from '../domain/combat/combatEngine';
import { CAMPAIGN_ENEMY_DEFS } from '../data/content/eloriaCampaign';
import {
  ELORIA_CAMPAIGN_STAGES,
  campaignFirstWinKey,
  CAMPAIGN_TROPHY_ITEM_ID,
  stageById,
  stageByNumber,
} from '../data/content/eloriaCampaign';
import { HERO_BASE_DAMAGE, THORN_GUARDIAN_ID } from '../data/content/kingdom';
import type { ClassId } from '../domain/models/types';
import { exportBackupPayload, importBackupPayload } from '../domain/services/backupService';
import {
  getKingdomView,
  performCombatAction,
  startCampaignCombat,
  startCombat,
} from '../domain/services/kingdomService';
import * as rpgRepo from '../data/db/repositories/rpgRepo';
import * as combatVictoryRepo from '../data/db/repositories/combatVictoryRepo';
import {
  acceptRenewableQuest,
  claimRenewableQuest,
  getRenewableQuestBoard,
} from '../domain/services/renewableQuestService';
import type { Db } from '../data/db/client';
import { nodeSqliteAvailable, openNodeSqliteDb, type TestDb } from './helpers/nodeSqliteDb';

const HAS_SQLITE = nodeSqliteAvailable();
const suite = HAS_SQLITE ? describe : describe.skip;

function tactical(classId: ClassId, state: ReturnType<typeof createInitialCombat>) {
  const stats = { baseDamage: HERO_BASE_DAMAGE, forgeLevel: 0, classId };
  if (classId === 'sage') {
    if (state.enemyIntent === 'heavy') return applyPlayerAction(state, 'defend', stats);
    if (skillAffordable(state) && state.heroHp <= 15) return applyPlayerAction(state, 'skill', stats);
    return applyPlayerAction(state, 'attack', stats);
  }
  if (state.enemyIntent === 'heavy') {
    if (classId === 'gardien' && skillAffordable(state)) return applyPlayerAction(state, 'skill', stats);
    return applyPlayerAction(state, 'defend', stats);
  }
  if ((classId === 'rodeur' || classId === 'artisan') && skillAffordable(state)) {
    return applyPlayerAction(state, 'skill', stats);
  }
  if (state.concentration === 1 && state.enemyIntent === 'brace') return applyPlayerAction(state, 'attack', stats);
  if (state.concentration < 2 && state.enemyIntent !== 'normal') return applyPlayerAction(state, 'defend', stats);
  return applyPlayerAction(state, 'attack', stats);
}

async function winCampaignFight(db: Db, stageId: string, classId: ClassId = 'rodeur') {
  await db.runAsync(`UPDATE profiles SET class_id = ?`, classId);
  const stageN = stageById(stageId)?.number ?? 1;
  const start = await startCampaignCombat(db, stageId);
  expect(start.ok).toBe(true);
  let view = await getKingdomView(db);
  let guard = 0;
  const maxTurns = stageN === 10 ? 96 : 42;
  while (!view.combat.outcome && guard < maxTurns) {
    const s = view.combat;
    let action: 'attack' | 'defend' | 'skill' = 'attack';
    if (classId === 'sage') {
      if (s.enemyIntent === 'heavy') action = 'defend';
      else if (skillAffordable(s)) action = 'skill';
    } else if (s.enemyIntent === 'heavy') {
      action = classId === 'gardien' && skillAffordable(s) ? 'skill' : 'defend';
    } else if (skillAffordable(s) && (classId === 'rodeur' || classId === 'artisan')) {
      action = 'skill';
    } else if (s.concentration < 2 && s.enemyIntent !== 'normal') {
      action = 'defend';
    }
    await performCombatAction(db, action, s.turnNumber, s.updatedAt);
    view = await getKingdomView(db);
    guard += 1;
  }
  expect(view.combat.outcome).toBe('victory');
  return view;
}

suite('V1-05A — Campagne d\'Eloria', () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await openNodeSqliteDb();
  });
  afterEach(() => t.close());

  test('1 — palier 1 débloqué au départ', async () => {
    const view = await getKingdomView(t.db);
    expect(view.campaign.highestUnlocked).toBe(1);
    expect(view.campaign.stages[0]?.status).toBe('unlocked');
  });

  test('2 — palier 2 verrouillé au départ', async () => {
    const view = await getKingdomView(t.db);
    expect(view.campaign.stages[1]?.status).toBe('locked');
  });

  test('3 — victoire étape 1 débloque l\'étape 2', async () => {
    const after = await winCampaignFight(t.db, 'eloria_forest_01');
    expect(after.combat.outcome).toBe('victory');
    expect(after.campaign.highestUnlocked).toBe(2);
    expect(after.campaign.stages[1]?.status).toBe('unlocked');
  });

  test('4 — défaite conserve la progression', async () => {
    await startCampaignCombat(t.db, 'eloria_forest_01');
    let view = await getKingdomView(t.db);
    await t.db.runAsync(
      `UPDATE kingdom_combat SET hero_hp = 0, outcome = 'defeat', active = 0 WHERE id = 1`,
    );
    await t.db.runAsync(
      `UPDATE kingdom_campaign SET stage_stats_json = '{"eloria_forest_01":{"wins":0,"defeats":1}}' WHERE id = 1`,
    );
    view = await getKingdomView(t.db);
    expect(view.campaign.highestUnlocked).toBe(1);
    expect(view.campaign.stages[0]?.status).toBe('unlocked');
  });

  test('5 — 10 paliers définis et ordonnés', () => {
    expect(ELORIA_CAMPAIGN_STAGES).toHaveLength(10);
    const nums = ELORIA_CAMPAIGN_STAGES.map((s) => s.number);
    expect(nums).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test('6 — boss distinct des autres ennemis', () => {
    const boss = CAMPAIGN_ENEMY_DEFS.forest_mist_sovereign;
    const m1 = CAMPAIGN_ENEMY_DEFS.forest_mossling;
    expect(boss.bossPhaseShift).toBeDefined();
    expect(boss.baseHp).toBeGreaterThanOrEqual(m1.baseHp);
    expect(boss.intentPattern).not.toEqual(m1.intentPattern);
  });

  test('7 — intents ennemis déterministes', () => {
    const a = createInitialCombat(0, 'forest_howler');
    const b = createInitialCombat(0, 'forest_howler');
    expect(a.enemyIntent).toBe(b.enemyIntent);
    expect(a.enemyIntentIndex).toBe(b.enemyIntentIndex);
  });

  test('8 — boss change de stratégie sous 50 % PV', () => {
    let s = createInitialCombat(0, 'forest_mist_sovereign');
    const stats = { baseDamage: HERO_BASE_DAMAGE, forgeLevel: 0, classId: 'rodeur' as const };
    let shifted = false;
    while (!s.outcome && !shifted && s.turnNumber < 28) {
      const act = s.enemyIntent === 'heavy' ? 'defend' : 'attack';
      s = applyPlayerAction(s, act, stats);
      if (s.enemyPhase >= 1) shifted = true;
    }
    expect(shifted).toBe(true);
    expect(s.log.some((l) => l.includes('change de rythme'))).toBe(true);
  });

  test.each(['rodeur', 'gardien', 'sage', 'artisan'] as const)(
    '9 — classe %s vainc le boss sans forge',
    (classId) => {
      let state = createInitialCombat(0, 'forest_mist_sovereign');
      const stats = { baseDamage: HERO_BASE_DAMAGE, forgeLevel: 0, classId };
      let guard = 0;
      while (!state.outcome && guard < 56) {
        state = tactical(classId, state);
        guard += 1;
      }
      expect(state.outcome).toBe('victory');
    },
  );

  test('10 — reprise combat campagne interrompu', async () => {
    await startCampaignCombat(t.db, 'eloria_forest_01');
    let view = await getKingdomView(t.db);
    await performCombatAction(t.db, 'attack', view.combat.turnNumber, view.combat.updatedAt);
    const mid = await getKingdomView(t.db);
    const resume = await startCampaignCombat(t.db, 'eloria_forest_01');
    expect(resume.ok).toBe(true);
    const after = await getKingdomView(t.db);
    expect(after.combat.turnNumber).toBeGreaterThan(mid.combat.turnNumber - 1);
    expect(after.combat.combatMode).toBe('campaign');
  });

  test('11 — double clic : un seul tour résolu', async () => {
    await startCampaignCombat(t.db, 'eloria_forest_01');
    const view = await getKingdomView(t.db);
    const turn = view.combat.turnNumber;
    const rev = view.combat.updatedAt;
    const r1 = await performCombatAction(t.db, 'attack', turn, rev);
    const r2 = await performCombatAction(t.db, 'attack', turn, rev);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(false);
    expect(r2.code).toBe('stale');
  });

  test('12 — rejouer sans double or', async () => {
    await winCampaignFight(t.db, 'eloria_forest_01');
    const gold1 = await rpgRepo.getGoldBalance(t.db);
    const replay = await startCampaignCombat(t.db, 'eloria_forest_01');
    expect(replay.ok).toBe(true);
    await winCampaignFight(t.db, 'eloria_forest_01');
    const gold2 = await rpgRepo.getGoldBalance(t.db);
    expect(gold2).toBe(gold1);
  });

  test('13 — trophée boss unique', async () => {
    await t.db.runAsync(`UPDATE kingdom_campaign SET highest_unlocked = 10`);
    const stage10 = stageByNumber(10)!;
    await winCampaignFight(t.db, stage10.id);
    const inv1 = await t.db.getFirstAsync(`SELECT quantity FROM inventory_items WHERE item_id = ?`, CAMPAIGN_TROPHY_ITEM_ID);
    expect(inv1).toBeTruthy();
    const dup = await rpgRepo.grantItemOnce(t.db, CAMPAIGN_TROPHY_ITEM_ID);
    expect(dup).toBe('duplicate');
    const rows = await t.db.getAllAsync(`SELECT quantity FROM inventory_items WHERE item_id = ?`, CAMPAIGN_TROPHY_ITEM_ID);
    expect(rows).toHaveLength(1);
  });

  test('14 — récompenses atomiques (or + palier)', async () => {
    await winCampaignFight(t.db, 'eloria_forest_01');
    const key = campaignFirstWinKey('eloria_forest_01');
    const row = await t.db.getFirstAsync<{ amount: number }>(
      `SELECT amount FROM wallet_ledger WHERE idempotency_key = ?`,
      key,
    );
    expect(Number(row?.amount)).toBe(3);
    const view = await getKingdomView(t.db);
    expect(view.campaign.stages[0]?.status).toBe('cleared');
  });

  test('15 — arène historique préservée', async () => {
    await startCombat(t.db, THORN_GUARDIAN_ID);
    const view = await getKingdomView(t.db);
    expect(view.combat.combatMode).toBe('arena');
    const blocked = await startCampaignCombat(t.db, 'eloria_forest_01');
    expect(blocked.ok).toBe(false);
    expect(blocked.code).toBe('arena_active');
  });

  test('16 — quêtes combat legacy (gardien)', async () => {
    await startCombat(t.db, THORN_GUARDIAN_ID);
    let view = await getKingdomView(t.db);
    let guard = 0;
    while (!view.combat.outcome && guard < 40) {
      const s = view.combat;
      let act: 'attack' | 'defend' | 'skill' = 'attack';
      if (s.enemyIntent === 'heavy') act = 'defend';
      else if (skillAffordable(s)) act = 'skill';
      await performCombatAction(t.db, act, s.turnNumber, s.updatedAt);
      view = await getKingdomView(t.db);
      guard += 1;
    }
    expect(view.combat.outcome).toBe('victory');
    const count = await combatVictoryRepo.countVictoriesAfter(
      t.db,
      THORN_GUARDIAN_ID,
      '1970-01-01T00:00:00.000Z',
    );
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('17 — migration 019 appliquée + combat campagne actif conservé', async () => {
    const mig = await t.db.getFirstAsync(`SELECT version FROM schema_migrations WHERE version = 19`);
    expect(mig).toBeTruthy();
    await startCampaignCombat(t.db, 'eloria_forest_01');
    let view = await getKingdomView(t.db);
    await performCombatAction(t.db, 'attack', view.combat.turnNumber, view.combat.updatedAt);
    view = await getKingdomView(t.db);
    expect(view.combat.combatMode).toBe('campaign');
    expect(view.combat.campaignStageId).toBe('eloria_forest_01');
    expect(view.combat.active).toBe(true);
  });

  test('18 — backup/restore campagne', async () => {
    await winCampaignFight(t.db, 'eloria_forest_01');
    const { manifest, data } = await exportBackupPayload(t.db);
    const db2 = await openNodeSqliteDb();
    try {
      await importBackupPayload(db2.db, manifest, data);
      const view = await getKingdomView(db2.db);
      expect(view.campaign.stages[0]?.status).toBe('cleared');
      expect(view.campaign.highestUnlocked).toBe(2);
    } finally {
      db2.close();
    }
  });

  test('19 — XP/habitude inchangés après victoire campagne', async () => {
    const xpBefore = await t.db.getFirstAsync<{ s: number }>(`SELECT COALESCE(SUM(xp_amount),0) AS s FROM xp_ledger`);
    await winCampaignFight(t.db, 'eloria_forest_01');
    const xpAfter = await t.db.getFirstAsync<{ s: number }>(`SELECT COALESCE(SUM(xp_amount),0) AS s FROM xp_ledger`);
    expect(xpAfter?.s).toBe(xpBefore?.s);
  });

  test('20 — victoire campagne n\'alimente pas quête renouvelable sans validation', async () => {
    await winCampaignFight(t.db, 'eloria_forest_01');
    const board = await getRenewableQuestBoard(t.db);
    const offer = board.entries.find((o) => o.template.id === 'rnw_beat_thorn' && o.state === 'offered');
    expect(offer).toBeTruthy();
    await acceptRenewableQuest(t.db, offer!.instanceId);
    const claim = await claimRenewableQuest(t.db, offer!.instanceId);
    expect(claim.ok).toBe(false);
  });
});