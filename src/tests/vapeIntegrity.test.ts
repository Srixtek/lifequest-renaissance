jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: '/tmp/',
  documentDirectory: '/tmp/',
  EncodingType: { Base64: 'base64' },
  writeAsStringAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
}));

import * as rpgRepo from '../data/db/repositories/rpgRepo';
import { MAX_STEPS_PER_CLAIM, VAPE_STEP_GOLD, allocateClaim, claimOfferTexts } from '../domain/rules/vapeMain';
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
import { SHARED_DAILY_GOLD_CAP } from '../domain/services/goldDailyCap';
import { nodeSqliteAvailable, openNodeSqliteDb, type TestDb } from './helpers/nodeSqliteDb';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = new Date('2026-03-10T00:30:00.000Z');
const at = (offsetMs: number) => new Date(T0.getTime() + offsetMs);

describe('V1-02A-R — règles pures', () => {
  test('allocateClaim : records d\'abord, un record à 0 or n\'est pas consommé, paliers à 0 or consommés', () => {
    const a = allocateClaim([{ minutes: 60, gold: 4 }], [1, 2, 3], 3);
    expect(a.records).toEqual([{ minutes: 60, gold: 3 }]);
    expect(a.paidSteps).toEqual([]);
    expect(a.zeroGoldSteps).toEqual([1, 2, 3]);
    expect(a.granted).toBe(3);

    const none = allocateClaim([{ minutes: 60, gold: 4 }], [1, 2], 0);
    expect(none.records).toEqual([]);
    expect(none.zeroGoldSteps).toEqual([1, 2]);
    expect(none.granted).toBe(0);

    const partial = allocateClaim([], [1, 2, 3], 3);
    expect(partial.paidSteps).toEqual([
      { step: 1, gold: VAPE_STEP_GOLD },
      { step: 2, gold: 1 },
    ]);
    expect(partial.zeroGoldSteps).toEqual([3]);
  });

  test('claimOfferTexts : plafond atteint = « palier validé, 0 or (plafond atteint) », jamais de promesse de bonus', () => {
    const zero = claimOfferTexts({
      stepsPending: 2,
      recordBonusCount: 0,
      creditableGold: 0,
      dailyGoldRemaining: 0,
      dailyGoldCap: 50,
    });
    expect(zero.zeroGold).toBe(true);
    expect(zero.summary).toContain('0 or (plafond atteint)');
    expect(zero.summary).not.toMatch(/bonus de record/);
    expect(zero.confirmLabel).toContain('0 or');

    const normal = claimOfferTexts({
      stepsPending: 2,
      recordBonusCount: 1,
      creditableGold: 8,
      dailyGoldRemaining: 40,
      dailyGoldCap: 50,
    });
    expect(normal.zeroGold).toBe(false);
    expect(normal.summary).toContain('+8 or');
    expect(normal.summary).toContain('bonus de record');
  });
});

const suite = nodeSqliteAvailable() ? describe : describe.skip;

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

async function sessionStatus(db: TestDb['db'], id: string) {
  return db.getFirstAsync<{ status: string; ended_at: string | null; duration_sec: number | null }>(
    `SELECT status, ended_at, duration_sec FROM vape_main_sessions WHERE id = ?`,
    id,
  );
}

async function startOk(db: TestDb['db'], when: Date): Promise<string> {
  const r = await startVapeMainSession(db, when);
  if (!r.ok) throw new Error('start');
  return r.session.id;
}

