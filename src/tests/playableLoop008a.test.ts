import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RENEWABLE_TEMPLATES } from '../data/content/renewableQuestTemplates';
import * as rpgRepo from '../data/db/repositories/rpgRepo';
import { confirmForgeUpgrade } from '../domain/services/kingdomService';
import * as renewableQuestRepo from '../data/db/repositories/renewableQuestRepo';
import { createId } from '../utils/id';
import {
  acceptRenewableQuest,
  claimRenewableQuest,
  getRenewableQuestBoard,
  startRenewableTimer,
  succeedRenewableTimer,
} from '../domain/services/renewableQuestService';
import { nodeSqliteAvailable, openNodeSqliteDb, type TestDb } from './helpers/nodeSqliteDb';

const HAS_SQLITE = nodeSqliteAvailable();
const suite = HAS_SQLITE ? describe : describe.skip;
const PAST = new Date(Date.now() - 200_000).toISOString();

async function seedBreatheOffer(t: TestDb): Promise<string> {
  const tmpl = RENEWABLE_TEMPLATES.find((x) => x.id === 'rnw_breathe_3')!;
  const now = new Date().toISOString();
  const id = createId('rnw');
  await renewableQuestRepo.insertOffered(t.db, id, tmpl.id, tmpl.category, tmpl.rewardGold, now);
  return id;
}

suite('008A — boucle jouable (SQLite réel)', () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await openNodeSqliteDb();
  });
  afterEach(() => t.close());

  test('migration 010 : tables renouvelables + combat_victory_log', async () => {
    const tables = await t.db.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('renewable_quest_instances','combat_victory_log')`,
    );
    expect(tables.map((r) => r.name).sort()).toEqual(['combat_victory_log', 'renewable_quest_instances']);
  });

  test('catalogue 10–15 gabarits jouables', () => {
    expect(RENEWABLE_TEMPLATES.length).toBeGreaterThanOrEqual(10);
    expect(RENEWABLE_TEMPLATES.length).toBeLessThanOrEqual(15);
    for (const tmpl of RENEWABLE_TEMPLATES) {
      expect(tmpl.rewardGold).toBeGreaterThan(0);
      expect(tmpl.nextStep.length).toBeGreaterThan(10);
    }
  });

  test('quête → chrono → succès → récompense → renouvellement → forge', async () => {
    const board0 = await getRenewableQuestBoard(t.db);
    expect(board0.entries.some((e) => e.state === 'offered')).toBe(true);

    const inst = await seedBreatheOffer(t);

    expect((await acceptRenewableQuest(t.db, inst)).ok).toBe(true);
    expect((await startRenewableTimer(t.db, inst)).ok).toBe(true);

    await t.db.runAsync(
      `UPDATE renewable_quest_instances SET progress_json = ?, accepted_at = ? WHERE id = ?`,
      JSON.stringify({
        timer: {
          kind: 'breathing',
          startedUtc: PAST,
          targetSec: 180,
          state: 'running',
        },
        forgeLevelAtAccept: 0,
      }),
      PAST,
      inst,
    );

    const ok = await succeedRenewableTimer(t.db, inst);
    expect(ok.ok).toBe(true);

    const claim = await claimRenewableQuest(t.db, inst);
    expect(claim.ok).toBe(true);
    expect((claim.gold ?? 0)).toBeGreaterThan(0);
    expect(await rpgRepo.getGoldBalance(t.db)).toBe(claim.gold);

    const board1 = await getRenewableQuestBoard(t.db);
    expect(board1.entries.some((e) => e.state === 'offered' && e.instanceId !== inst)).toBe(true);

    const upgrade = await confirmForgeUpgrade(t.db, 0);
    expect(upgrade.ok).toBe(true);
    expect(upgrade.status).toBe('spent');
    expect(await rpgRepo.getGoldBalance(t.db)).toBeLessThan(claim.gold ?? 0);
  });

  test('double réclamation renouvelable : or idempotent', async () => {
    const id = await seedBreatheOffer(t);
    await acceptRenewableQuest(t.db, id);
    await t.db.runAsync(
      `UPDATE renewable_quest_instances SET progress_json = ?, accepted_at = ?, status = 'ready' WHERE id = ?`,
      JSON.stringify({ forgeLevelAtAccept: 0 }),
      PAST,
      id,
    );
    await t.db.runAsync(
      `INSERT INTO coping_sessions (id, kind, duration_sec, completed, meta_json, created_at) VALUES (?, 'breathing', 180, 1, '{}', ?)`,
      'cope_test',
      new Date().toISOString(),
    );
    const r1 = await claimRenewableQuest(t.db, id);
    expect(r1.ok).toBe(true);
    const r2 = await claimRenewableQuest(t.db, id);
    expect(r2.ok).toBe(false);
  });
});

suite('008A — backup tables exportables', () => {
  test('export inclut les nouvelles tables (smoke)', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lq-008a-')), 'lq.db');
    const opened = await openNodeSqliteDb(file);
    await getRenewableQuestBoard(opened.db);
    opened.close();
    const reopened = await openNodeSqliteDb(file);
    const rows = await reopened.db.getAllAsync('SELECT * FROM renewable_quest_instances');
    expect(rows.length).toBeGreaterThan(0);
    reopened.close();
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });
});