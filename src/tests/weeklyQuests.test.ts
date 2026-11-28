jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: '/tmp/',
  documentDirectory: '/tmp/',
  EncodingType: { Base64: 'base64' },
  writeAsStringAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
}));

import {
  abandonWeeklyQuest,
  acceptWeeklyQuest,
  claimWeeklyQuest,
  getWeeklyQuestBlock,
  listWeeklyQuestHistory,
  replaceWeeklyQuest,
  type WeeklyQuestCard,
} from '../domain/services/weeklyQuestService';
import { resolveWeeklyTarget } from '../domain/services/weeklyQuestNavigation';
import { acceptDailyQuest } from '../domain/services/dailyQuestService';
import { abandonRenewableQuest, claimRenewableQuest, getRenewableQuestBoard } from '../domain/services/renewableQuestService';
import { isEvidenceGroupPaid, isEvidencePaid } from '../domain/services/questEvidenceClaims';
import {
  cancelDiversCompletion,
  confirmDiversActivity,
  getDiversDashboard,
} from '../domain/services/diversTrackerService';
import { addCall, addContact, cancelCall } from '../domain/services/prochesTrackerService';
import { addSession, cancelSession, editSession } from '../domain/services/sportTrackerService';
import { validateSessionForm } from '../domain/rules/sport';
import { exportBackupPayload, importBackupPayload } from '../domain/services/backupService';
import { nodeSqliteAvailable, openNodeSqliteDb, type TestDb } from './helpers/nodeSqliteDb';

const suite = nodeSqliteAvailable() ? describe : describe.skip;
const TZ = 'Europe/Paris';
const at = (iso: string) => new Date(iso);
const o = (iso: string) => ({ timeZone: TZ, dayStartHour: 4, now: at(iso) });

// Semaine du lundi 2026-03-09 au dimanche 2026-03-15 (hiver, Europe/Paris).
const WEEK = '2026-03-09';
const T_ACCEPT = '2026-03-11T08:00:00.000Z';
const T_A1 = '2026-03-11T09:00:00.000Z';
const T_A2 = '2026-03-12T09:00:00.000Z';
const T_A3 = '2026-03-13T09:00:00.000Z';
const T_CLAIM = '2026-03-14T09:00:00.000Z';
const NEXT_WEEK = '2026-03-17T09:00:00.000Z';

