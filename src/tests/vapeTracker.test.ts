jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: '/tmp/',
  documentDirectory: '/tmp/',
  EncodingType: { Base64: 'base64' },
  writeAsStringAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
}));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { migrate } from '../data/db/client';
import * as rpgRepo from '../data/db/repositories/rpgRepo';
import {
  VAPE_RECORD_BONUS,
  VAPE_STEP_GOLD,
  formatDuration,
  nextStepInfo,
  recordThresholdsCrossed,
  safeElapsedSec,
  stepLabel,
  stepsReached,
} from '../domain/rules/vapeMain';
import {
  amendLastDeclarationTime,
  claimVapeRewards,
  declareCraving,
  declareVape,
  getVapeTrackerDashboard,
  resolveCraving,
  startVapeMainSession,
  undoLastDeclaration,
  voidVapeSession,
} from '../domain/services/vapeTrackerService';
import { closeVapeAdaptiveChallenge, startVapeAdaptiveChallenge } from '../domain/services/adaptiveChallengeService';
import { getRenewableGoldEarnedToday, getRenewableQuestBoard } from '../domain/services/renewableQuestService';
import { SHARED_DAILY_GOLD_CAP, utcDayStart } from '../domain/services/goldDailyCap';
import { exportBackupPayload, importBackupPayload } from '../domain/services/backupService';
import { nodeSqliteAvailable, openNodeSqliteDb, type TestDb } from './helpers/nodeSqliteDb';

const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = new Date('2026-03-10T00:30:00.000Z');
const at = (offsetMs: number) => new Date(T0.getTime() + offsetMs);

describe('règles chrono vape (pures)', () => {
  test('paliers de 30 min : 29 min 59 = 0, 30 min = 1, 95 min = 3', () => {
    expect(stepsReached(29 * 60 + 59)).toBe(0);
    expect(stepsReached(30 * 60)).toBe(1);
    expect(stepsReached(95 * 60)).toBe(3);
    expect(stepsReached(-5)).toBe(0);
    expect(stepsReached(Number.NaN)).toBe(0);
  });

  test('libellés et prochain palier', () => {
    expect(stepLabel(1)).toBe('30 min');
    expect(stepLabel(2)).toBe('1 h');
    expect(stepLabel(3)).toBe('1 h 30');
    const n = nextStepInfo(40 * 60);
    expect(n.step).toBe(2);
    expect(n.label).toBe('1 h');
    expect(n.remainingSec).toBe(20 * 60);
    expect(n.progress).toBeCloseTo(1 / 3, 5);
  });

  test('durée négative ou horodatage illisible = 0 et anomalie', () => {
    expect(safeElapsedSec('2026-03-10T10:00:00.000Z', Date.parse('2026-03-10T09:00:00.000Z'))).toEqual({
      sec: 0,
      anomaly: true,
    });
    expect(safeElapsedSec('pas-une-date', Date.now())).toEqual({ sec: 0, anomaly: true });
    expect(safeElapsedSec('2026-03-10T10:00:00.000Z', Date.parse('2026-03-10T10:01:00.000Z')).sec).toBe(60);
  });

  test('seuils de record : il faut dépasser le meilleur précédent, pas de seuil par seconde', () => {
    expect(recordThresholdsCrossed(59 * 60, 0)).toEqual([]);
    expect(recordThresholdsCrossed(3601, 0).map((t) => t.minutes)).toEqual([60]);
    expect(recordThresholdsCrossed(5 * 3600, 2 * 3600).map((t) => t.minutes)).toEqual([240]);
    expect(recordThresholdsCrossed(90 * 60, 3 * 3600)).toEqual([]);
    expect(VAPE_RECORD_BONUS.every((t, i, a) => i === 0 || t.minutes >= a[i - 1].minutes * 1.5)).toBe(true);
  });

  test('formatDuration', () => {
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(75 * 60)).toBe('1 h 15 min');
    expect(formatDuration(2 * 86400 + 3 * 3600)).toBe('2 j 3 h');
  });
});

const suite = nodeSqliteAvailable() ? describe : describe.skip;

