import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QUESTS } from '../data/content/quests';
import * as rpgRepo from '../data/db/repositories/rpgRepo';
import { confirmGoalDay } from '../domain/services/trackingService';
import { recordBreathingSession } from '../domain/services/toolsService';
import { chooseAdventure, equipLantern } from '../domain/services/adventureService';
import {
  closeChallengeSession,
  completeScreenChallenge,
  completeSportChallenge,
  startChallengeSession,
} from '../domain/services/challengeService';
import {
  abandonQuest,
  acceptQuest,
  claimQuest,
  getQuestBoard,
  questRewardKey,
} from '../domain/services/questService';
import { nodeSqliteAvailable, openNodeSqliteDb, type TestDb } from './helpers/nodeSqliteDb';

const HAS_SQLITE = nodeSqliteAvailable();
if (!HAS_SQLITE) {
  console.warn('[SKIP] questBoard — node:sqlite indisponible (Node < 22.5) : tests SQLite réels ignorés');
}
const suite = HAS_SQLITE ? describe : describe.skip;

const PAST = () => new Date(Date.now() - 5 * 60_000);
const FUTURE = () => new Date(Date.now() + 5 * 60_000);

async function seedGoal(t: TestDb, id = 'g1') {
  await t.db.runAsync(
    `INSERT INTO goal_definitions (id, title, kind, unit, weight, status, template_id, sensitive, follow_without_xp, created_at)
     VALUES (?, 'Marcher', 'count', 'u', 1, 'active', NULL, 0, 0, ?)`,
    id,
    '2025-11-01T00:00:00.000Z',
  );
  await t.db.runAsync(
    `INSERT INTO goal_versions (id, goal_id, version, tier, target_value, schedule_kind, weekly_target_count, notes, effective_from, effective_to)
     VALUES (?, ?, 1, 'normal', 1, 'daily', NULL, NULL, '2025-11-01', NULL)`,
    `v-${id}`,
    id,
  );
}

async function entry(t: TestDb, questId: string) {
  const board = await getQuestBoard(t.db);
  return board.entries.find((e) => e.def.id === questId)!;
}

async function ledgerSum(t: TestDb, resource: string) {
  const r = await t.db.getFirstAsync<{ s: number }>(
    'SELECT COALESCE(SUM(amount),0) AS s FROM wallet_ledger WHERE resource = ?',
    resource,
  );
  return Number(r?.s ?? 0);
}

async function goldRows(t: TestDb) {
  return t.db.getAllAsync<{ idempotency_key: string; amount: number }>(
    `SELECT idempotency_key, amount FROM wallet_ledger WHERE resource = 'gold'`,
  );
}

describe('contenu des quêtes', () => {
  test('4 quêtes uniques, or fixe entier, pas de récompense XP/éclats', () => {
    expect(QUESTS).toHaveLength(4);
    expect(new Set(QUESTS.map((q) => q.id)).size).toBe(4);
    for (const q of QUESTS) {
      expect(Number.isInteger(q.rewardGold) && q.rewardGold > 0).toBe(true);
      expect(Object.keys(q)).not.toContain('rewardShards');
      expect(Object.keys(q)).not.toContain('rewardXp');
    }
  });
});

