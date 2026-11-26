import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { applyPlayerAction, createInitialCombat } from '../domain/combat/combatEngine';
import * as rpgRepo from '../data/db/repositories/rpgRepo';
import * as kingdomRepo from '../data/db/repositories/kingdomRepo';
import {
  confirmForgeUpgrade,
  dismissCombat,
  forgeUpgradeKey,
  getKingdomView,
  performCombatAction,
  startCombat,
} from '../domain/services/kingdomService';
import { FIRST_WIN_ITEM_ID, FORGE_UPGRADE_COST, HERO_BASE_DAMAGE } from '../data/content/kingdom';
import { claimQuest, acceptQuest } from '../domain/services/questService';
import { recordBreathingSession } from '../domain/services/toolsService';
import { nodeSqliteAvailable, openNodeSqliteDb, type TestDb } from './helpers/nodeSqliteDb';

const HAS_SQLITE = nodeSqliteAvailable();
if (!HAS_SQLITE) {
  console.warn('[SKIP] kingdomBastion — node:sqlite indisponible');
}
const suite = HAS_SQLITE ? describe : describe.skip;

async function ledgerSum(t: TestDb, resource: string) {
  const r = await t.db.getFirstAsync<{ s: number }>(
    'SELECT COALESCE(SUM(amount),0) AS s FROM wallet_ledger WHERE resource = ?',
    resource,
  );
  return Number(r?.s ?? 0);
}

async function seedGold(t: TestDb, amount: number) {
  await rpgRepo.addGold(t.db, amount, 'test', `test-gold-${amount}-${Date.now()}`);
}