async function seedVapeGoal(db: TestDb['db']) {
  await db.runAsync(
    `INSERT INTO goal_definitions
     (id, title, kind, unit, weight, status, template_id, sensitive, follow_without_xp, created_at)
     VALUES ('gvape', 'Vape', 'limit', 'séances', 1, 'active', 'vape_sessions', 0, 0, '2026-01-01T00:00:00.000Z')`,
  );
  await db.runAsync(
    `INSERT INTO goal_versions
     (id, goal_id, version, tier, target_value, schedule_kind, weekly_target_count, notes, effective_from, effective_to)
     VALUES ('gv1', 'gvape', 1, 'normal', 5, 'daily', NULL, NULL, '2026-01-01', NULL)`,
  );
}

async function ledgerGold(db: TestDb['db'], like = '%'): Promise<number> {
  const r = await db.getFirstAsync<{ s: number }>(
    `SELECT COALESCE(SUM(amount),0) AS s FROM wallet_ledger WHERE resource='gold' AND idempotency_key LIKE ?`,
    like,
  );
  return Number(r?.s ?? 0);
}

async function ageChallengeSession(db: TestDb['db'], sessionId: string, secondsAgo: number) {
  const started = new Date(Date.now() - secondsAgo * 1000).toISOString();
  await db.runAsync(`UPDATE challenge_sessions SET started_utc = ? WHERE id = ?`, started, sessionId);
}

