import { applyPlayerAction, createInitialCombat, skillAffordable } from '../domain/combat/combatEngine';
import {
  HERO_BASE_DAMAGE,
  MIST_WOLF_ID,
  THORN_GUARDIAN_ID,
} from '../data/content/kingdom';
import type { ClassId } from '../domain/models/types';
import { exportBackupPayload, importBackupPayload } from '../domain/services/backupService';
import {
  confirmForgeUpgrade,
  getKingdomView,
  performCombatAction,
  startCombat,
} from '../domain/services/kingdomService';
import * as rpgRepo from '../data/db/repositories/rpgRepo';
import { migrate } from '../data/db/client';
import { nodeSqliteAvailable, openNodeSqliteDb, type TestDb } from './helpers/nodeSqliteDb';

const HAS_SQLITE = nodeSqliteAvailable();
const suite = HAS_SQLITE ? describe : describe.skip;

function tacticalAction(classId: ClassId, state: ReturnType<typeof createInitialCombat>) {
  const stats = { baseDamage: HERO_BASE_DAMAGE, forgeLevel: 0, classId };
  if (classId === 'sage') {
    if (state.enemyIntent === 'heavy') return applyPlayerAction(state, 'defend', stats);
    if (skillAffordable(state)) return applyPlayerAction(state, 'skill', stats);
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

function simulateAttackOnly(enemyId: typeof THORN_GUARDIAN_ID | typeof MIST_WOLF_ID, classId: ClassId) {
  let state = createInitialCombat(0, enemyId);
  const stats = { baseDamage: HERO_BASE_DAMAGE, forgeLevel: 0, classId };
  let turns = 0;
  while (!state.outcome && turns < 16) {
    state = applyPlayerAction(state, 'attack', stats);
    turns += 1;
  }
  return { state, turns };
}

function simulateTactical(enemyId: typeof THORN_GUARDIAN_ID | typeof MIST_WOLF_ID, classId: ClassId) {
  let state = createInitialCombat(0, enemyId);
  let turns = 0;
  while (!state.outcome && turns < 16) {
    state = tacticalAction(classId, state);
    turns += 1;
  }
  return { state, turns };
}

suite('006B-R — fiabilité combat + backups', () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await openNodeSqliteDb();
  });
  afterEach(() => t.close());

  test('attaque seule : défaite sur les deux adversaires (4 classes, forge 0)', () => {
    const classes: ClassId[] = ['rodeur', 'gardien', 'sage', 'artisan'];
    for (const enemyId of [THORN_GUARDIAN_ID, MIST_WOLF_ID] as const) {
      for (const classId of classes) {
        const { state, turns } = simulateAttackOnly(enemyId, classId);
        expect(state.outcome).toBe('defeat');
        expect(turns).toBeGreaterThanOrEqual(4);
        expect(turns).toBeLessThanOrEqual(8);
      }
    }
  });

  test('tactique : victoire 4 classes, deux ennemis, forge 0, 5–12 tours', () => {
    const classes: ClassId[] = ['rodeur', 'gardien', 'sage', 'artisan'];
    for (const enemyId of [THORN_GUARDIAN_ID, MIST_WOLF_ID] as const) {
      for (const classId of classes) {
        const { state, turns } = simulateTactical(enemyId, classId);
        expect(state.outcome).toBe('victory');
        expect(turns).toBeGreaterThanOrEqual(5);
        expect(turns).toBeLessThanOrEqual(12);
      }
    }
  });

  test('backup 008→009 : combat en cours, power, cooldown, forge, or', async () => {
    await t.db.runAsync(`DELETE FROM schema_migrations WHERE version >= 9`);
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
      INSERT INTO kingdom_combat VALUES (1,1,15,28,12,25,3,'power',0,2,NULL,'[]',0,'2020-01-01');
    `);
    await rpgRepo.addGold(t.db, 25, 'test', 'bak-fixture-gold');
    await t.db.runAsync(`INSERT OR REPLACE INTO kingdom_buildings (building_id, level, updated_at) VALUES ('forge', 2, '2020-01-01')`);
    await migrate(t.db);
    const view = await getKingdomView(t.db);
    expect(view.combat.enemyIntent).toBe('heavy');
    expect(view.combat.concentration).toBe(0);
    expect(view.combat.heroHp).toBe(15);
    expect(view.combat.active).toBe(true);
    expect(view.forge.level).toBe(2);
    const gold = await t.db.getFirstAsync<{ s: number }>(
      'SELECT COALESCE(SUM(amount),0) AS s FROM wallet_ledger WHERE resource = ?',
      'gold',
    );
    expect(Number(gold?.s)).toBe(25);
    await performCombatAction(t.db, 'defend', view.combat.turnNumber, view.combat.updatedAt);
    const mid = await getKingdomView(t.db);
    expect(mid.combat.turnNumber).toBe(4);
    expect(mid.combat.enemyIntent).toBeTruthy();
  });

  test('backup export/import 009 : roundtrip avec combat actif', async () => {
    await rpgRepo.addGold(t.db, 15, 'test', 'rt-gold');
    await confirmForgeUpgrade(t.db, 0);
    await startCombat(t.db, MIST_WOLF_ID);
    const snap = await getKingdomView(t.db);
    const { manifest, data } = await exportBackupPayload(t.db, '0.2.0');
    let target = await openNodeSqliteDb();
    await importBackupPayload(target.db, manifest, data);
    const after = await getKingdomView(target.db);
    expect(after.combat.active).toBe(true);
    expect(after.combat.enemyId).toBe(MIST_WOLF_ID);
    expect(after.combat.heroHp).toBe(snap.combat.heroHp);
    expect(after.forge.level).toBe(1);
    target.close();
  });

  test('backup sans lignes royaume : défauts puis combat jouable', async () => {
    const { manifest, data } = await exportBackupPayload(t.db, '0.2.0');
    delete data.kingdom_buildings;
    delete data.kingdom_combat;
    await importBackupPayload(t.db, manifest, data);
    const view = await getKingdomView(t.db);
    expect(view.forge.level).toBe(0);
    await startCombat(t.db);
    const afterStart = await getKingdomView(t.db);
    expect(afterStart.combat.active).toBe(true);
    expect(afterStart.combat.heroHp).toBeGreaterThan(0);
  });
});