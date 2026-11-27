import { applyPlayerAction, createInitialCombat, skillAffordable } from '../domain/combat/combatEngine';
import {
  CONCENTRATION_START,
  HERO_BASE_DAMAGE,
  MIST_WOLF_ID,
  SKILL_CONCENTRATION_COST,
  THORN_GUARDIAN_ID,
} from '../data/content/kingdom';
import {
  getKingdomView,
  performCombatAction,
  startCombat,
} from '../domain/services/kingdomService';
import { migrate } from '../data/db/client';
import { nodeSqliteAvailable, openNodeSqliteDb, type TestDb } from './helpers/nodeSqliteDb';

const HAS_SQLITE = nodeSqliteAvailable();
const suite = HAS_SQLITE ? describe : describe.skip;

suite('006B — combat visuel 2.0', () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await openNodeSqliteDb();
  });
  afterEach(() => t.close());

  test('concentration : attaque sans coût, défense restaure, compétence coûte 2', () => {
    const stats = { baseDamage: HERO_BASE_DAMAGE, forgeLevel: 0, classId: 'rodeur' as const };
    let s = createInitialCombat(0);
    expect(s.concentration).toBe(CONCENTRATION_START);
    s = applyPlayerAction(s, 'attack', stats);
    expect(s.concentration).toBe(CONCENTRATION_START);
    s = applyPlayerAction(s, 'defend', stats);
    expect(s.concentration).toBe(CONCENTRATION_START + 1);
    s = applyPlayerAction(s, 'skill', stats);
    expect(s.concentration).toBe(CONCENTRATION_START + 1 - SKILL_CONCENTRATION_COST);
  });

  test('compétence refusée si concentration insuffisante', async () => {
    await startCombat(t.db, THORN_GUARDIAN_ID);
    let view = await getKingdomView(t.db);
    await t.db.runAsync('UPDATE kingdom_combat SET concentration = 0 WHERE id = 1');
    view = await getKingdomView(t.db);
    expect(skillAffordable(view.combat)).toBe(false);
    const r = await performCombatAction(t.db, 'skill', view.combat.turnNumber, view.combat.updatedAt);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('no_concentration');
  });

  test('deux ennemis : choix persistant par combat', async () => {
    await startCombat(t.db, MIST_WOLF_ID);
    const view = await getKingdomView(t.db);
    expect(view.combat.enemyId).toBe(MIST_WOLF_ID);
    expect(view.combat.enemyHpMax).toBe(24);
    await performCombatAction(t.db, 'attack', view.combat.turnNumber, view.combat.updatedAt);
    const mid = await getKingdomView(t.db);
    expect(mid.combat.enemyId).toBe(MIST_WOLF_ID);
  });

  test('victoire possible sans forge (deux adversaires)', () => {
    for (const enemyId of [THORN_GUARDIAN_ID, MIST_WOLF_ID] as const) {
      let state = createInitialCombat(0, enemyId);
      const stats = { baseDamage: HERO_BASE_DAMAGE, forgeLevel: 0, classId: 'rodeur' as const };
      let turns = 0;
      while (!state.outcome && turns < 24) {
        if (state.enemyIntent === 'heavy') state = applyPlayerAction(state, 'defend', stats);
        else if (skillAffordable(state)) state = applyPlayerAction(state, 'skill', stats);
        else state = applyPlayerAction(state, 'attack', stats);
        turns += 1;
      }
      expect(state.outcome).toBe('victory');
    }
  });

  test('migration 008→009 : power → heavy et concentration par défaut', async () => {
    await t.db.runAsync(`DELETE FROM schema_migrations WHERE version IN (9, 10)`);
    await t.db.runAsync(`DROP TABLE kingdom_combat`);
    await t.db.execAsync(`
      CREATE TABLE kingdom_combat (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        active INTEGER NOT NULL DEFAULT 1,
        hero_hp INTEGER NOT NULL DEFAULT 20,
        hero_hp_max INTEGER NOT NULL DEFAULT 28,
        enemy_hp INTEGER NOT NULL DEFAULT 10,
        enemy_hp_max INTEGER NOT NULL DEFAULT 24,
        turn_number INTEGER NOT NULL DEFAULT 2,
        enemy_intent TEXT NOT NULL DEFAULT 'power',
        hero_guarding INTEGER NOT NULL DEFAULT 0,
        skill_cooldown INTEGER NOT NULL DEFAULT 2,
        outcome TEXT,
        log_json TEXT NOT NULL DEFAULT '[]',
        first_win_rewarded INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      INSERT INTO kingdom_combat VALUES (1,1,20,28,10,24,2,'power',0,2,NULL,'[]',0,'2020-01-01');
    `);
    await migrate(t.db);
    const view = await getKingdomView(t.db);
    expect(view.combat.enemyIntent).toBe('heavy');
    expect(view.combat.concentration).toBe(0);
    expect(view.combat.enemyId).toBe(THORN_GUARDIAN_ID);
  });
});