suite('V1-02A-R — intégrité du tracker vape (SQLite réel)', () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await openNodeSqliteDb();
  });
  afterEach(() => t.close());

  describe('1. paliers à 0 or validables', () => {
    test('plafond atteint : l\'offre existe, valide à 0 or, persiste et ne rapporte jamais d\'or le lendemain', async () => {
      await rpgRepo.addGold(t.db, SHARED_DAILY_GOLD_CAP, 'quêtes', 'renewable:a:reward', at(0).toISOString());
      const id = await startOk(t.db, T0);
      const now = at(2 * HOUR + 5 * MIN);

      const dash = await getVapeTrackerDashboard(t.db, now);
      expect(dash.dailyGoldRemaining).toBe(0);
      expect(dash.claims).toHaveLength(1);
      const offer = dash.claims[0];
      expect(offer).toMatchObject({ sessionId: id, stepsPending: 4, creditableGold: 0, stepsWithoutGold: 4, capReached: true });
      expect(offer.recordsPending).toEqual([]);
      const texts = claimOfferTexts({
        stepsPending: offer.stepsPending,
        recordBonusCount: offer.recordsPending.length,
        creditableGold: offer.creditableGold,
        dailyGoldRemaining: dash.dailyGoldRemaining,
        dailyGoldCap: dash.dailyGoldCap,
      });
      expect(texts.summary).toContain('0 or (plafond atteint)');

      const r = await claimVapeRewards(t.db, { confirmed: true, sessionId: id, now });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r).toMatchObject({ grantedGold: 0, stepsValidated: 4, stepsWithoutGold: 4, capReached: true });
      expect(r.message).toContain('Palier validé, 0 or (plafond journalier atteint)');
      expect(await ledgerGold(t.db, 'vape:%')).toBe(0);
      const claims = await t.db.getAllAsync<{ granted_gold: number }>(`SELECT granted_gold FROM vape_main_claims WHERE kind = 'step'`);
      expect(claims).toHaveLength(4);
      expect(claims.every((c) => c.granted_gold === 0)).toBe(true);

      const nextDay = at(DAY + 2 * HOUR + 5 * MIN);
      const dash2 = await getVapeTrackerDashboard(t.db, nextDay);
      expect(dash2.dailyGoldRemaining).toBe(SHARED_DAILY_GOLD_CAP);
      expect(dash2.claims.every((c) => c.stepsPending > 0 && c.creditableGold > 0)).toBe(true);
      const again = await claimVapeRewards(t.db, { confirmed: true, sessionId: id, now: at(2 * HOUR + 10 * MIN) });
      expect(again).toMatchObject({ ok: false, code: 'nothing_to_claim' });
      expect(await ledgerGold(t.db, 'vape:main:%:step:_')).toBe(0);
      expect(await ledgerGold(t.db, 'vape:main:%:step:1')).toBe(0);
    });

    test('plafond atteint puis le palier suivant, jour suivant : seuls les nouveaux paliers paient', async () => {
      await rpgRepo.addGold(t.db, SHARED_DAILY_GOLD_CAP, 'quêtes', 'renewable:a:reward', at(0).toISOString());
      const id = await startOk(t.db, T0);
      await claimVapeRewards(t.db, { confirmed: true, sessionId: id, now: at(HOUR + 5 * MIN) });
      const r = await claimVapeRewards(t.db, { confirmed: true, sessionId: id, now: at(DAY + 2 * HOUR) });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const paidSteps = (await t.db.getAllAsync<{ step: number }>(
        `SELECT step FROM vape_main_claims WHERE kind = 'step' AND granted_gold > 0 ORDER BY step`,
      )).map((x) => x.step);
      expect(Math.min(...paidSteps)).toBeGreaterThan(2);
    });

    test('un bonus de record non payé à cause du plafond reste réclamable (non consommé) et est proposé sans promesse tant que le plafond tient', async () => {
      await rpgRepo.addGold(t.db, SHARED_DAILY_GOLD_CAP, 'quêtes', 'renewable:a:reward', at(0).toISOString());
      const id = await startOk(t.db, T0);
      await declareVape(t.db, { now: at(HOUR + 5 * MIN) });
      const capped = await claimVapeRewards(t.db, { confirmed: true, sessionId: id, now: at(HOUR + 10 * MIN) });
      expect(capped).toMatchObject({ ok: true, grantedGold: 0, recordBonuses: [] });
      expect(await t.db.getAllAsync(`SELECT id FROM vape_main_claims WHERE kind = 'record'`)).toHaveLength(0);

      const sameDay = await getVapeTrackerDashboard(t.db, at(HOUR + 20 * MIN));
      expect(sameDay.claims).toEqual([]);

      const tomorrow = at(DAY);
      const dash = await getVapeTrackerDashboard(t.db, tomorrow);
      expect(dash.claims).toHaveLength(1);
      expect(dash.claims[0]).toMatchObject({ sessionId: id, stepsPending: 0, creditableGold: 4 });
      expect(dash.claims[0].recordsPending).toEqual([{ minutes: 60, gold: 4 }]);
      const r = await claimVapeRewards(t.db, { confirmed: true, sessionId: id, now: tomorrow });
      expect(r).toMatchObject({ ok: true, grantedGold: 4, stepsValidated: 0 });
      expect(await ledgerGold(t.db, 'vape:record:%')).toBe(4);
    });
  });

  describe('2. intervalles historiques réclamables après un redémarrage', () => {
    test('deux intervalles successifs : le premier est réclamé après le démarrage du second, sans mélange', async () => {
      const a = await startOk(t.db, T0);
      await declareVape(t.db, { now: at(95 * MIN) });
      const b = await startOk(t.db, at(96 * MIN));
      const now = at(96 * MIN + 65 * MIN);

      const dash = await getVapeTrackerDashboard(t.db, now);
      expect(dash.active?.id).toBe(b);
      expect(dash.claims.map((c) => c.sessionId)).toEqual([b, a]);
      const [forB, forA] = dash.claims;
      expect(forB).toMatchObject({ sessionActive: true, endedAt: null, stepsPending: 2, confirmedSec: 65 * 60 });
      expect(forA).toMatchObject({
        sessionActive: false,
        startedAt: T0.toISOString(),
        endedAt: at(95 * MIN).toISOString(),
        stepsPending: 3,
        confirmedSec: 95 * 60,
      });

      const rA = await claimVapeRewards(t.db, { confirmed: true, sessionId: a, now });
      expect(rA).toMatchObject({ ok: true, sessionId: a, stepsValidated: 3 });
      if (rA.ok) expect(rA.recordBonuses).toEqual([{ minutes: 60, gold: 4 }]);

      const claimsA = await t.db.getAllAsync<{ session_id: string; step: number; kind: string }>(
        `SELECT session_id, step, kind FROM vape_main_claims`,
      );
      expect(claimsA.every((c) => c.session_id === a)).toBe(true);
      const keys = await t.db.getAllAsync<{ idempotency_key: string }>(
        `SELECT idempotency_key FROM wallet_ledger WHERE idempotency_key LIKE 'vape:main:%'`,
      );
      expect(keys.every((k) => k.idempotency_key.includes(a))).toBe(true);
      expect((await sessionStatus(t.db, b))?.status).toBe('active');

      const dash2 = await getVapeTrackerDashboard(t.db, now);
      expect(dash2.claims.map((c) => c.sessionId)).toEqual([b]);

      const rB = await claimVapeRewards(t.db, { confirmed: true, sessionId: b, now });
      expect(rB).toMatchObject({ ok: true, sessionId: b, stepsValidated: 2 });
      expect(await ledgerGold(t.db, 'vape:main:%')).toBe(5 * VAPE_STEP_GOLD);
      expect(await claimVapeRewards(t.db, { confirmed: true, sessionId: a, now })).toMatchObject({ code: 'nothing_to_claim' });
    });

    test('redémarrage immédiat toujours possible avec des récompenses en attente ; id de période vérifié', async () => {
      const a = await startOk(t.db, T0);
      await declareVape(t.db, { now: at(HOUR) });
      const restart = await startVapeMainSession(t.db, at(HOUR));
      expect(restart.ok && !restart.alreadyActive).toBe(true);

      expect(await claimVapeRewards(t.db, { confirmed: true, sessionId: 'vms_inconnu', now: at(2 * HOUR) })).toMatchObject({
        ok: false,
        code: 'session_unavailable',
      });
      expect(await claimVapeRewards(t.db, { confirmed: false, sessionId: a, now: at(2 * HOUR) })).toMatchObject({
        code: 'not_confirmed',
      });
      expect(await ledgerGold(t.db)).toBe(0);
    });

    test('une période annulée n\'est plus réclamable ; une période n\'est jamais créditée sur une autre', async () => {
      const a = await startOk(t.db, T0);
      await declareVape(t.db, { now: at(HOUR) });
      expect((await voidVapeSession(t.db, a, at(HOUR + MIN))).ok).toBe(true);
      expect(await claimVapeRewards(t.db, { confirmed: true, sessionId: a, now: at(2 * HOUR) })).toMatchObject({
        code: 'session_unavailable',
      });
      const b = await startOk(t.db, at(2 * HOUR));
      const r = await claimVapeRewards(t.db, { confirmed: true, sessionId: b, now: at(3 * HOUR) });
      expect(r).toMatchObject({ ok: true, sessionId: b, stepsValidated: 2 });
      expect((await t.db.getAllAsync<{ session_id: string }>(`SELECT DISTINCT session_id FROM vape_main_claims`)).map((x) => x.session_id)).toEqual([b]);
    });

    test('records : l\'ordre de réclamation ne change pas le total (record précédent = chronologique)', async () => {
      const a = await startOk(t.db, T0);
      await declareVape(t.db, { now: at(2 * HOUR) });
      const b = await startOk(t.db, at(2 * HOUR + MIN));
      await declareVape(t.db, { now: at(2 * HOUR + MIN + 3 * HOUR) });
      const now = at(7 * HOUR);
      const rb = await claimVapeRewards(t.db, { confirmed: true, sessionId: b, now });
      const ra = await claimVapeRewards(t.db, { confirmed: true, sessionId: a, now });
      expect(rb.ok && rb.recordBonuses.map((x) => x.minutes)).toEqual([]);
      expect(ra.ok && ra.recordBonuses.map((x) => x.minutes)).toEqual([60, 120]);
      expect(await ledgerGold(t.db, 'vape:record:%')).toBe(9);
    });
  });

  describe('3. corrections et récompenses déjà attribuées', () => {
    test('avant réclamation : correction d\'heure et annulation restent libres', async () => {
      const a = await startOk(t.db, T0);
      await declareVape(t.db, { now: at(2 * HOUR) });
      expect(await amendLastDeclarationTime(t.db, at(40 * MIN), at(2 * HOUR + MIN))).toEqual({ ok: true, durationSec: 40 * 60 });
      expect((await voidVapeSession(t.db, a, at(3 * HOUR))).ok).toBe(true);
      expect((await sessionStatus(t.db, a))?.status).toBe('voided');
    });

    test('après réclamation : raccourcir sous les paliers payés est refusé, sans effet de bord', async () => {
      const a = await startOk(t.db, T0);
      await declareVape(t.db, { now: at(2 * HOUR + 10 * MIN) });
      await claimVapeRewards(t.db, { confirmed: true, sessionId: a, now: at(2 * HOUR + 11 * MIN) });
      const goldBefore = await ledgerGold(t.db);
      const eventsBefore = await t.db.getAllAsync(`SELECT id FROM vape_events`);

      const refused = await amendLastDeclarationTime(t.db, at(40 * MIN), at(2 * HOUR + 12 * MIN));
      expect(refused).toEqual({ ok: false, code: 'rewards_claimed' });
      expect(await sessionStatus(t.db, a)).toMatchObject({ status: 'closed', duration_sec: 2 * 3600 + 600 });
      expect(await ledgerGold(t.db)).toBe(goldBefore);
      expect(await t.db.getAllAsync(`SELECT id FROM vape_events`)).toHaveLength(eventsBefore.length);

      const ok = await amendLastDeclarationTime(t.db, at(2 * HOUR), at(2 * HOUR + 13 * MIN));
      expect(ok).toEqual({ ok: true, durationSec: 2 * 3600 });
      const refused2 = await amendLastDeclarationTime(t.db, at(HOUR + 59 * MIN), at(2 * HOUR + 14 * MIN));
      expect(refused2).toEqual({ ok: false, code: 'rewards_claimed' });
      expect(await ledgerGold(t.db)).toBe(goldBefore);
    });

    test('après réclamation : annuler l\'intervalle est refusé, historique, ledger et record intacts', async () => {
      const a = await startOk(t.db, T0);
      await declareVape(t.db, { now: at(2 * HOUR) });
      await claimVapeRewards(t.db, { confirmed: true, sessionId: a, now: at(2 * HOUR + MIN) });
      const goldBefore = await ledgerGold(t.db);
      await rpgRepo.spendGold(t.db, 5, 'achat', 'spend:test');

      expect(await voidVapeSession(t.db, a, at(3 * HOUR))).toEqual({ ok: false, code: 'rewards_claimed' });
      expect((await sessionStatus(t.db, a))?.status).toBe('closed');
      expect(await rpgRepo.getGoldBalance(t.db)).toBe(goldBefore - 5);
      expect(await ledgerGold(t.db, 'vape:%')).toBe(goldBefore);
      const dash = await getVapeTrackerDashboard(t.db, at(3 * HOUR));
      expect(dash.recordSec).toBe(2 * 3600);
      expect(dash.history[0].voided).toBe(false);
    });

    test('chrono actif avec paliers validés : déclarer une vape passée qui les invaliderait est refusé', async () => {
      const a = await startOk(t.db, T0);
      await claimVapeRewards(t.db, { confirmed: true, sessionId: a, now: at(5 * HOUR) });
      const refused = await declareVape(t.db, { endedAt: at(HOUR), now: at(5 * HOUR + MIN) });
      expect(refused).toEqual({ ok: false, code: 'rewards_claimed' });
      expect((await sessionStatus(t.db, a))?.status).toBe('active');
      expect(await voidVapeSession(t.db, a, at(5 * HOUR + 2 * MIN))).toEqual({ ok: false, code: 'rewards_claimed' });
      const fine = await declareVape(t.db, { endedAt: at(5 * HOUR), now: at(5 * HOUR + MIN) });
      expect(fine.ok).toBe(true);
    });

    test('annuler « J\'ai vapoté » après réclamation reste sûr : pas de double paiement', async () => {
      const a = await startOk(t.db, T0);
      await declareVape(t.db, { now: at(HOUR + 10 * MIN) });
      await claimVapeRewards(t.db, { confirmed: true, sessionId: a, now: at(HOUR + 11 * MIN) });
      const paid = await ledgerGold(t.db, 'vape:%');
      expect((await undoLastDeclaration(t.db, at(HOUR + 12 * MIN))).ok).toBe(true);
      const r = await claimVapeRewards(t.db, { confirmed: true, sessionId: a, now: at(HOUR + 20 * MIN) });
      expect(r).toMatchObject({ ok: false, code: 'nothing_to_claim' });
      expect(await ledgerGold(t.db, 'vape:%')).toBe(paid);
      const more = await claimVapeRewards(t.db, { confirmed: true, sessionId: a, now: at(2 * HOUR) });
      expect(more).toMatchObject({ ok: true, stepsValidated: 2 });
    });
  });

  describe('4. « J\'ai vapoté » et envie active : opération atomique', () => {
    test('une seule transaction : chrono clôturé + envie en échec ; l\'envie ne peut plus réussir', async () => {
      await startOk(t.db, T0);
      const c = await declareCraving(t.db, 'delay_craving');
      if (!c.ok) throw new Error('craving');
      await ageChallengeSession(t.db, c.attempt.challengeSessionId!, 10 * 60);

      const d = await declareVape(t.db, { now: at(HOUR) });
      expect(d).toMatchObject({ ok: true, cravingClosed: true });
      const att = await t.db.getFirstAsync<{ outcome: string }>(`SELECT outcome FROM adaptive_challenge_attempts WHERE id = ?`, c.attempt.id);
      expect(att?.outcome).toBe('failure');
      const held = await resolveCraving(t.db, c.attempt.id, 'held');
      expect(held).toEqual({ ok: false, code: 'not_found' });
      expect(await ledgerGold(t.db, 'adaptive:vape:%')).toBe(0);
    });

    test('interruption : si la clôture de l\'envie échoue, rien n\'est clôturé (rollback commun)', async () => {
      const id = await startOk(t.db, T0);
      const c = await declareCraving(t.db, 'delay_craving');
      if (!c.ok) throw new Error('craving');
      t.raw.exec(`CREATE TRIGGER boom BEFORE UPDATE ON adaptive_challenge_attempts BEGIN SELECT RAISE(ABORT, 'interruption'); END;`);

      await expect(declareVape(t.db, { now: at(HOUR) })).rejects.toThrow(/interruption/);
      expect((await sessionStatus(t.db, id))?.status).toBe('active');
      const att = await t.db.getFirstAsync<{ outcome: string }>(`SELECT outcome FROM adaptive_challenge_attempts WHERE id = ?`, c.attempt.id);
      expect(att?.outcome).toBe('running');
      expect(await t.db.getAllAsync(`SELECT id FROM vape_events WHERE kind = 'main_close'`)).toHaveLength(0);

      t.raw.exec(`DROP TRIGGER boom;`);
      expect(await declareVape(t.db, { now: at(HOUR) })).toMatchObject({ ok: true, cravingClosed: true });
    });

    test('échec MÉTIER (sans exception SQLite) de clôture de l\'envie : rollback commun, chrono toujours actif', async () => {
      const id = await startOk(t.db, T0);
      const c = await declareCraving(t.db, 'delay_craving');
      if (!c.ok) throw new Error('craving');
      // Envie « running » mais sans session de défi : closeVapeAdaptiveChallengeOnConn renvoie { ok: false } sans lever.
      t.raw.exec(`UPDATE adaptive_challenge_attempts SET challenge_session_id = NULL WHERE id = '${c.attempt.id}'`);

      const r = await declareVape(t.db, { now: at(HOUR) });
      expect(r).toEqual({ ok: false, code: 'craving_close_failed' });
      expect(await sessionStatus(t.db, id)).toMatchObject({ status: 'active', ended_at: null, duration_sec: null });
      const att = await t.db.getFirstAsync<{ outcome: string }>(`SELECT outcome FROM adaptive_challenge_attempts WHERE id = ?`, c.attempt.id);
      expect(att?.outcome).toBe('running');
      expect(await t.db.getAllAsync(`SELECT id FROM vape_events WHERE kind = 'main_close'`)).toHaveLength(0);

      // Réparer l'état incohérent : la déclaration réussit alors normalement.
      const cs = await t.db.getFirstAsync<{ id: string }>(`SELECT id FROM challenge_sessions ORDER BY rowid DESC LIMIT 1`);
      t.raw.exec(`UPDATE adaptive_challenge_attempts SET challenge_session_id = '${cs!.id}' WHERE id = '${c.attempt.id}'`);
      expect(await declareVape(t.db, { now: at(HOUR) })).toMatchObject({ ok: true, cravingClosed: true });
    });

    test('interruption pendant « J\'ai cédé » : ni l\'envie ni le chrono ne changent', async () => {
      const id = await startOk(t.db, T0);
      const c = await declareCraving(t.db, 'breathing');
      if (!c.ok) throw new Error('craving');
      t.raw.exec(`CREATE TRIGGER boom2 BEFORE UPDATE ON vape_main_sessions BEGIN SELECT RAISE(ABORT, 'interruption'); END;`);
      await expect(resolveCraving(t.db, c.attempt.id, 'gave_in', at(HOUR))).rejects.toThrow(/interruption/);
      expect((await sessionStatus(t.db, id))?.status).toBe('active');
      const att = await t.db.getFirstAsync<{ outcome: string }>(`SELECT outcome FROM adaptive_challenge_attempts WHERE id = ?`, c.attempt.id);
      expect(att?.outcome).toBe('running');
    });

    test('concurrence declareVape puis resolveCraving(held) : l\'envie est un échec, aucun or', async () => {
      await startOk(t.db, T0);
      const c = await declareCraving(t.db, 'delay_craving');
      if (!c.ok) throw new Error('craving');
      await ageChallengeSession(t.db, c.attempt.challengeSessionId!, 10 * 60);
      const [d, h] = await Promise.all([
        declareVape(t.db, { now: at(HOUR) }),
        resolveCraving(t.db, c.attempt.id, 'held'),
      ]);
      expect(d.ok).toBe(true);
      expect(h).toEqual({ ok: false, code: 'not_found' });
      const att = await t.db.getFirstAsync<{ outcome: string }>(`SELECT outcome FROM adaptive_challenge_attempts WHERE id = ?`, c.attempt.id);
      expect(att?.outcome).toBe('failure');
      expect(await ledgerGold(t.db, 'adaptive:vape:%')).toBe(0);
    });

    test('concurrence resolveCraving(held) puis declareVape : réussite légitime déjà acquise, chrono clôturé', async () => {
      const id = await startOk(t.db, T0);
      const c = await declareCraving(t.db, 'delay_craving');
      if (!c.ok) throw new Error('craving');
      await ageChallengeSession(t.db, c.attempt.challengeSessionId!, 10 * 60);
      const [h, d] = await Promise.all([
        resolveCraving(t.db, c.attempt.id, 'held'),
        declareVape(t.db, { now: at(HOUR) }),
      ]);
      expect(h).toMatchObject({ ok: true, outcome: 'success', goldGranted: true, goldAmount: 3 });
      expect(d).toMatchObject({ ok: true, cravingClosed: false });
      expect((await sessionStatus(t.db, id))?.status).toBe('closed');
      expect(await ledgerGold(t.db, 'adaptive:vape:%')).toBe(3);
    });

    test('double clic « J\'ai cédé » : une seule clôture, le second appel est ignoré', async () => {
      const id = await startOk(t.db, T0);
      const c = await declareCraving(t.db, 'breathing');
      if (!c.ok) throw new Error('craving');
      const [a, b] = await Promise.all([
        resolveCraving(t.db, c.attempt.id, 'gave_in', at(HOUR)),
        resolveCraving(t.db, c.attempt.id, 'gave_in', at(HOUR)),
      ]);
      expect([a, b].filter((x) => x.ok)).toHaveLength(1);
      expect([a, b].find((x) => !x.ok)).toMatchObject({ code: 'not_found' });
      expect(await t.db.getAllAsync(`SELECT id FROM vape_events WHERE kind = 'main_close'`)).toHaveLength(1);
      expect((await sessionStatus(t.db, id))?.status).toBe('closed');
    });

    test('vape déclarée dans le passé : une envie démarrée après cette heure n\'est pas clôturée', async () => {
      await startOk(t.db, new Date(Date.now() - 5 * HOUR));
      const c = await declareCraving(t.db, 'delay_craving');
      if (!c.ok) throw new Error('craving');
      const d = await declareVape(t.db, { endedAt: new Date(Date.now() - HOUR), now: new Date() });
      expect(d).toMatchObject({ ok: true, cravingClosed: false });
      const att = await t.db.getFirstAsync<{ outcome: string }>(`SELECT outcome FROM adaptive_challenge_attempts WHERE id = ?`, c.attempt.id);
      expect(att?.outcome).toBe('running');
    });
  });

  describe('5. contrôles complémentaires', () => {
    test('très long intervalle : réclamation par lots bornés, aperçu exact, pas de perte', async () => {
      await rpgRepo.addGold(t.db, SHARED_DAILY_GOLD_CAP, 'quêtes', 'renewable:a:reward', at(100 * DAY).toISOString());
      const id = await startOk(t.db, T0);
      const now = at(100 * DAY + HOUR);
      const total = 100 * 48 + 2;

      const started = Date.now();
      const dash = await getVapeTrackerDashboard(t.db, now);
      expect(dash.claims[0].stepsPending).toBe(total);

      const first = await claimVapeRewards(t.db, { confirmed: true, sessionId: id, now });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.stepsValidated).toBe(MAX_STEPS_PER_CLAIM);
      expect(first.stepsRemaining).toBe(total - MAX_STEPS_PER_CLAIM);
      expect(first.message).toContain('restent à valider');
      expect(await t.db.getAllAsync(`SELECT id FROM vape_main_claims WHERE kind = 'step'`)).toHaveLength(MAX_STEPS_PER_CLAIM);

      const second = await claimVapeRewards(t.db, { confirmed: true, sessionId: id, now });
      expect(second.ok && second.stepsValidated).toBe(MAX_STEPS_PER_CLAIM);
      const maxStep = await t.db.getFirstAsync<{ m: number }>(`SELECT MAX(step) AS m FROM vape_main_claims WHERE kind = 'step'`);
      expect(maxStep?.m).toBe(2 * MAX_STEPS_PER_CLAIM);
      expect(Date.now() - started).toBeLessThan(15_000);
    });

    test('montant affiché = montant crédité (plafond partiel sur une envie)', async () => {
      await rpgRepo.addGold(t.db, SHARED_DAILY_GOLD_CAP - 1, 'quêtes', 'renewable:a:reward');
      const c = await declareCraving(t.db, 'delay_craving');
      if (!c.ok) throw new Error('craving');
      await ageChallengeSession(t.db, c.attempt.challengeSessionId!, 6 * 60);
      const r = await resolveCraving(t.db, c.attempt.id, 'held');
      expect(r).toMatchObject({ ok: true, goldGranted: true, goldAmount: 1 });
      expect(await ledgerGold(t.db, 'adaptive:vape:%')).toBe(1);
    });

    test('le message de réclamation correspond au ledger et au solde', async () => {
      await rpgRepo.addGold(t.db, 10, 'départ', 'seed:gold');
      const id = await startOk(t.db, T0);
      const now = at(65 * MIN);
      const dash = await getVapeTrackerDashboard(t.db, now);
      const preview = dash.claims[0];
      const r = await claimVapeRewards(t.db, { confirmed: true, sessionId: id, now });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.grantedGold).toBe(preview.creditableGold);
      expect(r.message).toContain(`+${r.grantedGold} or reçus`);
      expect(r.balance).toBe(10 + r.grantedGold);
      expect(await ledgerGold(t.db, 'vape:%')).toBe(r.grantedGold);
    });
  });
});