suite('006A — bastion royaume', () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await openNodeSqliteDb();
  });
  afterEach(() => t.close());

  test('migration 008 : tables royaume présentes', async () => {
    const b = await t.db.getAllAsync<{ name: string }>(`PRAGMA table_info(kingdom_buildings)`);
    const c = await t.db.getAllAsync<{ name: string }>(`PRAGMA table_info(kingdom_combat)`);
    expect(b.map((x) => x.name)).toEqual(expect.arrayContaining(['building_id', 'level', 'updated_at']));
    expect(c.map((x) => x.name)).toEqual(expect.arrayContaining(['enemy_intent', 'first_win_rewarded', 'log_json']));
    const row = await t.db.getFirstAsync<{ version: number }>(
      `SELECT version FROM schema_migrations WHERE version = 8`,
    );
    expect(row?.version).toBe(8);
  });

  test('moteur combat pur : déterministe, victoire en 4–8 tours (attaque seule)', () => {
    let state = createInitialCombat(0);
    const stats = { baseDamage: HERO_BASE_DAMAGE, forgeLevel: 0, classId: 'rodeur' as const };
  let turns = 0;
    while (!state.outcome && turns < 12) {
      state = applyPlayerAction(state, 'attack', stats);
      turns += 1;
    }
    expect(state.outcome).toBe('victory');
    expect(turns).toBeGreaterThanOrEqual(4);
    expect(turns).toBeLessThanOrEqual(8);
  });

  test('spendGold : refus si solde insuffisant, pas de solde négatif', async () => {
    expect(await rpgRepo.spendGold(t.db, 10, 'test', 'spend:test:1')).toBe('insufficient');
    await seedGold(t, 5);
    expect(await rpgRepo.spendGold(t.db, 10, 'test', 'spend:test:1')).toBe('insufficient');
    expect(await ledgerSum(t, 'gold')).toBe(5);
    await seedGold(t, 10);
    expect(await rpgRepo.spendGold(t.db, 10, 'forge', 'spend:ok')).toBe('spent');
    expect(await ledgerSum(t, 'gold')).toBe(5);
    expect(await rpgRepo.spendGold(t.db, 10, 'forge', 'spend:ok')).toBe('duplicate');
  });

  test('forge : amélioration atomique, idempotence clé building:forge:level:N', async () => {
    await seedGold(t, 30);
    const r1 = await confirmForgeUpgrade(t.db, 0);
    expect(r1.ok).toBe(true);
    expect((await kingdomRepo.getForgeLevel(t.db)).level).toBe(1);
    expect(await ledgerSum(t, 'gold')).toBe(20);
    const key = forgeUpgradeKey(1);
    const rows = await t.db.getAllAsync<{ idempotency_key: string; amount: number }>(
      `SELECT idempotency_key, amount FROM wallet_ledger WHERE resource = 'gold' AND idempotency_key = ?`,
      key,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(-FORGE_UPGRADE_COST[1]);

    await confirmForgeUpgrade(t.db, 1);
    expect((await kingdomRepo.getForgeLevel(t.db)).level).toBe(2);
    expect(await ledgerSum(t, 'gold')).toBe(0);

    const dup = await confirmForgeUpgrade(t.db, 2);
    expect(dup).toMatchObject({ ok: false, code: 'max_level' });
    expect(await ledgerSum(t, 'gold')).toBe(0);
  });

  test('combat : persistance, première victoire bannière une fois, défaite sans perte or', async () => {
    await rpgRepo.grantItem(t.db, 'lantern');
    await rpgRepo.equipItem(t.db, 'hand', 'lantern');
    expect((await startCombat(t.db)).ok).toBe(true);
    let view = await getKingdomView(t.db);
    expect(view.combat.active).toBe(true);

    let safety = 0;
    while (view.combat.active && !view.combat.outcome && safety < 20) {
      const act = view.combat.skillCooldown <= 0 ? 'skill' : 'attack';
      await performCombatAction(t.db, act, view.combat.turnNumber, view.combat.updatedAt);
      view = await getKingdomView(t.db);
      safety += 1;
    }
    expect(view.combat.outcome).toBe('victory');
    const inv = await rpgRepo.listInventory(t.db);
    expect(inv.some((i) => i.itemId === FIRST_WIN_ITEM_ID)).toBe(true);
    const hand = await rpgRepo.listEquipment(t.db);
    expect(hand.find((s) => s.slot === 'hand')?.itemId).toBe('lantern');

    await dismissCombat(t.db);
    await startCombat(t.db);
    safety = 0;
    view = await getKingdomView(t.db);
    while (view.combat.active && !view.combat.outcome && safety < 30) {
      await performCombatAction(t.db, 'defend', view.combat.turnNumber, view.combat.updatedAt);
      view = await getKingdomView(t.db);
      if (view.combat.outcome === 'defeat') break;
      await performCombatAction(t.db, 'attack', view.combat.turnNumber, view.combat.updatedAt);
      view = await getKingdomView(t.db);
      safety += 1;
    }
    const banners = (await rpgRepo.listInventory(t.db)).filter((i) => i.itemId === FIRST_WIN_ITEM_ID);
    expect(banners).toHaveLength(1);

    const goldBefore = await ledgerSum(t, 'gold');
    await acceptQuest(t.db, 'breathe_once', new Date(Date.now() - 60_000));
    await recordBreathingSession(t.db, 60, true);
    await claimQuest(t.db, 'breathe_once');
    expect(await ledgerSum(t, 'gold')).toBeGreaterThanOrEqual(goldBefore);
  });

  test('combat jouable à 0 or', async () => {
    expect(await ledgerSum(t, 'gold')).toBe(0);
    expect((await startCombat(t.db)).ok).toBe(true);
    const cv = await getKingdomView(t.db);
    expect((await performCombatAction(t.db, 'attack', cv.combat.turnNumber, cv.combat.updatedAt)).ok).toBe(true);
  });

  test('reprise après redémarrage DB', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lq-kingdom-')), 'lq.db');
    let first = await openNodeSqliteDb(file);
    await startCombat(first.db);
    const fv = await getKingdomView(first.db);
    await performCombatAction(first.db, 'attack', fv.combat.turnNumber, fv.combat.updatedAt);
    first.close();

    const again = await openNodeSqliteDb(file);
    const view = await getKingdomView(again.db);
    expect(view.combat.active).toBe(true);
    expect(view.combat.heroHp).toBeGreaterThan(0);
    again.close();
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });

  test('defaults royaume si lignes absentes (compat sauvegarde ancienne)', async () => {
    await t.db.runAsync(`DELETE FROM kingdom_buildings`);
    await t.db.runAsync(`DELETE FROM kingdom_combat`);
    const view = await getKingdomView(t.db);
    expect(view.forge.level).toBe(0);
    expect(view.combat.firstWinRewarded).toBe(false);
  });
});