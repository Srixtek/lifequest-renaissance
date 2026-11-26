import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { applyPlayerAction, createInitialCombat } from '../domain/combat/combatEngine';
import * as rpgRepo from '../data/db/repositories/rpgRepo';
import * as kingdomRepo from '../data/db/repositories/kingdomRepo';
import * as profileRepo from '../data/db/repositories/profileRepo';
import {
  confirmForgeUpgrade,
  dismissCombat,
  forgeUpgradeKey,
  getKingdomView,
  performCombatAction,
  startCombat,
} from '../domain/services/kingdomService';
import { skillAffordable } from '../domain/combat/combatEngine';
import { exportBackupPayload, importBackupPayload } from '../domain/services/backupService';
import { FIRST_WIN_ITEM_ID, HERO_BASE_DAMAGE } from '../data/content/kingdom';
import type { ClassId } from '../domain/models/types';
import { nodeSqliteAvailable, openNodeSqliteDb, type TestDb } from './helpers/nodeSqliteDb';

const HAS_SQLITE = nodeSqliteAvailable();
const suite = HAS_SQLITE ? describe : describe.skip;

async function seedGold(t: TestDb, amount: number) {
  await rpgRepo.addGold(t.db, amount, 'test', `test-gold-${amount}-${Date.now()}`);
}

async function ledgerSum(t: TestDb, resource: string) {
  const r = await t.db.getFirstAsync<{ s: number }>(
    'SELECT COALESCE(SUM(amount),0) AS s FROM wallet_ledger WHERE resource = ?',
    resource,
  );
  return Number(r?.s ?? 0);
}

async function setClass(t: TestDb, classId: ClassId) {
  const p = await profileRepo.getProfile(t.db);
  if (p) {
    await profileRepo.upsertProfile(t.db, { ...p, classId });
    return;
  }
  await profileRepo.upsertProfile(t.db, {
    id: 'profile_test',
    pseudo: 'Héros',
    classId,
    tone: 'fantasy',
    dayStartHour: 4,
    timezone: 'Europe/Paris',
    createdAt: new Date().toISOString(),
    onboardingDone: true,
  });
}

function pickOffensiveAction(classId: ClassId, view: Awaited<ReturnType<typeof getKingdomView>>) {
  const c = view.combat;
  if (c.enemyIntent === 'heavy') {
    if (classId === 'gardien' && skillAffordable(c)) return 'skill' as const;
    return 'defend' as const;
  }
  if (classId === 'sage' && c.heroHp < c.heroHpMax * 0.6 && skillAffordable(c)) return 'skill' as const;
  if ((classId === 'rodeur' || classId === 'artisan') && skillAffordable(c)) return 'skill' as const;
  if (c.concentration === 1 && c.enemyIntent === 'brace') return 'attack' as const;
  if (c.concentration < 2 && c.enemyIntent !== 'normal') return 'defend' as const;
  return 'attack' as const;
}

async function fightToVictory(t: TestDb) {
  await startCombat(t.db);
  let view = await getKingdomView(t.db);
  const classId = (await profileRepo.getProfile(t.db))?.classId ?? 'rodeur';
  let safety = 0;
  while (view.combat.active && !view.combat.outcome && safety < 50) {
    const action = pickOffensiveAction(classId, view);
    const turn = view.combat.turnNumber;
    const rev = view.combat.updatedAt;
    await performCombatAction(t.db, action, turn, rev);
    view = await getKingdomView(t.db);
    safety += 1;
  }
  return view;
}

async function fightToDefeat(t: TestDb) {
  await startCombat(t.db);
  let view = await getKingdomView(t.db);
  let safety = 0;
  while (view.combat.active && !view.combat.outcome && safety < 50) {
    const turn = view.combat.turnNumber;
    const rev = view.combat.updatedAt;
    await performCombatAction(t.db, 'defend', turn, rev);
    view = await getKingdomView(t.db);
    if (view.combat.outcome === 'defeat') break;
    await performCombatAction(t.db, 'attack', view.combat.turnNumber, view.combat.updatedAt);
    view = await getKingdomView(t.db);
    safety += 1;
  }
  return view;
}