suite('tableau de quêtes — SQLite réel (node:sqlite, pas expo natif)', () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await openNodeSqliteDb();
  });
  afterEach(() => t.close());

  test('rien n\'est accepté automatiquement ; accepter est un choix', async () => {
    const board = await getQuestBoard(t.db);
    expect(board.entries.every((e) => e.state === 'available')).toBe(true);
    expect(board.acceptedCount).toBe(0);
    expect(board.goldBalance).toBe(0);
    const r = await acceptQuest(t.db, 'breathe_once');
    expect(r.ok).toBe(true);
    expect((await entry(t, 'breathe_once')).state).toBe('accepted');
    expect(await acceptQuest(t.db, 'breathe_once')).toMatchObject({ ok: false, code: 'already_accepted' });
    expect(await acceptQuest(t.db, 'nope')).toMatchObject({ ok: false, code: 'unknown_quest' });
  });

  test('3 quêtes actives acceptables ; abandon libère une place ; quête retirée refusée', async () => {
    for (const id of ['first_confirm', 'breathe_once', 'time_tamed']) {
      expect((await acceptQuest(t.db, id)).ok).toBe(true);
    }
    expect(await acceptQuest(t.db, 'explore_grove')).toMatchObject({ ok: false, code: 'retired' });
    expect((await abandonQuest(t.db, 'time_tamed')).ok).toBe(true);
    expect((await acceptQuest(t.db, 'time_tamed')).ok).toBe(true);
  });

  test('acceptations concurrentes de toutes les quêtes : jamais plus de 3, aucune quête retirée', async () => {
    await Promise.all(QUESTS.map((q) => acceptQuest(t.db, q.id)));
    expect((await getQuestBoard(t.db)).acceptedCount).toBe(3);
  });

  test('déclaration d\'habitude : preuve réelle, unknown et pré-acceptation exclus', async () => {
    await seedGoal(t);
    await confirmGoalDay(t.db, 'g1', '2025-11-20', 'success');
    await acceptQuest(t.db, 'first_confirm', FUTURE());
    expect((await entry(t, 'first_confirm')).state).toBe('accepted');

    await acceptQuest(t.db, 'breathe_once');
    await abandonQuest(t.db, 'first_confirm');
    await acceptQuest(t.db, 'first_confirm', PAST());
    expect((await entry(t, 'first_confirm')).state).toBe('ready');
  });

  test('déclaration unknown n\'est pas une preuve ; miss honnête en est une', async () => {
    await seedGoal(t);
    await acceptQuest(t.db, 'first_confirm', PAST());
    await confirmGoalDay(t.db, 'g1', '2025-11-21', 'unknown');
    expect((await entry(t, 'first_confirm')).state).toBe('accepted');
    await confirmGoalDay(t.db, 'g1', '2025-11-21', 'miss');
    expect((await entry(t, 'first_confirm')).state).toBe('ready');
  });

  test('respiration : séance interrompue et raccourci de test non admissibles ; séance terminée oui', async () => {
    await acceptQuest(t.db, 'breathe_once', PAST());
    await recordBreathingSession(t.db, 30, false);
    expect((await entry(t, 'breathe_once')).state).toBe('accepted');
    await recordBreathingSession(t.db, 60, true, { shortcut: true });
    expect((await entry(t, 'breathe_once')).state).toBe('accepted');
    await recordBreathingSession(t.db, 60, true);
    expect((await entry(t, 'breathe_once')).state).toBe('ready');
  });

  test('respiration terminée avant acceptation : non rétroactif', async () => {
    await recordBreathingSession(t.db, 60, true);
    await acceptQuest(t.db, 'breathe_once', FUTURE());
    expect((await entry(t, 'breathe_once')).state).toBe('accepted');
  });

  test('défis : sport interrompu / sans écran non respecté / vape = non ; sport confirmé ou sans écran respecté = oui', async () => {
    await acceptQuest(t.db, 'time_tamed', PAST());

    const sport1 = await startChallengeSession(t.db, 'sport', null);
    if (!sport1.ok) throw new Error('start');
    await closeChallengeSession(t.db, sport1.session.id, 'interrupted', { requireSportConfirm: false });
    const screen1 = await startChallengeSession(t.db, 'no_screen', 600);
    if (!screen1.ok) throw new Error('start');
    await completeScreenChallenge(t.db, screen1.session.id, false);
    const vape = await startChallengeSession(t.db, 'no_vape', null);
    if (!vape.ok) throw new Error('start');
    await closeChallengeSession(t.db, vape.session.id, 'completed', { requireSportConfirm: false });
    expect((await entry(t, 'time_tamed')).state).toBe('accepted');

    const sport2 = await startChallengeSession(t.db, 'sport', null);
    if (!sport2.ok) throw new Error('start');
    await completeSportChallenge(t.db, sport2.session.id, 0);
    expect((await entry(t, 'time_tamed')).state).toBe('accepted');

    const sport3 = await startChallengeSession(t.db, 'sport', null);
    if (!sport3.ok) throw new Error('start');
    await completeSportChallenge(t.db, sport3.session.id, 20);
    expect((await entry(t, 'time_tamed')).state).toBe('ready');
  });

  test('défi sans écran explicitement respecté suffit', async () => {
    await acceptQuest(t.db, 'time_tamed', PAST());
    const s = await startChallengeSession(t.db, 'no_screen', null);
    if (!s.ok) throw new Error('start');
    await completeScreenChallenge(t.db, s.session.id, true);
    expect((await entry(t, 'time_tamed')).state).toBe('ready');
  });

  test('session sport en cours (non terminée) ou démarrée avant l\'acceptation : pas de preuve', async () => {
    const early = await startChallengeSession(t.db, 'sport', null);
    if (!early.ok) throw new Error('start');
    await acceptQuest(t.db, 'time_tamed', FUTURE());
    await completeSportChallenge(t.db, early.session.id, 30);
    expect((await entry(t, 'time_tamed')).state).toBe('accepted');
  });

  describe('Ancien sentier retiré (explore_grove)', () => {
    const seedLegacy = (status: 'accepted' | 'claimed', acceptedAt = '2025-11-01T00:00:00.000Z') =>
      t.db.runAsync(
        `INSERT INTO quest_instances (id, quest_id, status, progress_json, completed_at, accepted_at, claimed_at, abandoned_at)
         VALUES ('qst-legacy', 'explore_grove', ?, NULL, ?, ?, ?, NULL)`,
        status,
        status === 'claimed' ? '2025-11-02T00:00:00.000Z' : null,
        acceptedAt,
        status === 'claimed' ? '2025-11-02T00:00:00.000Z' : null,
      );
    const ids = async () => (await getQuestBoard(t.db)).entries.map((e) => e.def.id);

    test('jamais proposée : absente du tableau, non acceptable', async () => {
      expect(await ids()).not.toContain('explore_grove');
      expect(await acceptQuest(t.db, 'explore_grove')).toMatchObject({ ok: false, code: 'retired' });
      expect((await getQuestBoard(t.db)).acceptedCount).toBe(0);
    });

    test('ancienne acceptation non terminée : masquée, aucun emplacement bloqué, ligne conservée', async () => {
      await seedLegacy('accepted');
      expect(await ids()).not.toContain('explore_grove');
      expect((await getQuestBoard(t.db)).acceptedCount).toBe(0);
      for (const id of ['first_confirm', 'breathe_once', 'time_tamed']) {
        expect((await acceptQuest(t.db, id)).ok).toBe(true);
      }
      expect((await getQuestBoard(t.db)).acceptedCount).toBe(3);
      const row = await t.db.getFirstAsync<{ status: string }>(
        `SELECT status FROM quest_instances WHERE quest_id = 'explore_grove'`,
      );
      expect(row?.status).toBe('accepted');
      expect(await ledgerSum(t, 'gold')).toBe(0);
    });

    test('ancienne acceptation dont le nœud a déjà été atteint : réclamable une seule fois, sans emplacement', async () => {
      await seedLegacy('accepted');
      await chooseAdventure(t.db, 'to_path');
      await chooseAdventure(t.db, 'enter');
      const e = await entry(t, 'explore_grove');
      expect(e.state).toBe('ready');
      expect((await getQuestBoard(t.db)).acceptedCount).toBe(0);
      expect(await claimQuest(t.db, 'explore_grove')).toMatchObject({ ok: true, gold: 20 });
      expect(await claimQuest(t.db, 'explore_grove')).toMatchObject({ ok: false, code: 'already_claimed' });
      expect(await ledgerSum(t, 'gold')).toBe(20);
    });

    test('ancienne quête déjà réclamée : historique conservé et visible', async () => {
      await seedLegacy('claimed');
      expect((await entry(t, 'explore_grove')).state).toBe('claimed');
      expect(await acceptQuest(t.db, 'explore_grove')).toMatchObject({ ok: false, code: 'retired' });
    });
  });

  test('réclamation : refus tant que non prête, une seule fois, solde = somme du ledger', async () => {
    await acceptQuest(t.db, 'breathe_once', PAST());
    expect(await claimQuest(t.db, 'breathe_once')).toMatchObject({ ok: false, code: 'not_ready' });
    expect(await claimQuest(t.db, 'first_confirm')).toMatchObject({ ok: false, code: 'not_accepted' });
    expect(await ledgerSum(t, 'gold')).toBe(0);

    await recordBreathingSession(t.db, 60, true);
    expect((await entry(t, 'breathe_once')).state).toBe('ready');
    const r = await claimQuest(t.db, 'breathe_once');
    expect(r).toMatchObject({ ok: true, gold: 10, balance: 10 });
    expect(await claimQuest(t.db, 'breathe_once')).toMatchObject({ ok: false, code: 'already_claimed' });

    const board = await getQuestBoard(t.db);
    expect(board.goldBalance).toBe(await ledgerSum(t, 'gold'));
    expect(board.goldBalance).toBe(10);
    expect((await entry(t, 'breathe_once')).state).toBe('claimed');
    expect((await goldRows(t)).map((g) => g.idempotency_key)).toEqual([questRewardKey('breathe_once')]);
  });

  test('double tap simultané sur Réclamer : une seule ligne d\'or', async () => {
    await acceptQuest(t.db, 'breathe_once', PAST());
    await recordBreathingSession(t.db, 60, true);
    const results = await Promise.all([
      claimQuest(t.db, 'breathe_once'),
      claimQuest(t.db, 'breathe_once'),
      claimQuest(t.db, 'breathe_once'),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await goldRows(t)).toHaveLength(1);
    expect(await ledgerSum(t, 'gold')).toBe(10);
  });

  test('échec d\'écriture de l\'or : rollback, la quête reste acceptée et réclamable ensuite', async () => {
    await acceptQuest(t.db, 'breathe_once', PAST());
    await recordBreathingSession(t.db, 60, true);
    t.raw.exec(`CREATE TRIGGER fail_gold BEFORE INSERT ON wallet_ledger
      WHEN NEW.resource = 'gold' BEGIN SELECT RAISE(ABORT, 'disque plein'); END;`);
    await expect(claimQuest(t.db, 'breathe_once')).rejects.toThrow('disque plein');
    expect((await entry(t, 'breathe_once')).state).toBe('ready');
    const row = await t.db.getFirstAsync<{ status: string; claimed_at: string | null }>(
      `SELECT status, claimed_at FROM quest_instances WHERE quest_id = 'breathe_once'`,
    );
    expect(row).toMatchObject({ status: 'accepted', claimed_at: null });
    expect(await goldRows(t)).toHaveLength(0);

    t.raw.exec('DROP TRIGGER fail_gold');
    expect(await claimQuest(t.db, 'breathe_once')).toMatchObject({ ok: true, gold: 10 });
    expect(await ledgerSum(t, 'gold')).toBe(10);
  });

  test('échec lors du marquage terminé : or annulé aussi (atomicité)', async () => {
    await acceptQuest(t.db, 'breathe_once', PAST());
    await recordBreathingSession(t.db, 60, true);
    t.raw.exec(`CREATE TRIGGER fail_claim BEFORE UPDATE ON quest_instances
      WHEN NEW.status = 'claimed' BEGIN SELECT RAISE(ABORT, 'échec état'); END;`);
    await expect(claimQuest(t.db, 'breathe_once')).rejects.toThrow('échec état');
    expect(await goldRows(t)).toHaveLength(0);
    expect((await entry(t, 'breathe_once')).state).toBe('ready');
  });

  test('abandon puis ré-acceptation : pas de doublon, preuve non rétroactive, une seule récompense', async () => {
    await acceptQuest(t.db, 'breathe_once', PAST());
    await recordBreathingSession(t.db, 60, true);
    expect((await entry(t, 'breathe_once')).state).toBe('ready');
    expect((await abandonQuest(t.db, 'breathe_once')).ok).toBe(true);
    expect((await entry(t, 'breathe_once')).state).toBe('available');
    expect(await claimQuest(t.db, 'breathe_once')).toMatchObject({ ok: false, code: 'not_accepted' });

    await acceptQuest(t.db, 'breathe_once', FUTURE());
    expect((await entry(t, 'breathe_once')).state).toBe('accepted');
    const rows = await t.db.getAllAsync(`SELECT id FROM quest_instances WHERE quest_id = 'breathe_once'`);
    expect(rows).toHaveLength(1);

    await abandonQuest(t.db, 'breathe_once');
    await acceptQuest(t.db, 'breathe_once', PAST());
    await recordBreathingSession(t.db, 60, true);
    // la séance précédente (avant la 3e acceptation) ne compte pas, la nouvelle oui
    expect((await entry(t, 'breathe_once')).state).toBe('ready');
    expect(await claimQuest(t.db, 'breathe_once')).toMatchObject({ ok: true });
    expect(await acceptQuest(t.db, 'breathe_once')).toMatchObject({ ok: false, code: 'already_claimed' });
    expect(await abandonQuest(t.db, 'breathe_once')).toMatchObject({ ok: false, code: 'already_claimed' });
    expect(await ledgerSum(t, 'gold')).toBe(10);
  });

  test('l\'abandon ne retire jamais l\'or acquis', async () => {
    await acceptQuest(t.db, 'breathe_once', PAST());
    await recordBreathingSession(t.db, 60, true);
    await claimQuest(t.db, 'breathe_once');
    await acceptQuest(t.db, 'first_confirm');
    await abandonQuest(t.db, 'first_confirm');
    expect((await getQuestBoard(t.db)).goldBalance).toBe(10);
  });

  test('XP, éclats, inventaire et aventure inchangés par une réclamation', async () => {
    await seedGoal(t);
    await acceptQuest(t.db, 'first_confirm', PAST());
    await confirmGoalDay(t.db, 'g1', '2025-11-22', 'success');
    const snap = async () => ({
      xp: await t.db.getAllAsync('SELECT * FROM xp_ledger ORDER BY id'),
      shardsLedger: await t.db.getAllAsync(`SELECT * FROM wallet_ledger WHERE resource = 'shards' ORDER BY id`),
      character: await t.db.getFirstAsync('SELECT * FROM character_progress WHERE id = 1'),
      adventure: await t.db.getFirstAsync('SELECT * FROM adventure_state WHERE id = 1'),
      inventory: await t.db.getAllAsync('SELECT * FROM inventory_items ORDER BY id'),
    });
    const before = await snap();
    expect(await claimQuest(t.db, 'first_confirm')).toMatchObject({ ok: true, gold: 10 });
    expect(await snap()).toEqual(before);
    expect(await ledgerSum(t, 'gold')).toBe(10);
  });

  test('aventure : objets narratifs jamais dupliqués en répétant le choix (y compris double tap)', async () => {
    await rpgRepo.grantItem(t.db, 'lantern');
    await equipLantern(t.db);
    await chooseAdventure(t.db, 'to_path');
    await chooseAdventure(t.db, 'enter');

    await Promise.all([chooseAdventure(t.db, 'gather'), chooseAdventure(t.db, 'gather')]);
    await chooseAdventure(t.db, 'gather');
    await chooseAdventure(t.db, 'kit');
    await chooseAdventure(t.db, 'kit');

    const inv = await rpgRepo.listInventory(t.db);
    expect(inv.find((i) => i.itemId === 'herb_pouch')?.quantity).toBe(1);
    expect(inv.find((i) => i.itemId === 'camp_kit')?.quantity).toBe(1);
    expect(inv.find((i) => i.itemId === 'lantern')?.quantity).toBe(1);
    expect(await ledgerSum(t, 'shards')).toBe(3);
    const adv = await rpgRepo.getAdventure(t.db);
    expect(adv.currentNode).toBe('hidden_grove');
    expect(adv.visited).toEqual(['camp_gate', 'mist_edge', 'hidden_grove']);
    expect(await rpgRepo.getFlag(t.db, 'grove_gathered')).toBe('1');
  });

  test('aventure : acquis légitimes d\'avant le correctif conservés (quantités >1 non réduites)', async () => {
    await t.db.runAsync(
      `INSERT INTO inventory_items (id, item_id, quantity, acquired_at) VALUES ('inv_herb_pouch', 'herb_pouch', 3, '2025-11-01T00:00:00.000Z')`,
    );
    await rpgRepo.setFlag(t.db, 'grove_gathered', '1');
    await rpgRepo.grantItem(t.db, 'lantern');
    await equipLantern(t.db);
    await rpgRepo.setAdventure(t.db, 'hidden_grove', ['camp_gate', 'mist_edge', 'hidden_grove'], []);
    const r = await chooseAdventure(t.db, 'gather');
    expect(r.ok).toBe(true);
    expect((await rpgRepo.listInventory(t.db)).find((i) => i.itemId === 'herb_pouch')?.quantity).toBe(3);
  });

  test('migration 005 additive : colonnes ajoutées, unicité par quête', async () => {
    const cols = await t.db.getAllAsync<{ name: string }>(`PRAGMA table_info(quest_instances)`);
    const names = cols.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['id', 'quest_id', 'status', 'progress_json', 'completed_at', 'accepted_at', 'claimed_at', 'abandoned_at']));
    await acceptQuest(t.db, 'breathe_once');
    await expect(
      t.db.runAsync(`INSERT INTO quest_instances (id, quest_id, status) VALUES ('dup', 'breathe_once', 'accepted')`),
    ).rejects.toThrow(/unique/i);
  });

  test('clé d\'idempotence déjà au registre : quête terminée sans second crédit', async () => {
    await acceptQuest(t.db, 'breathe_once', PAST());
    await recordBreathingSession(t.db, 60, true);
    await rpgRepo.addGold(t.db, 10, 'import', questRewardKey('breathe_once'));
    const r = await claimQuest(t.db, 'breathe_once');
    expect(r).toMatchObject({ ok: true, gold: 0, alreadyHadLedgerEntry: true });
    expect(await ledgerSum(t, 'gold')).toBe(10);
    expect((await entry(t, 'breathe_once')).state).toBe('claimed');
  });
});

suite('persistance après réouverture — fichier SQLite réel', () => {
  test('claim après redémarrage : toujours une seule récompense', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lq-quest-')), 'lq.db');
    let t = await openNodeSqliteDb(file);
    await acceptQuest(t.db, 'breathe_once', PAST());
    await recordBreathingSession(t.db, 60, true);
    expect(await claimQuest(t.db, 'breathe_once')).toMatchObject({ ok: true });
    t.close();

    t = await openNodeSqliteDb(file);
    expect((await entry(t, 'breathe_once')).state).toBe('claimed');
    expect(await claimQuest(t.db, 'breathe_once')).toMatchObject({ ok: false, code: 'already_claimed' });
    expect((await getQuestBoard(t.db)).goldBalance).toBe(10);
    expect(await goldRows(t)).toHaveLength(1);
    t.close();
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });

  test('quête acceptée et progression conservées après redémarrage', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lq-quest-')), 'lq.db');
    let t = await openNodeSqliteDb(file);
    await acceptQuest(t.db, 'breathe_once', PAST());
    await recordBreathingSession(t.db, 60, true);
    t.close();
    t = await openNodeSqliteDb(file);
    expect((await entry(t, 'breathe_once')).state).toBe('ready');
    t.close();
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });
});