suite('V1-04B-2 — Missions de la semaine', () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await openNodeSqliteDb();
  });
  afterEach(() => t.close());

  const count = async (tbl: string, where = '1=1') =>
    Number((await t.db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${tbl} WHERE ${where}`))?.n ?? 0);
  const goldSum = async () =>
    Number((await t.db.getFirstAsync<{ s: number }>(`SELECT COALESCE(SUM(amount),0) AS s FROM wallet_ledger WHERE resource='gold'`))?.s ?? 0);

  const forceWeek = async (weekStart: string, templates: string[]) => {
    const iso = `${weekStart}T00:00:00.000Z`;
    await t.db.runAsync(`INSERT OR IGNORE INTO weekly_quest_sets (week_start, replacements_used, created_at, updated_at) VALUES (?, 0, ?, ?)`, weekStart, iso, iso);
    for (let i = 0; i < templates.length; i++) {
      await t.db.runAsync(
        `INSERT INTO weekly_quest_offers (id, week_start, slot_index, template_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, 'offered', ?, ?)`,
        `wo-${weekStart}-${templates[i]}`,
        weekStart,
        i,
        templates[i],
        iso,
        iso,
      );
    }
  };
  const offer = (tmpl: string, week = WEEK) => `wo-${week}-${tmpl}`;
  const card = async (iso: string, tmpl: string): Promise<WeeklyQuestCard | undefined> =>
    (await getWeeklyQuestBlock(t.db, o(iso))).cards.find((c) => c.template.id === tmpl);
  const acceptW = async (tmpl: string, iso = T_ACCEPT, week = WEEK) => {
    const r = await acceptWeeklyQuest(t.db, offer(tmpl, week), o(iso));
    if (!r.ok) throw new Error(r.message);
    return r.instanceId;
  };
  const claimW = (inst: string, iso = T_CLAIM) => claimWeeklyQuest(t.db, inst, o(iso));

  const walk = async (minutes: string, performed: string, now = performed, free = true) => {
    const v = validateSessionForm({
      activityId: 'walking',
      reps: '',
      durationMin: minutes,
      distanceKm: free ? '' : '1',
      freeMetric: 'duration',
      disciplineName: '',
      note: '',
    });
    if (!v.ok) throw new Error('walk');
    const r = await addSession(t.db, { session: v.value, performedAt: at(performed) }, o(now));
    if (!r.ok) throw new Error('addSession');
    return r.session;
  };
  const walkDistanceOnly = async (performed: string) => {
    const v = validateSessionForm({
      activityId: 'walking',
      reps: '',
      durationMin: '',
      distanceKm: '3',
      freeMetric: 'duration',
      disciplineName: '',
      note: '',
    });
    if (!v.ok) throw new Error('walk');
    const r = await addSession(t.db, { session: v.value, performedAt: at(performed) }, o(performed));
    if (!r.ok) throw new Error('addSession');
    return r.session;
  };
  const call = async (performed: string, name = 'Maman', now = performed) => {
    const existing = await t.db.getFirstAsync<{ id: string }>(`SELECT id FROM proches_contacts WHERE name = ?`, name);
    let contactId = existing?.id;
    if (!contactId) {
      const c = await addContact(t.db, { name }, o(now));
      if (!c.ok) throw new Error('contact');
      contactId = c.contact.id;
    }
    const r = await addCall(t.db, { contactId, calledAt: at(performed) }, o(now));
    if (!r.ok) throw new Error('call');
    return r.call;
  };
  const diversToday = async (iso: string, slot: number, req: string) => {
    const act = (await getDiversDashboard(t.db, o(iso))).suggestions[slot]!.activityId;
    const r = await confirmDiversActivity(t.db, act, req, o(iso));
    if (!r.ok) throw new Error('divers');
    return { activityId: act, completion: r.completion };
  };

  test('1. deux offres stables après redémarrage ; rotation d\'une semaine à l\'autre', async () => {
    const a = await getWeeklyQuestBlock(t.db, o(T_ACCEPT));
    const b = await getWeeklyQuestBlock(t.db, o('2026-03-13T15:00:00.000Z'));
    expect(a.cards).toHaveLength(2);
    expect(new Set(a.cards.map((c) => c.template.id)).size).toBe(2);
    expect(b.cards.map((c) => c.template.id)).toEqual(a.cards.map((c) => c.template.id));
    expect(a.weekStart).toBe(WEEK);
    expect(a.weekEnd).toBe('2026-03-15');
    expect(await count('weekly_quest_offers')).toBe(2);
    const next = await getWeeklyQuestBlock(t.db, o(NEXT_WEEK));
    expect(next.weekStart).toBe('2026-03-16');
    expect(next.cards.map((c) => c.template.id).sort()).not.toEqual(a.cards.map((c) => c.template.id).sort());
    expect(await count('weekly_quest_offers', `state = 'expired'`)).toBe(2);
  });

  test('2. un seul remplacement par semaine, jamais après acceptation', async () => {
    await forceWeek(WEEK, ['wq_walks', 'wq_calls']);
    await acceptW('wq_walks');
    expect(await replaceWeeklyQuest(t.db, offer('wq_walks'), o(T_A1))).toMatchObject({ ok: false, code: 'not_replaceable' });
    const r = await replaceWeeklyQuest(t.db, offer('wq_calls'), o(T_A1));
    expect(r.ok).toBe(true);
    const block = await getWeeklyQuestBlock(t.db, o(T_A1));
    expect(block.cards.map((c) => c.template.id).sort()).toEqual(['wq_divers', 'wq_walks']);
    expect(block.replacementsRemaining).toBe(0);
    const again = await replaceWeeklyQuest(t.db, block.cards.find((c) => c.state === 'offered')!.offerId, o(T_A1));
    expect(again).toMatchObject({ ok: false, code: 'limit_reached' });
    const hist = await listWeeklyQuestHistory(t.db);
    expect(hist.some((h) => h.outcome === 'replaced')).toBe(true);
  });

  test('3. limite globale de 3 quêtes actives (partagée avec les quotidiennes)', async () => {
    const iso = '2026-03-11T00:00:00.000Z';
    await t.db.runAsync(`INSERT INTO daily_quest_sets (local_date, replacements_used, created_at, updated_at) VALUES ('2026-03-11', 0, ?, ?)`, iso, iso);
    for (const [i, id] of ['dq_proches_call', 'dq_divers_activity', 'rnw_breathe_calm'].entries()) {
      await t.db.runAsync(
        `INSERT INTO daily_quest_offers (id, local_date, slot_index, template_id, params_json, state, created_at, updated_at) VALUES (?, '2026-03-11', ?, ?, '{}', 'offered', ?, ?)`,
        `d-${id}`,
        i,
        id,
        iso,
        iso,
      );
      expect((await acceptDailyQuest(t.db, `d-${id}`, o(T_ACCEPT))).ok).toBe(true);
    }
    await forceWeek(WEEK, ['wq_walks', 'wq_calls']);
    const r = await acceptWeeklyQuest(t.db, offer('wq_walks'), o(T_ACCEPT));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Carnet plein/);
    expect(await count('renewable_quest_instances', `template_id = 'wq_walks'`)).toBe(0);
  });

  test('4. une seule mission hebdomadaire acceptée à la fois', async () => {
    await forceWeek(WEEK, ['wq_walks', 'wq_calls']);
    const inst = await acceptW('wq_walks');
    const second = await acceptWeeklyQuest(t.db, offer('wq_calls'), o(T_ACCEPT));
    expect(second.ok).toBe(false);
    expect((await getWeeklyQuestBlock(t.db, o(T_ACCEPT))).weeklyAccepted).toBe(true);
    expect((await acceptWeeklyQuest(t.db, offer('wq_walks'), o(T_ACCEPT))).message).toMatch(/déjà acceptée/);
    expect((await abandonWeeklyQuest(t.db, inst, o(T_A1))).ok).toBe(true);
    expect((await acceptWeeklyQuest(t.db, offer('wq_calls'), o(T_A1))).ok).toBe(true);
    const hist = await listWeeklyQuestHistory(t.db);
    expect(hist.find((h) => h.title === 'Les pas de la semaine')?.outcome).toBe('abandoned');
  });

  test('5. trois marches ≥ 10 min : progression 0→3, 20 or, séances libres comprises', async () => {
    await forceWeek(WEEK, ['wq_walks', 'wq_calls']);
    const inst = await acceptW('wq_walks');
    expect((await card(T_ACCEPT, 'wq_walks'))!.done).toBe(0);
    await walk('10', T_A1);
    expect((await card(T_A1, 'wq_walks'))!.done).toBe(1);
    await walk('25', T_A2);
    expect((await card(T_A2, 'wq_walks'))!.done).toBe(2);
    await walk('10', T_A3, T_A3, false);
    const c = (await card(T_A3, 'wq_walks'))!;
    expect(c.done).toBe(3);
    expect(c.state).toBe('ready');
    const r = await claimW(inst);
    expect(r).toMatchObject({ ok: true, gold: 20, balance: 20 });
    expect(await goldSum()).toBe(20);
    expect(await count('quest_evidence_allocations', `instance_id = '${inst}'`)).toBe(3);
    expect(await count('wallet_ledger', `idempotency_key = 'renewable:${inst}:reward'`)).toBe(1);
  });

  test('6. deux marches ne valident pas ; 7. marche trop courte ou sans durée refusée', async () => {
    await forceWeek(WEEK, ['wq_walks', 'wq_calls']);
    const inst = await acceptW('wq_walks');
    await walk('15', T_A1);
    await walk('20', T_A2);
    await walk('9', T_A3);
    await walkDistanceOnly(T_A3);
    const c = (await card(T_A3, 'wq_walks'))!;
    expect(c.done).toBe(2);
    const r = await claimW(inst);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/2\/3/);
    expect(await goldSum()).toBe(0);
    expect(await count('quest_evidence_allocations')).toBe(0);
    expect((await card(T_A3, 'wq_walks'))!.state).toBe('active');
  });

  test('8. deux appels distincts (même proche autorisé) ; 9. contact sans appel / appel annulé ne comptent pas', async () => {
    await forceWeek(WEEK, ['wq_calls', 'wq_divers']);
    const inst = await acceptW('wq_calls');
    await addContact(t.db, { name: 'Papa' }, o(T_A1));
    const c1 = await call(T_A1);
    expect((await card(T_A1, 'wq_calls'))!.done).toBe(1);
    expect((await claimW(inst, T_A1)).ok).toBe(false);
    const c2 = await call(T_A2, 'Maman');
    expect(c2.id).not.toBe(c1.id);
    expect((await card(T_A2, 'wq_calls'))!.done).toBe(2);
    const c3 = await call(T_A2, 'Papa');
    await cancelCall(t.db, c3.id, o(T_A2));
    await cancelCall(t.db, c2.id, o(T_A2));
    expect((await card(T_A2, 'wq_calls'))!.done).toBe(1);
    await call(T_A3, 'Maman');
    expect((await claimW(inst, T_CLAIM))).toMatchObject({ ok: true, gold: 16 });
  });

  test('10. deux activités Divers différentes ; 11. activité répétée ou annulée refusée', async () => {
    await forceWeek(WEEK, ['wq_divers', 'wq_walks']);
    const inst = await acceptW('wq_divers');
    const a = await diversToday(T_A1, 0, 'r1');
    await confirmDiversActivity(t.db, a.activityId, 'r1b', o(T_A1));
    expect((await card(T_A1, 'wq_divers'))!.done).toBe(1);
    expect((await claimW(inst, T_A1)).ok).toBe(false);

    await cancelDiversCompletion(t.db, a.completion.id, o(T_A1));
    expect((await card(T_A1, 'wq_divers'))!.done).toBe(0);

    const b = await diversToday(T_A1, 1, 'r2');
    expect(b.activityId).not.toBe(a.activityId);
    expect((await card(T_A1, 'wq_divers'))!.done).toBe(1);
    const again = await confirmDiversActivity(t.db, a.activityId, 'r3', o('2026-03-11T10:00:00.000Z'));
    expect(again.ok).toBe(true);
    expect((await card('2026-03-11T10:00:00.000Z', 'wq_divers'))!.done).toBe(1);

    await diversToday('2026-03-12T09:00:00.000Z', 0, 'r4');
    const second = (await card(T_A2, 'wq_divers'))!;
    expect(second.done).toBe(2);
    expect((await claimW(inst))).toMatchObject({ ok: true, gold: 14 });
  });

  test('12. action avant acceptation refusée (réalisée ou enregistrée avant)', async () => {
    await forceWeek(WEEK, ['wq_calls', 'wq_walks']);
    await call('2026-03-11T07:00:00.000Z');
    const inst = await acceptW('wq_calls');
    await call('2026-03-11T07:30:00.000Z', 'Papa', T_A1);
    expect((await card(T_A1, 'wq_calls'))!.done).toBe(0);
    await call(T_A1, 'Léa');
    expect((await card(T_A1, 'wq_calls'))!.done).toBe(1);
    expect((await claimW(inst, T_A1)).ok).toBe(false);
    expect(await goldSum()).toBe(0);
  });

  test('13/22. après échéance : aucune action tardive ne compte ; incomplète = échec sans pénalité', async () => {
    await forceWeek(WEEK, ['wq_calls', 'wq_walks']);
    const inst = await acceptW('wq_calls');
    await call(T_A1);
    await call('2026-03-16T09:00:00.000Z', 'Papa');
    const block = await getWeeklyQuestBlock(t.db, o('2026-03-16T10:00:00.000Z'));
    expect(block.cards.some((x) => x.weekStart === WEEK)).toBe(false);
    expect(await count('wallet_ledger')).toBe(0);
    expect((await claimW(inst, '2026-03-16T10:00:00.000Z')).ok).toBe(false);
    expect(await count('quest_evidence_allocations')).toBe(0);
    const failed = await t.db.getFirstAsync<{ status: string }>(`SELECT status FROM renewable_quest_instances WHERE id = ?`, inst);
    expect(failed?.status).toBe('failed');
    const hist = await listWeeklyQuestHistory(t.db);
    expect(hist.find((h) => h.weekStart === WEEK && h.title === 'Garder le lien')?.outcome).toBe('failed');
    expect(await count('renewable_quest_instances', `status IN ('active','ready')`)).toBe(0);
  });

  test('13b. action antidatée dans la semaine mais enregistrée après l\'échéance : refusée', async () => {
    await forceWeek(WEEK, ['wq_calls', 'wq_walks']);
    const inst = await acceptW('wq_calls');
    await call(T_A1);
    await call('2026-03-15T10:00:00.000Z', 'Papa', '2026-03-16T09:00:00.000Z');
    await getWeeklyQuestBlock(t.db, o('2026-03-16T10:00:00.000Z'));
    expect((await listWeeklyQuestHistory(t.db)).find((h) => h.weekStart === WEEK && h.title === 'Garder le lien')?.outcome).toBe('failed');
    expect((await claimW(inst, '2026-03-16T10:00:00.000Z')).ok).toBe(false);
  });

  test('14. preuve payée en quotidienne refusée en hebdomadaire', async () => {
    await forceWeek(WEEK, ['wq_calls', 'wq_walks']);
    const iso = '2026-03-11T00:00:00.000Z';
    await t.db.runAsync(`INSERT INTO daily_quest_sets (local_date, replacements_used, created_at, updated_at) VALUES ('2026-03-11', 0, ?, ?)`, iso, iso);
    await t.db.runAsync(
      `INSERT INTO daily_quest_offers (id, local_date, slot_index, template_id, params_json, state, created_at, updated_at) VALUES ('d1','2026-03-11',0,'dq_proches_call','{}','offered',?,?)`,
      iso,
      iso,
    );
    const dInst = (await acceptDailyQuest(t.db, 'd1', o(T_ACCEPT)))!;
    if (!dInst.ok) throw new Error('daily');
    const wInst = await acceptW('wq_calls', '2026-03-11T08:05:00.000Z');
    const c1 = await call(T_A1);
    expect((await claimRenewableQuest(t.db, dInst.instanceId, at(T_A1))).ok).toBe(true);
    expect(await isEvidencePaid(t.db, `proches_call:${c1.id}`)).toBe(true);
    expect((await card(T_A1, 'wq_calls'))!.done).toBe(0);
    await call(T_A2, 'Papa');
    expect((await card(T_A2, 'wq_calls'))!.done).toBe(1);
    expect((await claimW(wInst, T_A2)).ok).toBe(false);
  });

  test('15. preuve payée en hebdomadaire refusée en quotidienne et non annulable', async () => {
    await forceWeek(WEEK, ['wq_calls', 'wq_walks']);
    const iso = '2026-03-11T00:00:00.000Z';
    await t.db.runAsync(`INSERT INTO daily_quest_sets (local_date, replacements_used, created_at, updated_at) VALUES ('2026-03-11', 0, ?, ?)`, iso, iso);
    await t.db.runAsync(
      `INSERT INTO daily_quest_offers (id, local_date, slot_index, template_id, params_json, state, created_at, updated_at) VALUES ('d1','2026-03-11',0,'dq_proches_call','{}','offered',?,?)`,
      iso,
      iso,
    );
    const d = await acceptDailyQuest(t.db, 'd1', o(T_ACCEPT));
    if (!d.ok) throw new Error('daily');
    const wInst = await acceptW('wq_calls', '2026-03-11T08:05:00.000Z');
    const c1 = await call(T_A1);
    const c2 = await call(T_A2, 'Papa');
    expect((await claimW(wInst, T_A2)).ok).toBe(true);
    const dailyTry = await claimRenewableQuest(t.db, d.instanceId, at(T_A3));
    expect(dailyTry.ok).toBe(false);
    expect(await goldSum()).toBe(16);
    expect(await isEvidencePaid(t.db, `proches_call:${c1.id}`)).toBe(true);
    expect(await cancelCall(t.db, c1.id, o(T_A3))).toMatchObject({ ok: false, code: 'rewarded' });
    expect(await cancelCall(t.db, c2.id, o(T_A3))).toMatchObject({ ok: false, code: 'rewarded' });
  });

  test('15b. isEvidencePaid / isEvidenceGroupPaid reconnaissent les allocations hebdomadaires', async () => {
    await t.db.runAsync(
      `INSERT INTO quest_evidence_allocations (id, evidence_key, evidence_group, instance_id, source, claimed_at) VALUES ('a','k1','g1','i1','sport','2026-03-11T00:00:00.000Z')`,
    );
    expect(await isEvidencePaid(t.db, 'k1')).toBe(true);
    expect(await isEvidenceGroupPaid(t.db, 'g1')).toBe(true);
    expect(await isEvidencePaid(t.db, 'k2')).toBe(false);
    await expect(
      t.db.runAsync(`INSERT INTO quest_evidence_allocations (id, evidence_key, evidence_group, instance_id, source, claimed_at) VALUES ('b','k1','g9','i2','sport','x')`),
    ).rejects.toBeTruthy();
    await expect(
      t.db.runAsync(`INSERT INTO quest_evidence_allocations (id, evidence_key, evidence_group, instance_id, source, claimed_at) VALUES ('c','k9','g1','i2','sport','x')`),
    ).rejects.toBeTruthy();
  });

  test('16/17. plusieurs preuves par instance ; double réclamation (séquentielle et concurrente) = un paiement', async () => {
    await forceWeek(WEEK, ['wq_walks', 'wq_calls']);
    const inst = await acceptW('wq_walks');
    await walk('12', T_A1);
    await walk('12', T_A2);
    await walk('12', T_A3);
    const [r1, r2, r3] = await Promise.all([claimW(inst), claimW(inst), claimW(inst)]);
    expect([r1, r2, r3].filter((r) => r.ok)).toHaveLength(1);
    expect((await claimW(inst)).message).toMatch(/déjà réclamée/);
    expect(await goldSum()).toBe(20);
    expect(await count('quest_evidence_allocations', `instance_id = '${inst}'`)).toBe(3);
    expect(await count('quest_evidence_allocations')).toBe(3);
    expect(await count('wallet_ledger')).toBe(1);
  });

  test('18. plafond 50 or/jour partagé : partiel puis 0 or, rien reporté', async () => {
    await forceWeek(WEEK, ['wq_walks', 'wq_calls']);
    await t.db.runAsync(
      `INSERT INTO wallet_ledger (id, resource, amount, reason, idempotency_key, created_at) VALUES ('w1','gold',40,'vape','vape:test:1',?)`,
      T_A1,
    );
    const inst = await acceptW('wq_walks');
    await walk('11', T_A1);
    await walk('11', T_A2);
    await walk('11', T_A3);
    const r = await claimW(inst, T_CLAIM);
    // le plafond se calcule par jour UTC : la vape du 11 n'entre pas dans le 14
    expect(r).toMatchObject({ ok: true, gold: 20 });
    await t.db.runAsync(
      `INSERT INTO wallet_ledger (id, resource, amount, reason, idempotency_key, created_at) VALUES ('w2','gold',40,'vape','vape:test:2',?)`,
      T_CLAIM,
    );
    const inst2 = await acceptW('wq_calls', T_CLAIM);
    await call('2026-03-14T09:30:00.000Z');
    await call('2026-03-14T09:40:00.000Z', 'Papa');
    const partial = await claimW(inst2, '2026-03-14T10:00:00.000Z');
    // 40 (vape du jour) + 20 (marches, même jour UTC) = 60 déjà > 50 → 0 or, mission terminée
    expect(partial).toMatchObject({ ok: true, gold: 0 });
    expect(await count('wallet_ledger', `idempotency_key = 'renewable:${inst2}:reward'`)).toBe(0);
    expect(await count('quest_evidence_allocations', `instance_id = '${inst2}'`)).toBe(2);
    const h = await listWeeklyQuestHistory(t.db);
    expect(h.find((x) => x.outcome === 'claimed' && x.title === 'Garder le lien')?.creditedGold).toBe(0);
    expect((await getWeeklyQuestBlock(t.db, o('2026-03-14T10:00:00.000Z'))).dailyGoldRemaining).toBe(0);
  });

  test('18b. paiement partiel : or restant crédité, clé de ledger comptée par le plafond partagé', async () => {
    await forceWeek(WEEK, ['wq_walks', 'wq_calls']);
    await t.db.runAsync(
      `INSERT INTO wallet_ledger (id, resource, amount, reason, idempotency_key, created_at) VALUES ('w1','gold',40,'vape','vape:test:1',?)`,
      T_CLAIM,
    );
    const inst = await acceptW('wq_walks');
    await walk('11', T_A1);
    await walk('11', T_A2);
    await walk('11', T_A3);
    const r = await claimW(inst, T_CLAIM);
    expect(r).toMatchObject({ ok: true, gold: 10 });
    expect((await getWeeklyQuestBlock(t.db, o(T_CLAIM))).dailyGoldRemaining).toBe(0);
    expect(await goldSum()).toBe(50);
  });

  test('19. correction avant réclamation recalculée ; après paiement refus incompatible, description autorisée', async () => {
    await forceWeek(WEEK, ['wq_walks', 'wq_calls']);
    const inst = await acceptW('wq_walks');
    const w1 = await walk('12', T_A1);
    await walk('12', T_A2);
    const w3 = await walk('12', T_A3);
    expect((await card(T_A3, 'wq_walks'))!.done).toBe(3);
    expect(await cancelSession(t.db, w3.id, o(T_A3))).toMatchObject({ ok: true });
    expect((await card(T_A3, 'wq_walks'))!.done).toBe(2);
    expect((await claimW(inst, T_A3)).ok).toBe(false);
    await walk('14', T_A3);
    expect((await claimW(inst, T_CLAIM)).ok).toBe(true);

    expect(await cancelSession(t.db, w1.id, o(T_CLAIM))).toMatchObject({ ok: false, code: 'rewarded' });
    const shorter = await editSession(
      t.db,
      w1.id,
      { session: { ...w1Values(w1), durationSec: 120 }, performedAt: at(w1.performedAt) },
      o(T_CLAIM),
    );
    expect(shorter).toMatchObject({ ok: false, code: 'rewarded' });
    const note = await editSession(
      t.db,
      w1.id,
      { session: { ...w1Values(w1), note: 'belle marche' }, performedAt: at(w1.performedAt) },
      o(T_CLAIM),
    );
    expect(note.ok).toBe(true);
    expect(await goldSum()).toBe(20);
  });

  test('20. frontières lundi/dimanche (hiver et changement d\'heure Europe/Paris)', async () => {
    // Hiver : dimanche 2026-03-08 03:59 CET → semaine du 02 ; 04:30 CET lundi 09 → nouvelle semaine.
    expect((await getWeeklyQuestBlock(t.db, o('2026-03-09T02:59:00.000Z'))).weekStart).toBe('2026-03-02');
    expect((await getWeeklyQuestBlock(t.db, o('2026-03-09T03:30:00.000Z'))).weekStart).toBe('2026-03-09');
    // Changement d'heure (dimanche 2026-03-29 → CEST) : 03:30 CEST le lundi 30 reste dimanche logique.
    expect((await getWeeklyQuestBlock(t.db, o('2026-03-30T01:30:00.000Z'))).weekStart).toBe('2026-03-23');
    expect((await getWeeklyQuestBlock(t.db, o('2026-03-30T02:30:00.000Z'))).weekStart).toBe('2026-03-30');
    // Une action enregistrée juste avant le lundi logique compte, juste après non.
    await forceWeek('2026-03-23', ['wq_calls', 'wq_walks']);
    const inst = await acceptW('wq_calls', '2026-03-24T08:00:00.000Z', '2026-03-23');
    await call('2026-03-28T09:00:00.000Z');
    await call('2026-03-30T01:20:00.000Z', 'Papa');
    expect((await card('2026-03-30T01:25:00.000Z', 'wq_calls'))!.done).toBe(2);
    expect((await claimWeeklyQuest(t.db, inst, o('2026-03-30T01:30:00.000Z'))).ok).toBe(true);
  });

  test('20b. une action après le lundi logique ne complète pas la semaine précédente (changement d\'heure)', async () => {
    await forceWeek('2026-03-23', ['wq_calls', 'wq_walks']);
    const inst = await acceptW('wq_calls', '2026-03-24T08:00:00.000Z', '2026-03-23');
    await call('2026-03-28T09:00:00.000Z');
    await call('2026-03-30T02:10:00.000Z', 'Papa');
    const block = await getWeeklyQuestBlock(t.db, o('2026-03-30T02:30:00.000Z'));
    expect(block.cards.some((c) => c.weekStart === '2026-03-23')).toBe(false);
    expect((await listWeeklyQuestHistory(t.db)).find((h) => h.weekStart === '2026-03-23' && h.title === 'Garder le lien')?.outcome).toBe('failed');
    expect((await claimWeeklyQuest(t.db, inst, o('2026-03-30T02:30:00.000Z'))).ok).toBe(false);
  });

  test('21. mission complète avant l\'échéance : réclamable après', async () => {
    await forceWeek(WEEK, ['wq_calls', 'wq_walks']);
    const inst = await acceptW('wq_calls');
    await call(T_A1);
    await call(T_A2, 'Papa');
    const next = await getWeeklyQuestBlock(t.db, o(NEXT_WEEK));
    const c = next.cards.find((x) => x.weekStart === WEEK)!;
    expect(c.state).toBe('ready');
    expect(c.carriedOver).toBe(true);
    const r = await claimW(inst, NEXT_WEEK);
    expect(r).toMatchObject({ ok: true, gold: 16 });
    expect((await listWeeklyQuestHistory(t.db)).find((h) => h.weekStart === WEEK && h.title === 'Garder le lien')?.outcome).toBe('claimed');
  });

  test('23. sauvegarde / restauration : offres, mission, allocations', async () => {
    await forceWeek(WEEK, ['wq_calls', 'wq_walks']);
    const inst = await acceptW('wq_calls');
    const c1 = await call(T_A1);
    await call(T_A2, 'Papa');
    expect((await claimW(inst, T_A2)).ok).toBe(true);
    const hist = await listWeeklyQuestHistory(t.db);
    const exported = await exportBackupPayload(t.db, '0.2.0');
    for (const tbl of ['weekly_quest_sets', 'weekly_quest_offers', 'quest_evidence_allocations']) {
      expect((exported.manifest.tables as string[]).includes(tbl)).toBe(true);
    }
    const target = await openNodeSqliteDb();
    try {
      await importBackupPayload(target.db, exported.manifest, exported.data);
      expect(await listWeeklyQuestHistory(target.db)).toEqual(hist);
      expect(Number((await target.db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM quest_evidence_allocations`))?.n)).toBe(2);
      expect(await cancelCall(target.db, c1.id, o(T_CLAIM))).toMatchObject({ ok: false, code: 'rewarded' });
      expect((await claimWeeklyQuest(target.db, inst, o(T_CLAIM))).message).toMatch(/déjà réclamée/);
    } finally {
      target.close();
    }
    // Ancienne sauvegarde (sans tables hebdomadaires) : restaurable, tables vidées
    const old = { manifest: exported.manifest, data: { ...exported.data } };
    delete old.data.weekly_quest_sets;
    delete old.data.weekly_quest_offers;
    delete old.data.quest_evidence_allocations;
    await importBackupPayload(t.db, old.manifest, old.data);
    expect(await count('weekly_quest_offers')).toBe(0);
    expect((await getWeeklyQuestBlock(t.db, o(T_CLAIM))).cards).toHaveLength(2);
  });

  test('24. carnet générique : mission hebdomadaire masquée, ni réclamable ni abandonnable hors du bloc', async () => {
    await forceWeek(WEEK, ['wq_calls', 'wq_walks']);
    const inst = await acceptW('wq_calls');
    await call(T_A1);
    await call(T_A2, 'Papa');
    const board = await getRenewableQuestBoard(t.db);
    expect(board.entries.some((e) => e.instanceId === inst)).toBe(false);
    expect(board.acceptedCount).toBe(1);
    expect((await claimRenewableQuest(t.db, inst, at(T_A2))).ok).toBe(false);
    expect((await abandonRenewableQuest(t.db, inst, at(T_A2))).ok).toBe(false);
    expect(await goldSum()).toBe(0);
    expect((await claimW(inst, T_A2)).ok).toBe(true);
  });

  test('navigation « Aller à l\'activité »', async () => {
    await forceWeek(WEEK, ['wq_calls', 'wq_walks']);
    const b = await getWeeklyQuestBlock(t.db, o(T_ACCEPT));
    const route = (id: string) => resolveWeeklyTarget(b.cards.find((c) => c.template.id === id)!);
    expect(route('wq_calls')).toBe('proches');
    expect(route('wq_walks')).toBe('sport');
  });
});

function w1Values(s: { activityId: string; reps: number | null; durationSec: number | null; distanceM: number | null; note: string | null; disciplineName?: string | null }) {
  return {
    activityId: s.activityId as 'walking',
    reps: s.reps,
    durationSec: s.durationSec,
    distanceM: s.distanceM,
    disciplineName: s.disciplineName ?? null,
    note: s.note,
  };
}