suite('tracker vape — SQLite réel (node:sqlite)', () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await openNodeSqliteDb();
  });
  afterEach(() => t.close());

  describe('chrono principal', () => {
    test('la session survit à la fermeture/réouverture de la base (durée depuis les timestamps)', async () => {
      const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lq-vape-')), 'lifequest.db');
      const first = await openNodeSqliteDb(file);
      const started = await startVapeMainSession(first.db, T0);
      expect(started.ok).toBe(true);
      first.close();

      const second = await openNodeSqliteDb(file);
      const dash = await getVapeTrackerDashboard(second.db, at(3 * HOUR + 7 * MIN));
      expect(dash.active?.startedAt).toBe(T0.toISOString());
      expect(dash.active?.elapsedSec).toBe(3 * 3600 + 7 * 60);
      expect(dash.next?.label).toBe('3 h 30');
      second.close();
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
    });

    test('une seule session principale active ; le second démarrage renvoie la même', async () => {
      const a = await startVapeMainSession(t.db, T0);
      const b = await startVapeMainSession(t.db, at(5 * MIN));
      expect(a.ok && b.ok).toBe(true);
      if (a.ok && b.ok) {
        expect(b.alreadyActive).toBe(true);
        expect(b.session.id).toBe(a.session.id);
        expect(b.session.startedAt).toBe(T0.toISOString());
      }
      const rows = await t.db.getAllAsync(`SELECT id FROM vape_main_sessions WHERE status = 'active'`);
      expect(rows).toHaveLength(1);
      await expect(
        t.db.runAsync(
          `INSERT INTO vape_main_sessions (id, status, started_at, created_at, updated_at) VALUES ('x','active','a','a','a')`,
        ),
      ).rejects.toThrow(/unique/i);
    });

    test('« J\'ai vapoté » clôture une fois (double appui), conserve la durée et permet de repartir', async () => {
      await startVapeMainSession(t.db, T0);
      const [d1, d2] = await Promise.all([
        declareVape(t.db, { now: at(2 * HOUR) }),
        declareVape(t.db, { now: at(2 * HOUR) }),
      ]);
      const oks = [d1, d2].filter((d) => d.ok);
      expect(oks).toHaveLength(1);
      expect([d1, d2].find((d) => !d.ok)).toMatchObject({ ok: false, code: 'no_active' });

      const closed = await t.db.getAllAsync<{ status: string; duration_sec: number }>(
        `SELECT status, duration_sec FROM vape_main_sessions`,
      );
      expect(closed).toEqual([{ status: 'closed', duration_sec: 2 * 3600 }]);

      const restart = await startVapeMainSession(t.db, at(2 * HOUR + MIN));
      expect(restart.ok && !restart.alreadyActive).toBe(true);
      const all = await t.db.getAllAsync(`SELECT id FROM vape_main_sessions`);
      expect(all).toHaveLength(2);
    });

    test('correction : annuler la déclaration, corriger l\'heure, annuler un intervalle — sans rien effacer', async () => {
      await startVapeMainSession(t.db, T0);
      const d = await declareVape(t.db, { now: at(2 * HOUR) });
      expect(d.ok).toBe(true);

      const undo = await undoLastDeclaration(t.db, at(2 * HOUR + MIN));
      expect(undo.ok).toBe(true);
      let dash = await getVapeTrackerDashboard(t.db, at(3 * HOUR));
      expect(dash.active?.elapsedSec).toBe(3 * 3600);

      await declareVape(t.db, { now: at(3 * HOUR) });
      const amend = await amendLastDeclarationTime(t.db, at(2 * HOUR + 30 * MIN), at(3 * HOUR + MIN));
      expect(amend).toEqual({ ok: true, durationSec: 2 * 3600 + 30 * 60 });
      const later = await amendLastDeclarationTime(t.db, at(3 * HOUR), at(3 * HOUR + MIN));
      expect(later).toMatchObject({ ok: false, code: 'invalid_time' });
      const row = await t.db.getFirstAsync<{ original_ended_at: string; ended_at: string }>(
        `SELECT original_ended_at, ended_at FROM vape_main_sessions`,
      );
      expect(row?.original_ended_at).toBe(at(3 * HOUR).toISOString());
      expect(row?.ended_at).toBe(at(2 * HOUR + 30 * MIN).toISOString());

      const last = await t.db.getFirstAsync<{ id: string }>(`SELECT id FROM vape_main_sessions`);
      expect((await voidVapeSession(t.db, last!.id, at(4 * HOUR))).ok).toBe(true);
      dash = await getVapeTrackerDashboard(t.db, at(4 * HOUR));
      expect(dash.recordSec).toBe(0);
      expect(dash.history).toHaveLength(1);
      expect(dash.history[0].voided).toBe(true);
      const kinds = await t.db.getAllAsync<{ kind: string }>(`SELECT kind FROM vape_events ORDER BY occurred_at, rowid`);
      expect(kinds.map((k) => k.kind)).toEqual(
        expect.arrayContaining(['main_start', 'main_close', 'main_reopen', 'main_amend', 'main_void']),
      );
      expect(await t.db.getAllAsync(`SELECT id FROM vape_main_sessions`)).toHaveLength(1);
    });

    test('annuler ne peut pas masquer un chrono déjà relancé', async () => {
      await startVapeMainSession(t.db, T0);
      await declareVape(t.db, { now: at(HOUR) });
      await startVapeMainSession(t.db, at(HOUR + MIN));
      expect(await undoLastDeclaration(t.db, at(HOUR + 2 * MIN))).toMatchObject({ ok: false, code: 'active_exists' });
    });

    test('horloge anormale / heure incohérente : aucune durée inventée, aucun or', async () => {
      await startVapeMainSession(t.db, T0);
      const early = at(-2 * HOUR);
      const dash = await getVapeTrackerDashboard(t.db, early);
      expect(dash.active?.clockAnomaly).toBe(true);
      expect(dash.active?.elapsedSec).toBe(0);
      expect(dash.next).toBeNull();
      expect(dash.claim).toBeNull();
      expect(await claimVapeRewards(t.db, { confirmed: true, now: early })).toMatchObject({ ok: false });
      expect(await declareVape(t.db, { now: early })).toMatchObject({ ok: false, code: 'clock_anomaly' });
      expect(await declareVape(t.db, { endedAt: at(-MIN), now: at(HOUR) })).toMatchObject({
        ok: false,
        code: 'invalid_time',
      });
      expect(await declareVape(t.db, { endedAt: at(2 * HOUR), now: at(HOUR) })).toMatchObject({
        ok: false,
        code: 'invalid_time',
      });
      expect(await ledgerGold(t.db)).toBe(0);
    });

    test('heure passée déclarée (« il y a 20 min ») : durée calculée jusqu\'à cette heure', async () => {
      await startVapeMainSession(t.db, T0);
      const r = await declareVape(t.db, { endedAt: at(HOUR), now: at(HOUR + 20 * MIN) });
      expect(r.ok && r.durationSec).toBe(3600);
    });
  });

  describe('paliers et récompenses', () => {
    test('confirmation explicite obligatoire ; rien sans confirmation', async () => {
      await startVapeMainSession(t.db, T0);
      const r = await claimVapeRewards(t.db, { confirmed: false, now: at(2 * HOUR) });
      expect(r).toEqual({ ok: false, code: 'not_confirmed' });
      expect(await ledgerGold(t.db)).toBe(0);
    });

    test('rien avant 30 min', async () => {
      await startVapeMainSession(t.db, T0);
      expect(await claimVapeRewards(t.db, { confirmed: true, now: at(29 * MIN + 59_000) })).toMatchObject({
        ok: false,
        code: 'nothing_to_claim',
      });
    });

    test('crédit du montant réel, solde = ledger, clé unique session+palier', async () => {
      await startVapeMainSession(t.db, T0);
      await rpgRepo.addGold(t.db, 100, 'départ', 'seed:gold');
      const r = await claimVapeRewards(t.db, { confirmed: true, now: at(95 * MIN) });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.stepsValidated).toBe(3);
      expect(r.recordBonuses).toEqual([{ minutes: 60, gold: 4 }]);
      const expected = 3 * VAPE_STEP_GOLD + 4;
      expect(r.grantedGold).toBe(expected);
      expect(r.balance).toBe(100 + expected);
      expect(r.message).toContain(`+${expected} or reçus`);
      expect(r.message).toContain(`Solde : ${r.balance} or`);
      expect(await ledgerGold(t.db, 'vape:%')).toBe(r.grantedGold);
      const keys = await t.db.getAllAsync<{ idempotency_key: string }>(
        `SELECT idempotency_key FROM wallet_ledger WHERE idempotency_key LIKE 'vape:main:%' ORDER BY idempotency_key`,
      );
      expect(keys).toHaveLength(3);
      expect(keys[0].idempotency_key).toMatch(/^vape:main:.+:step:1$/);

      const dash = await getVapeTrackerDashboard(t.db, at(95 * MIN));
      expect(dash.recentRewards.reduce((s, x) => s + x.amount, 0)).toBe(r.grantedGold);
      expect(dash.goldBalance).toBe(r.balance);
      expect(dash.claim).toBeNull();
    });

    test('deux réclamations simultanées = un seul crédit', async () => {
      await startVapeMainSession(t.db, T0);
      const now = at(2 * HOUR);
      const [a, b] = await Promise.all([
        claimVapeRewards(t.db, { confirmed: true, now }),
        claimVapeRewards(t.db, { confirmed: true, now }),
      ]);
      expect([a, b].filter((x) => x.ok)).toHaveLength(1);
      expect([a, b].find((x) => !x.ok)).toMatchObject({ code: 'nothing_to_claim' });
      expect(await ledgerGold(t.db, 'vape:main:%')).toBe(4 * VAPE_STEP_GOLD);
      const claims = await t.db.getAllAsync(`SELECT id FROM vape_main_claims WHERE kind = 'step'`);
      expect(claims).toHaveLength(4);
    });

    test('pas de re-récompense après redémarrage, clôture ou annulation/relance', async () => {
      await startVapeMainSession(t.db, T0);
      await claimVapeRewards(t.db, { confirmed: true, now: at(HOUR) });
      const paid = await ledgerGold(t.db, 'vape:%');
      expect(paid).toBe(2 * VAPE_STEP_GOLD + 4);

      await declareVape(t.db, { now: at(HOUR + 10 * MIN) });
      expect(await claimVapeRewards(t.db, { confirmed: true, now: at(HOUR + 11 * MIN) })).toMatchObject({
        ok: false,
      });
      await undoLastDeclaration(t.db, at(HOUR + 12 * MIN));
      await declareVape(t.db, { now: at(HOUR + 20 * MIN) });
      await startVapeMainSession(t.db, at(HOUR + 21 * MIN));
      await claimVapeRewards(t.db, { confirmed: true, now: at(HOUR + 40 * MIN) });
      expect(await ledgerGold(t.db, 'vape:%')).toBe(paid);
    });

    test('un nouvel intervalle ne re-récompense pas les paliers de l\'ancien, mais a les siens', async () => {
      await startVapeMainSession(t.db, T0);
      await claimVapeRewards(t.db, { confirmed: true, now: at(HOUR) });
      await declareVape(t.db, { now: at(HOUR + MIN) });
      await startVapeMainSession(t.db, at(HOUR + 2 * MIN));
      const r = await claimVapeRewards(t.db, { confirmed: true, now: at(HOUR + 2 * MIN + 31 * MIN) });
      expect(r.ok && r.stepsValidated).toBe(1);
      expect(await ledgerGold(t.db, 'vape:main:%')).toBe(3 * VAPE_STEP_GOLD);
    });

    test('plafond partagé avec les quêtes renouvelables (50 or/jour)', async () => {
      const day = at(0).toISOString();
      await rpgRepo.addGold(t.db, SHARED_DAILY_GOLD_CAP - 3, 'quête', 'renewable:inst1:reward', day);
      await startVapeMainSession(t.db, T0);
      const r = await claimVapeRewards(t.db, { confirmed: true, now: at(3 * HOUR) });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.grantedGold).toBe(3);
      expect(r.capReached).toBe(true);
      expect(r.message).toContain('Plafond');
      expect(r.stepsValidated).toBe(6);
      expect(r.stepsWithoutGold).toBe(6);
      expect(await getRenewableGoldEarnedToday(t.db, utcDayStart(T0))).toBe(SHARED_DAILY_GOLD_CAP);
      expect(await ledgerGold(t.db, '%')).toBe(SHARED_DAILY_GOLD_CAP);

      const dash = await getVapeTrackerDashboard(t.db, at(3 * HOUR));
      expect(dash.dailyGoldRemaining).toBe(0);
    });

    test('à l\'inverse, l\'or vape réduit le plafond des quêtes renouvelables', async () => {
      const now = new Date();
      await startVapeMainSession(t.db, new Date(now.getTime() - 3 * HOUR));
      const r = await claimVapeRewards(t.db, { confirmed: true, now });
      expect(r.ok && r.grantedGold).toBe(6 * VAPE_STEP_GOLD + 4 + 5);
      const board = await getRenewableQuestBoard(t.db);
      expect(board.dailyGoldRemaining).toBe(SHARED_DAILY_GOLD_CAP - (6 * VAPE_STEP_GOLD + 9));
    });

    test('plafond atteint : paliers consommés à 0 or, pas de reversement le lendemain', async () => {
      await rpgRepo.addGold(t.db, SHARED_DAILY_GOLD_CAP, 'quêtes', 'renewable:a:reward', at(0).toISOString());
      await startVapeMainSession(t.db, T0);
      const r = await claimVapeRewards(t.db, { confirmed: true, now: at(2 * HOUR) });
      expect(r.ok && r.grantedGold).toBe(0);
      const next = await claimVapeRewards(t.db, { confirmed: true, now: at(30 * HOUR) });
      expect(next.ok && next.stepsValidated).toBe(60 - 4);
      const early = await t.db.getAllAsync<{ granted_gold: number }>(
        `SELECT granted_gold FROM vape_main_claims WHERE kind = 'step' AND step <= 4`,
      );
      expect(early).toHaveLength(4);
      expect(early.every((c) => c.granted_gold === 0)).toBe(true);
      const credited = await ledgerGold(t.db, 'vape:%');
      expect(credited).toBeLessThanOrEqual(SHARED_DAILY_GOLD_CAP);
      expect(await ledgerGold(t.db, 'vape:main:%:step:1')).toBe(0);
    });
  });

  describe('records', () => {
    test('le record est signalé à la clôture, jamais récompensé deux fois pour le même seuil', async () => {
      await startVapeMainSession(t.db, T0);
      const d1 = await declareVape(t.db, { now: at(2 * HOUR + 5 * MIN) });
      expect(d1.ok && d1.newRecord).toBe(true);
      const c1 = await claimVapeRewards(t.db, { confirmed: true, now: at(2 * HOUR + 6 * MIN) });
      expect(c1.ok).toBe(true);
      if (!c1.ok) return;
      expect(c1.recordBonuses.map((r) => r.minutes)).toEqual([60, 120]);
      const gold1 = await ledgerGold(t.db, 'vape:record:%');
      expect(gold1).toBe(4 + 5);

      const base = 3 * HOUR;
      await startVapeMainSession(t.db, at(base));
      const mid = await getVapeTrackerDashboard(t.db, at(base + 2 * HOUR + 10 * MIN));
      expect(mid.currentIsRecord).toBe(true);
      const c2 = await claimVapeRewards(t.db, { confirmed: true, now: at(base + 2 * HOUR + 10 * MIN) });
      expect(c2.ok && c2.recordBonuses).toEqual([]);
      expect(await ledgerGold(t.db, 'vape:record:%')).toBe(gold1);

      const c3 = await claimVapeRewards(t.db, { confirmed: true, now: at(base + 4 * HOUR + 1) });
      expect(c3.ok && c3.recordBonuses.map((r) => r.minutes)).toEqual([240]);
      const c4 = await claimVapeRewards(t.db, { confirmed: true, now: at(base + 4 * HOUR + 40 * MIN) });
      expect(c4.ok && c4.recordBonuses).toEqual([]);
      expect(await t.db.getAllAsync(`SELECT step FROM vape_main_claims WHERE kind = 'record'`)).toHaveLength(3);
    });

    test('un intervalle plus court que le record ne signale pas de record', async () => {
      await startVapeMainSession(t.db, T0);
      await declareVape(t.db, { now: at(3 * HOUR) });
      await startVapeMainSession(t.db, at(3 * HOUR + MIN));
      const d = await declareVape(t.db, { now: at(3 * HOUR + 31 * MIN) });
      expect(d.ok && d.newRecord).toBe(false);
      const dash = await getVapeTrackerDashboard(t.db, at(4 * HOUR));
      expect(dash.recordSec).toBe(3 * 3600);
    });

    test('longue session (retour après plusieurs jours) : durée exacte, or borné par le plafond', async () => {
      await startVapeMainSession(t.db, T0);
      const now = at(5 * 24 * HOUR);
      const dash = await getVapeTrackerDashboard(t.db, now);
      expect(dash.active?.elapsedSec).toBe(5 * 86400);
      const r = await claimVapeRewards(t.db, { confirmed: true, now });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.stepsValidated).toBe(5 * 48);
      expect(r.grantedGold).toBeLessThanOrEqual(SHARED_DAILY_GOLD_CAP);
      expect(r.capReached).toBe(true);
      expect(await ledgerGold(t.db, 'vape:%')).toBe(r.grantedGold);
    });
  });

  describe('envies et anciens défis', () => {
    test('« J\'ai une envie » : événement + défi existant, aucun or à la déclaration', async () => {
      await startVapeMainSession(t.db, T0);
      const r = await declareCraving(t.db, 'delay_craving', at(HOUR));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.attempt.format).toBe('delay_craving');
      expect(await ledgerGold(t.db)).toBe(0);
      const ev = await t.db.getFirstAsync<{ attempt_id: string; session_id: string }>(
        `SELECT attempt_id, session_id FROM vape_events WHERE kind = 'craving_declared'`,
      );
      expect(ev?.attempt_id).toBe(r.attempt.id);
      expect(ev?.session_id).toBeTruthy();

      const again = await declareCraving(t.db, 'breathing');
      expect(again).toMatchObject({ ok: false, code: 'already_running' });

      const dash = await getVapeTrackerDashboard(t.db);
      expect(dash.craving?.attemptId).toBe(r.attempt.id);
      expect(dash.craving?.targetSec).toBe(5 * 60);
    });

    test('envie tenue : impossible avant la cible, puis succès avec l\'or existant (une fois par palier)', async () => {
      const r = await declareCraving(t.db, 'delay_craving');
      if (!r.ok) throw new Error('craving');
      expect(await resolveCraving(t.db, r.attempt.id, 'held')).toMatchObject({ ok: false, code: 'too_early' });
      await ageChallengeSession(t.db, r.attempt.challengeSessionId!, 5 * 60 + 5);
      const done = await resolveCraving(t.db, r.attempt.id, 'held');
      expect(done).toMatchObject({ ok: true, outcome: 'success', goldGranted: true });
      expect(await ledgerGold(t.db, 'adaptive:vape:%')).toBe(3);

      const r2 = await declareCraving(t.db, 'delay_craving');
      if (!r2.ok) throw new Error('craving2');
      await ageChallengeSession(t.db, r2.attempt.challengeSessionId!, 5 * 60 + 5);
      const done2 = await resolveCraving(t.db, r2.attempt.id, 'held');
      expect(done2.ok && done2.goldGranted).toBe(false);
      expect(await ledgerGold(t.db, 'adaptive:vape:%')).toBe(3);
    });

    test('envie cédée : échec conservé, le chrono principal est clôturé, aucun or', async () => {
      await startVapeMainSession(t.db, T0);
      const r = await declareCraving(t.db, 'breathing');
      if (!r.ok) throw new Error('craving');
      const res = await resolveCraving(t.db, r.attempt.id, 'gave_in', at(HOUR));
      expect(res).toMatchObject({ ok: true, outcome: 'failure', mainClosed: true, goldGranted: false });
      const main = await t.db.getFirstAsync<{ status: string }>(`SELECT status FROM vape_main_sessions`);
      expect(main?.status).toBe('closed');
      const att = await t.db.getFirstAsync<{ outcome: string }>(`SELECT outcome FROM adaptive_challenge_attempts`);
      expect(att?.outcome).toBe('failure');
      expect(await ledgerGold(t.db)).toBe(0);
    });

    test('« Ne pas renseigner » : résultat inconnu, aucun or, historique conservé', async () => {
      const r = await declareCraving(t.db, 'delay_craving');
      if (!r.ok) throw new Error('craving');
      const res = await resolveCraving(t.db, r.attempt.id, 'skip');
      expect(res).toMatchObject({ ok: true, outcome: 'unknown', goldGranted: false });
      const dash = await getVapeTrackerDashboard(t.db);
      expect(dash.recentCravings).toHaveLength(1);
      expect(dash.recentCravings[0].outcome).toBe('unknown');
      expect(dash.craving).toBeNull();
    });

    test('« J\'ai vapoté » ferme aussi une envie en cours (échec)', async () => {
      await startVapeMainSession(t.db, T0);
      const r = await declareCraving(t.db, 'delay_craving');
      if (!r.ok) throw new Error('craving');
      await declareVape(t.db, { now: at(HOUR) });
      const att = await t.db.getFirstAsync<{ outcome: string }>(
        `SELECT outcome FROM adaptive_challenge_attempts WHERE id = ?`,
        r.attempt.id,
      );
      expect(att?.outcome).toBe('failure');
    });

    test('deux chronos vape incompatibles jamais en parallèle', async () => {
      await seedVapeGoal(t.db);
      await startVapeMainSession(t.db, T0);
      expect(await startVapeAdaptiveChallenge(t.db, 'record')).toMatchObject({ ok: false, code: 'main_chrono_active' });
      expect(await startVapeAdaptiveChallenge(t.db, 'interval')).toMatchObject({ ok: false, code: 'main_chrono_active' });
      const delay = await startVapeAdaptiveChallenge(t.db, 'delay_craving');
      expect(delay.ok).toBe(true);
      if (delay.ok) await closeVapeAdaptiveChallenge(t.db, delay.attempt.id, 'unknown');
      await declareVape(t.db, { now: at(HOUR) });

      const legacy = await startVapeAdaptiveChallenge(t.db, 'record');
      expect(legacy.ok).toBe(true);
      expect(await startVapeMainSession(t.db, at(2 * HOUR))).toEqual({ ok: false, code: 'legacy_timer_running' });
      if (legacy.ok) await closeVapeAdaptiveChallenge(t.db, legacy.attempt.id, 'unknown');
      expect((await startVapeMainSession(t.db, at(2 * HOUR))).ok).toBe(true);
    });

    test('anciens défis et suivis vape inchangés (tentatives, records, goal_definitions)', async () => {
      await seedVapeGoal(t.db);
      const s = await startVapeAdaptiveChallenge(t.db, 'record');
      if (!s.ok) throw new Error('start');
      await ageChallengeSession(t.db, s.attempt.challengeSessionId!, 90 * 60);
      await closeVapeAdaptiveChallenge(t.db, s.attempt.id, 'vaped');
      const rec = await t.db.getFirstAsync<{ best_duration_sec: number }>(
        `SELECT best_duration_sec FROM adaptive_challenge_records WHERE format = 'record'`,
      );
      expect(rec!.best_duration_sec).toBeGreaterThanOrEqual(89 * 60);
      const goals = await t.db.getAllAsync(`SELECT id FROM goal_definitions WHERE template_id = 'vape_sessions'`);
      expect(goals).toHaveLength(1);
    });

    test('or des défis vape adaptatifs soumis au plafond partagé', async () => {
      await seedVapeGoal(t.db);
      await rpgRepo.addGold(t.db, SHARED_DAILY_GOLD_CAP, 'quêtes', 'renewable:z:reward');
      const s = await startVapeAdaptiveChallenge(t.db, 'delay_craving');
      if (!s.ok) throw new Error('start');
      await ageChallengeSession(t.db, s.attempt.challengeSessionId!, 6 * 60);
      const done = await closeVapeAdaptiveChallenge(t.db, s.attempt.id, 'completed');
      expect(done.ok && done.attempt.outcome).toBe('success');
      expect(done.ok && done.goldGranted).toBe(false);
      expect(await ledgerGold(t.db, 'adaptive:vape:%')).toBe(0);
    });
  });

  describe('données', () => {
    test('migration 011→012 sans perte, tables additives créées', async () => {
      await t.db.execAsync(`
        DROP TABLE vape_events;
        DROP TABLE vape_main_claims;
        DROP TABLE vape_main_sessions;
        DELETE FROM schema_migrations WHERE version = 12;
      `);
      await seedVapeGoal(t.db);
      await t.db.execAsync(`
        INSERT INTO wallet_ledger (id, resource, amount, reason, idempotency_key, created_at)
          VALUES ('w1', 'gold', 15, 'quête', 'renewable:x:reward', '2026-01-05T10:00:00.000Z');
        INSERT INTO challenge_sessions (id, type, started_utc, ended_utc, target_duration_sec, state, duration_sec, user_confirmed, user_confirmed_duration_sec, created_at, updated_at)
          VALUES ('c1', 'no_vape', '2026-01-05T10:00:00.000Z', '2026-01-05T11:00:00.000Z', NULL, 'completed', 3600, 1, NULL, '2026-01-05T10:00:00.000Z', '2026-01-05T11:00:00.000Z');
        INSERT INTO adaptive_challenge_attempts (id, habit_category, format, tier_index, outcome, challenge_session_id, target_duration_sec, declared_duration_sec, started_at, ended_at, created_at, updated_at)
          VALUES ('a1', 'A', 'record', 0, 'failure', 'c1', NULL, 3600, '2026-01-05T10:00:00.000Z', '2026-01-05T11:00:00.000Z', '2026-01-05T10:00:00.000Z', '2026-01-05T11:00:00.000Z');
      `);
      const tables = ['goal_definitions', 'goal_versions', 'wallet_ledger', 'challenge_sessions', 'adaptive_challenge_attempts'];
      const snap = async () => {
        const out: Record<string, unknown[]> = {};
        for (const tb of tables) out[tb] = await t.db.getAllAsync(`SELECT * FROM ${tb} ORDER BY 1`);
        return out;
      };
      const before = await snap();
      await migrate(t.db);
      expect(await snap()).toEqual(before);
      const applied = await t.db.getAllAsync<{ version: number }>(`SELECT version FROM schema_migrations ORDER BY version`);
      expect(applied.map((r) => r.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      const names = await t.db.getAllAsync<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'vape_%' ORDER BY name`,
      );
      expect(names.map((n) => n.name)).toEqual(['vape_events', 'vape_main_claims', 'vape_main_sessions']);
    });

    test('les nouvelles tables sont exportées et restaurées avec la sauvegarde', async () => {
      await startVapeMainSession(t.db, T0);
      await claimVapeRewards(t.db, { confirmed: true, now: at(HOUR + 5 * MIN) });
      await declareVape(t.db, { now: at(HOUR + 10 * MIN) });
      await startVapeMainSession(t.db, at(HOUR + 11 * MIN));

      const payload = await exportBackupPayload(t.db, '0.1.0');
      expect(payload.data.vape_main_sessions).toHaveLength(2);
      expect(payload.data.vape_main_claims).toHaveLength(3);
      expect(payload.data.vape_events.length).toBeGreaterThanOrEqual(4);

      const other = await openNodeSqliteDb();
      await importBackupPayload(other.db, payload.manifest as { format?: string; appVersion?: string }, payload.data);
      const sessions = await other.db.getAllAsync<{ status: string }>(`SELECT status FROM vape_main_sessions ORDER BY started_at`);
      expect(sessions.map((s) => s.status)).toEqual(['closed', 'active']);
      expect(await other.db.getAllAsync(`SELECT id FROM vape_main_claims`)).toHaveLength(3);
      const dash = await getVapeTrackerDashboard(other.db, at(2 * HOUR));
      expect(dash.active?.startedAt).toBe(at(HOUR + 11 * MIN).toISOString());
      expect(dash.goldBalance).toBe(2 * VAPE_STEP_GOLD + 4);
      other.close();
    });
  });
});
