import {
  applyPlayerAction,
  createInitialCombat,
  skillAffordable,
} from '../domain/combat/combatEngine';
import { ELORIA_CAMPAIGN_STAGES, stageByNumber } from '../data/content/eloriaCampaign';
import { HERO_BASE_DAMAGE } from '../data/content/kingdom';
import type { ClassId } from '../domain/models/types';
import {
  dismissCombat,
  getKingdomView,
  performCombatAction,
  startCampaignCombat,
  startCombat,
} from '../domain/services/kingdomService';
import * as campaignRepo from '../data/db/repositories/campaignRepo';
import * as rpgRepo from '../data/db/repositories/rpgRepo';
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

async function winCampaignFight(db: Awaited<ReturnType<typeof openNodeSqliteDb>>['db'], stageId: string, classId: ClassId = 'rodeur') {
  await db.runAsync(`UPDATE profiles SET class_id = ?`, classId);
  const start = await startCampaignCombat(db, stageId);
  expect(start.ok).toBe(true);
  let view = await getKingdomView(db);
  let guard = 0;
  const stageN = ELORIA_CAMPAIGN_STAGES.find((s) => s.id === stageId)?.number ?? 1;
  const maxTurns = stageN === 10 ? 96 : stageN >= 8 ? 64 : 48;
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

suite('V1-05A-R — intégrité campagne', () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await openNodeSqliteDb();
  });
  afterEach(() => t.close());

  test('boss — frappe lourde annoncée résolue au franchissement du seuil', () => {
    const stats = { baseDamage: HERO_BASE_DAMAGE, forgeLevel: 0, classId: 'rodeur' as const };
    let s = createInitialCombat(0, 'forest_mist_sovereign');
    while (s.enemyIntent !== 'heavy' && !s.outcome && s.turnNumber < 12) {
      s = applyPlayerAction(s, 'defend', stats);
    }
    expect(s.enemyIntent).toBe('heavy');
    s = { ...s, enemyHp: 9, enemyHpMax: 18, enemyPhase: 0 };
    s = applyPlayerAction(s, 'attack', stats);
    expect(s.outcome).toBeNull();
    expect(s.log.some((l) => l.includes('frappe lourde'))).toBe(true);
    expect(s.enemyPhase).toBe(1);
    expect(s.log.filter((l) => l.includes('change de rythme'))).toHaveLength(1);
  });

  test('boss — mort léthale au seuil sans annonce de phase', () => {
    const stats = { baseDamage: HERO_BASE_DAMAGE, forgeLevel: 0, classId: 'rodeur' as const };
    let s = createInitialCombat(0, 'forest_mist_sovereign');
    s = { ...s, enemyHp: 5, enemyHpMax: 18, enemyIntent: 'heavy', enemyPhase: 0 };
    s = applyPlayerAction(s, 'attack', stats);
    expect(s.outcome).toBe('victory');
    expect(s.enemyPhase).toBe(0);
    expect(s.log.some((l) => l.includes('change de rythme'))).toBe(false);
  });

  test('reprise combat campagne — phase boss conservée', async () => {
    const stage10 = stageByNumber(10)!;
    await t.db.runAsync(`UPDATE kingdom_campaign SET highest_unlocked = 10`);
    await startCampaignCombat(t.db, stage10.id);
    await t.db.runAsync(
      `UPDATE kingdom_combat SET enemy_phase = 1, enemy_hp = 8, enemy_hp_max = 18, active = 1, outcome = NULL WHERE id = 1`,
    );
    const resume = await startCampaignCombat(t.db, stage10.id);
    expect(resume.ok).toBe(true);
    const view = await getKingdomView(t.db);
    expect(view.combat.enemyPhase).toBe(1);
    expect(view.combat.enemyHp).toBe(8);
  });

  test('arène bloquée si campagne active — pas de modification croisée', async () => {
    await startCampaignCombat(t.db, 'eloria_forest_01');
    const arena = await startCombat(t.db, 'thorn_guardian');
    expect(arena.ok).toBe(false);
    expect(arena.code).toBe('campaign_active');
    const view = await getKingdomView(t.db);
    expect(view.combat.combatMode).toBe('campaign');
    expect(view.combat.campaignStageId).toBe('eloria_forest_01');
  });

  test('rejouer étape — parcours service sans reset SQL', async () => {
    await winCampaignFight(t.db, 'eloria_forest_01');
    const gold1 = await rpgRepo.getGoldBalance(t.db);
    const progress1 = await campaignRepo.getCampaignProgress(t.db);
    const wins1 = progress1.stageStats.eloria_forest_01?.wins ?? 0;
    expect(wins1).toBeGreaterThanOrEqual(1);

    const replay = await startCampaignCombat(t.db, 'eloria_forest_01');
    expect(replay.ok).toBe(true);
    let mid = await getKingdomView(t.db);
    expect(mid.combat.active).toBe(true);
    expect(mid.combat.outcome).toBeNull();
    expect(mid.combat.turnNumber).toBe(1);

    await winCampaignFight(t.db, 'eloria_forest_01');
    const gold2 = await rpgRepo.getGoldBalance(t.db);
    expect(gold2).toBe(gold1);
    const progress2 = await campaignRepo.getCampaignProgress(t.db);
    expect(progress2.stageStats.eloria_forest_01?.wins).toBe(wins1 + 1);
    const view = await getKingdomView(t.db);
    expect(view.campaign.highestUnlocked).toBe(2);
    expect(view.campaign.stages[1]?.status).toBe('unlocked');
  });

  test('rejouer après résultat — dismiss puis nouvelle rencontre', async () => {
    await winCampaignFight(t.db, 'eloria_forest_01');
    let view = await getKingdomView(t.db);
    expect(view.combat.outcome).toBe('victory');
    await dismissCombat(t.db);
    const again = await startCampaignCombat(t.db, 'eloria_forest_01');
    expect(again.ok).toBe(true);
    view = await getKingdomView(t.db);
    expect(view.combat.active).toBe(true);
    expect(view.combat.outcome).toBeNull();
  });

  test('combats classiques arène — non-régression rapide', () => {
    const stats = { baseDamage: HERO_BASE_DAMAGE, forgeLevel: 0, classId: 'rodeur' as const };
    let s = createInitialCombat(0, 'thorn_guardian');
    let guard = 0;
    while (!s.outcome && guard < 16) {
      s = tactical('rodeur', s);
      guard += 1;
    }
    expect(s.outcome).toBe('victory');
  });

  const classes: ClassId[] = ['rodeur', 'gardien', 'sage', 'artisan'];
  const smokeStages = ELORIA_CAMPAIGN_STAGES.filter((s) => s.number <= 3);
  test.each(classes)('balance smoke — paliers 1–3 (%s, forge 0)', async (classId) => {
    await t.db.runAsync(`UPDATE profiles SET class_id = ?`, classId);
    for (const stage of smokeStages) {
      const view = await winCampaignFight(t.db, stage.id, classId);
      expect(view.combat.outcome).toBe('victory');
      await dismissCombat(t.db);
    }
  });

  test.each(classes)('balance moteur — boss palier 10 (%s, forge 0)', (classId) => {
    let state = createInitialCombat(0, 'forest_mist_sovereign');
    let guard = 0;
    while (!state.outcome && guard < 64) {
      state = tactical(classId, state);
      guard += 1;
    }
    expect(state.outcome).toBe('victory');
  });
});