suite('006A-R — fiabilisation bastion', () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await openNodeSqliteDb();
  });
  afterEach(() => t.close());

  test('forge : expectedCurrentLevel mismatch refusé sans dépense', async () => {
    await seedGold(t, 30);
    const bad = await confirmForgeUpgrade(t.db, 1);
    expect(bad.ok).toBe(false);
    expect(bad.code).toBe('level_mismatch');
    expect(bad.status).toBe('inconsistent');
    expect((await kingdomRepo.getForgeLevel(t.db)).level).toBe(0);
    expect(await ledgerSum(t, 'gold')).toBe(30);
  });

  test('forge : double clic séquentiel — un seul niveau consommé', async () => {
    await seedGold(t, 30);
    const v0 = await getKingdomView(t.db);
    expect(v0.forge.level).toBe(0);
    const r1 = await confirmForgeUpgrade(t.db, 0);
    expect(r1.ok).toBe(true);
    expect(r1.status).toBe('spent');
    const stale = await confirmForgeUpgrade(t.db, 0);
    expect(stale.ok).toBe(false);
    expect(stale.code).toBe('level_mismatch');
    expect((await kingdomRepo.getForgeLevel(t.db)).level).toBe(1);
    expect(await ledgerSum(t, 'gold')).toBe(20);
  });

  test('forge : seconde confirmation avec niveau périmé → duplicate implicite (mismatch)', async () => {
    await seedGold(t, 50);
    expect((await confirmForgeUpgrade(t.db, 0)).status).toBe('spent');
    const second = await confirmForgeUpgrade(t.db, 1);
    expect(second.status).toBe('spent');
    expect((await confirmForgeUpgrade(t.db, 1)).code).toBe('level_mismatch');
    const keyRow = await t.db.getFirstAsync<{ id: string }>(
      'SELECT id FROM wallet_ledger WHERE idempotency_key = ?',
      forgeUpgradeKey(2),
    );
    expect(keyRow).toBeTruthy();
    expect((await kingdomRepo.getForgeLevel(t.db)).level).toBe(2);
  });

  test('combat : action obsolète rejetée sans mutation', async () => {
    await startCombat(t.db);
    const view = await getKingdomView(t.db);
    const r = await performCombatAction(t.db, 'attack', view.combat.turnNumber, '1970-01-01T00:00:00.000Z');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('stale');
    const after = await getKingdomView(t.db);
    expect(after.combat.heroHp).toBe(view.combat.heroHp);
    expect(after.combat.enemyHp).toBe(view.combat.enemyHp);
    expect(after.combat.turnNumber).toBe(view.combat.turnNumber);
  });

  test('combat : trophée qty=1 après plusieurs victoires', async () => {
    for (const classId of ['rodeur', 'gardien', 'sage', 'artisan'] as ClassId[]) {
      await setClass(t, classId);
      expect((await fightToVictory(t)).combat.outcome).toBe('victory');
      await dismissCombat(t.db);
    }
    await setClass(t, 'rodeur');
    expect((await fightToVictory(t)).combat.outcome).toBe('victory');
    await dismissCombat(t.db);
    expect((await fightToVictory(t)).combat.outcome).toBe('victory');
    const banners = (await rpgRepo.listInventory(t.db)).filter((i) => i.itemId === FIRST_WIN_ITEM_ID);
    expect(banners).toHaveLength(1);
    expect(banners[0].quantity).toBe(1);
  });

  test('équilibrage : 4 classes victoire sans forge, défaite sans or/XP', async () => {
    const classes: ClassId[] = ['rodeur', 'gardien', 'sage', 'artisan'];
    for (const classId of classes) {
      await setClass(t, classId);
      const xpBefore = await t.db.getFirstAsync<{ s: number }>('SELECT COALESCE(SUM(xp_amount),0) AS s FROM xp_ledger');
      const goldBefore = await ledgerSum(t, 'gold');
      const win = await fightToVictory(t);
      expect(win.combat.outcome).toBe('victory');
      expect((await kingdomRepo.getForgeLevel(t.db)).level).toBe(0);
      await dismissCombat(t.db);
      const lose = await fightToDefeat(t);
      expect(lose.combat.outcome).toBe('defeat');
      const xpAfter = await t.db.getFirstAsync<{ s: number }>('SELECT COALESCE(SUM(xp_amount),0) AS s FROM xp_ledger');
      expect(Number(xpAfter?.s)).toBe(Number(xpBefore?.s));
      expect(await ledgerSum(t, 'gold')).toBe(goldBefore);
    }
  });

  test('équilibrage : défense réduit la frappe lourde même tour', () => {
    const stats = { baseDamage: HERO_BASE_DAMAGE, forgeLevel: 0, classId: 'rodeur' as const };
    const base = { ...createInitialCombat(0), enemyIntent: 'heavy' as const };
    const defended = applyPlayerAction(base, 'defend', stats);
    const reckless = applyPlayerAction(base, 'attack', stats);
    expect(defended.heroHp).toBeGreaterThan(reckless.heroHp);
  });

  test('backup : export→import roundtrip SQLite avec royaume', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lq-bak-'));
    const file = path.join(dir, 'roundtrip.db');
    let source = await openNodeSqliteDb(file);
    await seedGold(source, 40);
    await confirmForgeUpgrade(source.db, 0);
    await startCombat(source.db);
    const snap = await getKingdomView(source.db);
    const { manifest, data } = await exportBackupPayload(source.db, '0.2.0');
    source.close();

    let target = await openNodeSqliteDb(path.join(dir, 'target.db'));
    await importBackupPayload(target.db, manifest, data);
    const afterImport = await getKingdomView(target.db);
    expect(afterImport.forge.level).toBe(1);
    expect(afterImport.combat.heroHp).toBe(snap.combat.heroHp);
    expect(afterImport.combat.active).toBe(snap.combat.active);
    target.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('backup : import pré-008 sans lignes royaume → defaults', async () => {
    const { manifest, data } = await exportBackupPayload(t.db, '0.2.0');
    delete data.kingdom_buildings;
    delete data.kingdom_combat;
    await importBackupPayload(t.db, manifest, data);
    const view = await getKingdomView(t.db);
    expect(view.forge.level).toBe(0);
    expect(view.combat.firstWinRewarded).toBe(false);
  });
});