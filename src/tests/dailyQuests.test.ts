jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: '/tmp/',
  documentDirectory: '/tmp/',
  EncodingType: { Base64: 'base64' },
  writeAsStringAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
}));

import { migrate } from '../data/db/client';
import {
  acceptDailyQuest,
  getDailyQuestBlock,
  listDailyQuestHistory,
  replaceDailyQuest,
  type DailyQuestCard,
} from '../domain/services/dailyQuestService';
import {
  abandonRenewableQuest,
  claimRenewableQuest,
  getRenewableQuestBoard,
  startRenewableTimer,
  succeedRenewableTimer,
} from '../domain/services/renewableQuestService';
import { resolveDailyOpenRoute } from '../domain/services/dailyQuestNavigation';
import {
  cancelDiversCompletion,
  confirmDiversActivity,
  getDiversDashboard,
  passDiversSuggestion,
  replaceDiversSuggestion,
} from '../domain/services/diversTrackerService';
import { addCall, addContact, cancelCall, editCall } from '../domain/services/prochesTrackerService';
import {
  addSession,
  cancelSession,
  editSession,
  listSportEvidence,
  setSportGoal,
} from '../domain/services/sportTrackerService';
import { exportBackupPayload, importBackupPayload } from '../domain/services/backupService';
import { validateSessionForm } from '../domain/rules/sport';
import { nodeSqliteAvailable, openNodeSqliteDb, type TestDb } from './helpers/nodeSqliteDb';

const suite = nodeSqliteAvailable() ? describe : describe.skip;
const TZ = 'Europe/Paris';
const at = (iso: string) => new Date(iso);
const o = (iso: string) => ({ timeZone: TZ, dayStartHour: 4, now: at(iso) });
const D1 = '2026-03-11';
const T_ACCEPT = '2026-03-11T08:00:00.000Z';
const T_ACT = '2026-03-11T08:30:00.000Z';
const T_CLAIM = '2026-03-11T09:00:00.000Z';

suite('V1-04B-1 — Trois missions du jour', () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await openNodeSqliteDb();
  });
  afterEach(() => t.close());

  const goldSum = async () =>
    Number(
      (await t.db.getFirstAsync<{ s: number }>(`SELECT COALESCE(SUM(amount),0) AS s FROM wallet_ledger WHERE resource='gold'`))?.s ?? 0,
    );
  const ledgerRows = async () =>
    Number((await t.db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM wallet_ledger WHERE resource='gold'`))?.n ?? 0);
  const count = async (tbl: string) => Number((await t.db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${tbl}`))?.n ?? 0);

  /** Fige un jeu d'offres précis (contourne la sélection) : le moteur lit ensuite ce jeu tel quel. */
  const forceSet = async (
    date: string,
    templates: Array<{ id: string; params?: Record<string, unknown> }>,
  ) => {
    const iso = `${date}T00:00:00.000Z`;
    await t.db.runAsync(
      `INSERT OR IGNORE INTO daily_quest_sets (local_date, replacements_used, created_at, updated_at) VALUES (?, 0, ?, ?)`,
      date,
      iso,
      iso,
    );
    for (let i = 0; i < templates.length; i++) {
      await t.db.runAsync(
        `INSERT INTO daily_quest_offers (id, local_date, slot_index, template_id, params_json, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'offered', ?, ?)`,
        `off-${date}-${templates[i]!.id}`,
        date,
        i,
        templates[i]!.id,
        JSON.stringify(templates[i]!.params ?? {}),
        iso,
        iso,
      );
    }
  };
  const offerId = (date: string, tmpl: string) => `off-${date}-${tmpl}`;
  const card = async (iso: string, tmpl: string): Promise<DailyQuestCard | undefined> =>
    (await getDailyQuestBlock(t.db, o(iso))).cards.find((c) => c.template.id === tmpl);

  const pushups = (reps: string) => {
    const v = validateSessionForm({
      activityId: 'pushups',
      reps,
      durationMin: '',
      distanceKm: '',
      freeMetric: 'reps',
      disciplineName: '',
      note: '',
    });
    if (!v.ok) throw new Error('pushups');
    return v.value;
  };
  const setGoal20 = async (iso = '2026-03-10T10:00:00.000Z') => {
    const r = await setSportGoal(t.db, { activityId: 'pushups', metric: 'reps', target: 20 }, o(iso));
    if (!r.ok || !r.goal) throw new Error('goal');
    return r.goal.id;
  };
  const sportParams = (goalId: string) => ({ activityId: 'pushups', goalId, goalMetric: 'reps', goalTarget: 20 });
  const acceptSport = async (goalId: string, date = D1, iso = T_ACCEPT) => {
    await forceSet(date, [{ id: 'dq_sport_pushups', params: sportParams(goalId) }, { id: 'dq_proches_call' }, { id: 'dq_divers_activity' }]);
    const r = await acceptDailyQuest(t.db, offerId(date, 'dq_sport_pushups'), o(iso));
    if (!r.ok) throw new Error(r.message);
    return r.instanceId;
  };
  const acceptOne = async (tmpl: string, date = D1, iso = T_ACCEPT) => {
    await forceSet(date, [{ id: tmpl }, { id: 'dq_proches_call' }].filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i));
    const r = await acceptDailyQuest(t.db, offerId(date, tmpl), o(iso));
    if (!r.ok) throw new Error(r.message);
    return r.instanceId;
  };
  const claim = (instanceId: string, iso = T_CLAIM) => claimRenewableQuest(t.db, instanceId, at(iso));
  const logSport = async (reps: string, outcome: 'achieved' | 'failed' | 'free', goalId: string, performed = T_ACT, now = T_ACT) =>
    addSession(
      t.db,
      { session: pushups(reps), performedAt: at(performed), outcome, goalId: outcome === 'free' ? undefined : goalId },
      o(now),
    );
  const makeCall = async (calledIso = T_ACT, nowIso = T_ACT, name = 'Maman') => {
    const c = await addContact(t.db, { name }, o(nowIso));
    if (!c.ok) throw new Error('contact');
    const r = await addCall(t.db, { contactId: c.contact.id, calledAt: at(calledIso) }, o(nowIso));
    if (!r.ok) throw new Error('call');
    return r.call;
  };

  test('1. trois offres stables, variées, persistantes', async () => {
    const a = await getDailyQuestBlock(t.db, o(T_ACCEPT));
    const b = await getDailyQuestBlock(t.db, o('2026-03-11T15:00:00.000Z'));
    expect(a.cards).toHaveLength(3);
    expect(new Set(a.cards.map((c) => c.template.id)).size).toBe(3);
    expect(a.cards.every((c) => c.state === 'offered')).toBe(true);
    expect(b.cards.map((c) => c.template.id)).toEqual(a.cards.map((c) => c.template.id));
    expect(await count('daily_quest_offers')).toBe(3);
    expect(await count('daily_quest_sets')).toBe(1);
  });

  test('1b. sans objectif Sport : aucune mission bloquée faute de prérequis', async () => {
    const a = await getDailyQuestBlock(t.db, o(T_ACCEPT));
    expect(a.cards.some((c) => c.template.proof === 'sport_session')).toBe(false);
    expect(await replaceDailyQuest(t.db, a.cards[0]!.offerId, o(T_ACCEPT))).toMatchObject({ ok: false, code: 'no_alternative' });
    expect((await getDailyQuestBlock(t.db, o(T_ACCEPT))).replacementsRemaining).toBe(1);
    await setGoal20();
    const day2 = await getDailyQuestBlock(t.db, o('2026-03-12T08:00:00.000Z'));
    expect(day2.cards).toHaveLength(3);
  });

  test('2. renouvellement sur la date logique Europe/Paris (début de journée 04h)', async () => {
    const before = await getDailyQuestBlock(t.db, o('2026-03-11T02:30:00.000Z')); // 03h30 Paris → jour logique 10
    const same = await getDailyQuestBlock(t.db, o('2026-03-10T23:30:00.000Z')); // 00h30 Paris le 11 → logique 10
    const after = await getDailyQuestBlock(t.db, o('2026-03-11T03:30:00.000Z')); // 04h30 Paris → logique 11
    expect(before.today).toBe('2026-03-10');
    expect(same.today).toBe('2026-03-10');
    expect(after.today).toBe('2026-03-11');
    expect(same.cards.map((c) => c.offerId)).toEqual(before.cards.map((c) => c.offerId));
    expect(after.cards.map((c) => c.offerId)).not.toEqual(before.cards.map((c) => c.offerId));
    expect(await count('daily_quest_sets')).toBe(2);
  });

  test('3. une seule offre remplaçable par jour ; une offre acceptée ne se remplace pas', async () => {
    await setGoal20();
    const block = await getDailyQuestBlock(t.db, o(T_ACCEPT));
    const [c0, c1, c2] = block.cards;
    const r1 = await replaceDailyQuest(t.db, c0!.offerId, o(T_ACCEPT));
    expect(r1.ok).toBe(true);
    const r2 = await replaceDailyQuest(t.db, c1!.offerId, o(T_ACCEPT));
    expect(r2).toMatchObject({ ok: false, code: 'limit_reached' });
    const after = await getDailyQuestBlock(t.db, o(T_ACCEPT));
    expect(after.cards).toHaveLength(3);
    expect(after.cards.map((c) => c.offerId)).not.toContain(c0!.offerId);
    expect(after.replacementsRemaining).toBe(0);
    expect(after.cards.every((c) => !c.canReplace)).toBe(true);
    const hist = await listDailyQuestHistory(t.db);
    expect(hist.find((h) => h.offerId === c0!.offerId)?.outcome).toBe('replaced');
    expect(c2).toBeTruthy();

    const t2 = await openNodeSqliteDb();
    try {
      await setSportGoal(t2.db, { activityId: 'pushups', metric: 'reps', target: 20 }, o('2026-03-10T10:00:00.000Z'));
      const b2 = await getDailyQuestBlock(t2.db, o(T_ACCEPT));
      const accepted = await acceptDailyQuest(t2.db, b2.cards[0]!.offerId, o(T_ACCEPT));
      expect(accepted.ok).toBe(true);
      expect(await replaceDailyQuest(t2.db, b2.cards[0]!.offerId, o(T_ACCEPT))).toMatchObject({ ok: false, code: 'not_replaceable' });
    } finally {
      t2.close();
    }
  });

  test('4. « Passer » Divers ne contourne plus le remplacement ; persistance après redémarrage', async () => {
    const d0 = await getDiversDashboard(t.db, o(T_ACCEPT));
    const first = d0.suggestions[0]!.activityId;
    const p1 = await passDiversSuggestion(t.db, 0, o(T_ACCEPT));
    const p2 = await passDiversSuggestion(t.db, 0, o(T_ACCEPT));
    expect(p1.ok && p2.ok).toBe(true);
    const reloaded = await getDiversDashboard(t.db, o('2026-03-11T10:00:00.000Z'));
    expect(reloaded.suggestions[0]).toMatchObject({ activityId: first, passed: true });
    expect(reloaded.replacementsRemaining).toBe(1);
    const c = await confirmDiversActivity(t.db, first, 'req-pass', o(T_ACT));
    expect(c).toMatchObject({ ok: false, code: 'passed' });
    expect(await count('divers_completions')).toBe(0);
    const events = await t.db.getAllAsync<{ kind: string }>(`SELECT kind FROM divers_events WHERE kind = 'suggestion_passed'`);
    expect(events).toHaveLength(1);
    const rep = await replaceDiversSuggestion(t.db, 0, o(T_ACT));
    expect(rep.ok).toBe(true);
    if (rep.ok) {
      expect(rep.dashboard.suggestions[0]!.activityId).not.toBe(first);
      expect(rep.dashboard.suggestions[0]!.passed).toBe(false);
      expect(rep.dashboard.replacementsRemaining).toBe(0);
    }
    expect(await replaceDiversSuggestion(t.db, 1, o(T_ACT))).toMatchObject({ ok: false, code: 'limit_reached' });
  });

  test('5. confirmations Divers répétées : une seule preuve récompensable', async () => {
    const act = (await getDiversDashboard(t.db, o(T_ACCEPT))).suggestions[0]!.activityId;
    const inst = await acceptOne('dq_divers_activity');
    const c1 = await confirmDiversActivity(t.db, act, 'r-1', o(T_ACT));
    const c2 = await confirmDiversActivity(t.db, act, 'r-2', o(T_ACT));
    const c3 = await confirmDiversActivity(t.db, act, 'r-3', o(T_ACT));
    if (!c1.ok || !c2.ok || !c3.ok) throw new Error('confirm');
    expect(c2.completion.id).toBe(c1.completion.id);
    expect(c3.duplicate).toBe(true);
    expect(await count('divers_completions')).toBe(1);

    // boucle annuler → reconfirmer : la 2e confirmation n'est jamais récompensable
    const inst2 = await t.db.getFirstAsync<{ id: string }>(`SELECT id FROM renewable_quest_instances WHERE id = ?`, inst);
    expect(inst2).toBeTruthy();
    await cancelDiversCompletion(t.db, c1.completion.id, o(T_ACT));
    const again = await confirmDiversActivity(t.db, act, 'r-4', o('2026-03-11T08:40:00.000Z'));
    if (!again.ok) throw new Error('again');
    expect(again.completion.id).not.toBe(c1.completion.id);
    const bad = await claim(inst);
    expect(bad.ok).toBe(false);
    expect(await goldSum()).toBe(0);
  });

  test('6. action AVANT acceptation refusée (pas de réussite rétroactive)', async () => {
    const goalId = await setGoal20();
    await logSport('20', 'achieved', goalId, '2026-03-11T07:00:00.000Z', '2026-03-11T07:00:00.000Z');
    const inst = await acceptSport(goalId, D1, T_ACCEPT);
    const r = await claim(inst);
    expect(r.ok).toBe(false);
    expect(await goldSum()).toBe(0);
    // séance saisie après acceptation mais datée avant : refusée aussi
    await logSport('20', 'achieved', goalId, '2026-03-11T07:30:00.000Z', T_ACT);
    expect((await claim(inst)).ok).toBe(false);
  });

  test('7. Sport 16/20 échoué : conservé en stats, mission non validée', async () => {
    const goalId = await setGoal20();
    const inst = await acceptSport(goalId);
    const s = await logSport('16', 'failed', goalId);
    expect(s.ok).toBe(true);
    const c = await card(T_CLAIM, 'dq_sport_pushups');
    expect(c?.state).toBe('active');
    expect(c?.progress?.label).toMatch(/objectif non atteint/);
    expect((await claim(inst)).ok).toBe(false);
    const ev = await listSportEvidence(t.db);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ reps: 16, countsAsSuccess: false });
    expect(await goldSum()).toBe(0);
  });

  test('8. Sport 20/20 récompensable, une seule fois', async () => {
    const goalId = await setGoal20();
    const inst = await acceptSport(goalId);
    await logSport('20', 'achieved', goalId);
    expect((await card(T_CLAIM, 'dq_sport_pushups'))?.state).toBe('ready');
    const r = await claim(inst);
    expect(r).toMatchObject({ ok: true, gold: 10, balance: 10 });
    expect(await goldSum()).toBe(10);
    const row = await t.db.getFirstAsync<{ evidence_key: string; gold_credited: number }>(`SELECT * FROM quest_evidence_claims`);
    expect(row?.evidence_key).toMatch(/^sport_session:/);
    expect(row?.gold_credited).toBe(10);
    const hist = await listDailyQuestHistory(t.db);
    expect(hist[0]).toMatchObject({ outcome: 'claimed', creditedGold: 10 });
    expect(hist[0]!.evidenceKey).toMatch(/^sport_session:/);
  });

  test('9. un proche dans le répertoire sans appel ne rapporte rien', async () => {
    const inst = await acceptOne('dq_proches_call');
    await addContact(t.db, { name: 'Papa' }, o(T_ACT));
    expect((await claim(inst)).ok).toBe(false);
    expect((await card(T_CLAIM, 'dq_proches_call'))?.state).toBe('active');
    expect(await goldSum()).toBe(0);
  });

  test('10. appel réel après acceptation utilisable ; appel annulé non', async () => {
    const inst = await acceptOne('dq_proches_call');
    const call = await makeCall();
    await cancelCall(t.db, call.id, o(T_ACT));
    expect((await claim(inst)).ok).toBe(false);
    await makeCall('2026-03-11T08:40:00.000Z', '2026-03-11T08:40:00.000Z', 'Sœur');
    expect((await card(T_CLAIM, 'dq_proches_call'))?.state).toBe('ready');
    expect(await claim(inst)).toMatchObject({ ok: true, gold: 8 });
  });

  test('11. Divers passé / remplacé / annulé non récompensable', async () => {
    const inst = await acceptOne('dq_divers_activity');
    const d = await getDiversDashboard(t.db, o(T_ACCEPT));
    const [s0, s1] = d.suggestions;
    await passDiversSuggestion(t.db, 0, o(T_ACT));
    expect((await confirmDiversActivity(t.db, s0!.activityId, 'x', o(T_ACT))).ok).toBe(false);
    await replaceDiversSuggestion(t.db, 0, o(T_ACT));
    expect((await claim(inst)).ok).toBe(false);
    const ok = await confirmDiversActivity(t.db, s1!.activityId, 'y', o(T_ACT));
    if (!ok.ok) throw new Error('confirm');
    await cancelDiversCompletion(t.db, ok.completion.id, o(T_ACT));
    expect((await claim(inst)).ok).toBe(false);
    expect(await goldSum()).toBe(0);
  });

  test('12. une même evidenceKey ne finance jamais deux récompenses', async () => {
    const inst1 = await acceptOne('dq_proches_call', D1, T_ACCEPT);
    await makeCall();
    expect((await claim(inst1)).ok).toBe(true);
    const day2 = '2026-03-12';
    const inst2 = await acceptOne('dq_proches_call', day2, '2026-03-12T08:00:00.000Z');
    expect((await claim(inst2, '2026-03-12T09:00:00.000Z')).ok).toBe(false);
    expect(await count('quest_evidence_claims')).toBe(1);
    await expect(
      t.db.runAsync(
        `INSERT INTO quest_evidence_claims (id, evidence_key, evidence_group, instance_id, source, gold_credited, claimed_at)
         SELECT 'dup', evidence_key, 'g-other', 'i-other', 'x', 0, claimed_at FROM quest_evidence_claims`,
      ),
    ).rejects.toThrow();
  });

  test('13. correction / annulation après paiement : bloquées si elles invalident la preuve', async () => {
    const goalId = await setGoal20();
    const inst = await acceptSport(goalId);
    const s = await logSport('20', 'achieved', goalId);
    if (!s.ok) throw new Error('sport');
    expect((await claim(inst)).ok).toBe(true);
    const gold = await goldSum();
    expect(await cancelSession(t.db, s.session.id, o(T_CLAIM))).toMatchObject({ ok: false, code: 'rewarded' });
    const edit = await editSession(
      t.db,
      s.session.id,
      { session: pushups('21'), performedAt: at(T_ACT), outcome: 'achieved' },
      o(T_CLAIM),
    );
    expect(edit).toMatchObject({ ok: false, code: 'rewarded' });
    const noteOnly = await editSession(
      t.db,
      s.session.id,
      { session: { ...pushups('20'), note: 'bonne séance' }, performedAt: at(T_ACT), outcome: 'achieved' },
      o(T_CLAIM),
    );
    expect(noteOnly.ok).toBe(true);
    expect(await goldSum()).toBe(gold);

    const inst2 = await acceptOne('dq_proches_call', '2026-03-12', '2026-03-12T08:00:00.000Z');
    const call = await makeCall('2026-03-12T08:30:00.000Z', '2026-03-12T08:30:00.000Z');
    expect((await claim(inst2, '2026-03-12T09:00:00.000Z')).ok).toBe(true);
    expect(await cancelCall(t.db, call.id, o('2026-03-12T10:00:00.000Z'))).toMatchObject({ ok: false, code: 'rewarded' });
    expect(await editCall(t.db, call.id, { calledAt: at('2026-03-12T08:35:00.000Z') }, o('2026-03-12T10:00:00.000Z'))).toMatchObject({
      ok: false,
      code: 'rewarded',
    });
    expect((await editCall(t.db, call.id, { calledAt: at('2026-03-12T08:30:00.000Z'), note: 'merci' }, o('2026-03-12T10:00:00.000Z'))).ok).toBe(true);

    const act = (await getDiversDashboard(t.db, o('2026-03-13T08:00:00.000Z'))).suggestions[0]!.activityId;
    const inst3 = await acceptOne('dq_divers_activity', '2026-03-13', '2026-03-13T08:00:00.000Z');
    const c = await confirmDiversActivity(t.db, act, 'z', o('2026-03-13T08:10:00.000Z'));
    if (!c.ok) throw new Error('confirm');
    expect((await claim(inst3, '2026-03-13T09:00:00.000Z')).ok).toBe(true);
    expect(await cancelDiversCompletion(t.db, c.completion.id, o('2026-03-13T10:00:00.000Z'))).toMatchObject({ ok: false, code: 'rewarded' });
  });

  test('13b. correction AVANT paiement : la mission redevient non prête, aucune incohérence', async () => {
    const goalId = await setGoal20();
    const inst = await acceptSport(goalId);
    const s = await logSport('20', 'achieved', goalId);
    if (!s.ok) throw new Error('sport');
    expect((await card(T_CLAIM, 'dq_sport_pushups'))?.state).toBe('ready');
    await cancelSession(t.db, s.session.id, o(T_CLAIM));
    expect((await card(T_CLAIM, 'dq_sport_pushups'))?.state).toBe('active');
    expect((await claim(inst)).ok).toBe(false);
    expect(await goldSum()).toBe(0);
  });

  test('14. double réclamation = un seul crédit', async () => {
    const inst = await acceptOne('dq_proches_call');
    await makeCall();
    const [a, b] = await Promise.all([claim(inst), claim(inst)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(await claim(inst)).toMatchObject({ ok: false });
    expect(await goldSum()).toBe(8);
    expect(await ledgerRows()).toBe(1);
  });

  test('15. plafond 50 or partagé avec la vape, atomique', async () => {
    await t.db.runAsync(
      `INSERT INTO wallet_ledger (id, resource, amount, reason, idempotency_key, created_at) VALUES ('w1','gold',45,'vape','vape:test:1',?)`,
      '2026-03-11T06:00:00.000Z',
    );
    const inst = await acceptOne('dq_proches_call');
    await makeCall();
    const r = await claim(inst);
    expect(r).toMatchObject({ ok: true, gold: 5, balance: 50 });
    expect(await goldSum()).toBe(50);
  });

  test('16. palier 0 or : mission réclamée définitivement, preuve consommée', async () => {
    await t.db.runAsync(
      `INSERT INTO wallet_ledger (id, resource, amount, reason, idempotency_key, created_at) VALUES ('w1','gold',50,'vape','vape:test:1',?)`,
      '2026-03-11T06:00:00.000Z',
    );
    const inst = await acceptOne('dq_proches_call');
    await makeCall();
    const r = await claim(inst);
    expect(r).toMatchObject({ ok: true, gold: 0 });
    expect(await goldSum()).toBe(50);
    expect(await claim(inst)).toMatchObject({ ok: false });
    const st = await t.db.getFirstAsync<{ status: string }>(`SELECT status FROM renewable_quest_instances WHERE id = ?`, inst);
    expect(st?.status).toBe('claimed');
    expect(await count('quest_evidence_claims')).toBe(1);
    const c = (await listDailyQuestHistory(t.db))[0];
    expect(c).toMatchObject({ outcome: 'claimed', creditedGold: 0 });
    // le lendemain (UTC) rien n'est rétroactif : l'ancienne mission n'est pas re-payable
    expect(await claim(inst, '2026-03-12T09:00:00.000Z')).toMatchObject({ ok: false });
    expect(await goldSum()).toBe(50);
  });

  test('17. changement de jour : mission acceptée reportée, offres non acceptées expirées', async () => {
    await forceSet(D1, [{ id: 'dq_proches_call' }, { id: 'dq_divers_activity' }, { id: 'rnw_breathe_calm' }]);
    const acc = await acceptDailyQuest(t.db, offerId(D1, 'dq_proches_call'), o(T_ACCEPT));
    expect(acc.ok).toBe(true);
    const day2 = await getDailyQuestBlock(t.db, o('2026-03-12T08:00:00.000Z'));
    const carried = day2.cards.find((c) => c.template.id === 'dq_proches_call' && c.carriedOver);
    expect(carried?.state).toBe('active');
    expect(day2.cards.filter((c) => !c.carriedOver)).toHaveLength(3);
    const hist = await listDailyQuestHistory(t.db);
    expect(hist.filter((h) => h.outcome === 'expired')).toHaveLength(2);
    expect(await acceptDailyQuest(t.db, offerId(D1, 'dq_divers_activity'), o('2026-03-12T08:00:00.000Z'))).toMatchObject({ ok: false });
    // la mission reportée reste réclamable avec un appel fait après son acceptation
    await makeCall('2026-03-12T08:10:00.000Z', '2026-03-12T08:10:00.000Z');
    const instId = acc.ok ? acc.instanceId : '';
    expect(await claim(instId, '2026-03-12T09:00:00.000Z')).toMatchObject({ ok: true, gold: 8 });
  });

  test('17b. maximum 3 quêtes acceptées respecté, avec explication', async () => {
    await forceSet(D1, [{ id: 'dq_proches_call' }, { id: 'dq_divers_activity' }, { id: 'rnw_breathe_calm' }]);
    for (const id of ['dq_proches_call', 'dq_divers_activity', 'rnw_breathe_calm']) {
      expect((await acceptDailyQuest(t.db, offerId(D1, id), o(T_ACCEPT))).ok).toBe(true);
    }
    const block = await getDailyQuestBlock(t.db, o(T_ACCEPT));
    expect(block.slotsFull).toBe(true);
    await forceSet('2026-03-12', [{ id: 'dq_proches_call' }]);
    const r = await acceptDailyQuest(t.db, offerId('2026-03-12', 'dq_proches_call'), o('2026-03-12T08:00:00.000Z'));
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.message).toMatch(/Carnet plein/);
    const inst = block.cards.find((c) => c.template.id === 'dq_divers_activity')!.instanceId!;
    expect((await abandonRenewableQuest(t.db, inst, at(T_CLAIM))).ok).toBe(true);
    expect((await getDailyQuestBlock(t.db, o(T_CLAIM))).cards.find((c) => c.template.id === 'dq_divers_activity')?.state).toBe('failed');
  });

  test('18. migration 016 → 017 additive, sans perte', async () => {
    await getDiversDashboard(t.db, o(T_ACCEPT));
    await passDiversSuggestion(t.db, 0, o(T_ACCEPT));
    const before = await t.db.getFirstAsync<{ slot0_activity_id: string; slot1_activity_id: string }>(`SELECT * FROM divers_day_slots`);
    await t.db.execAsync(`
      DROP TABLE daily_quest_offers; DROP TABLE daily_quest_sets; DROP TABLE quest_evidence_claims;
      ALTER TABLE divers_day_slots DROP COLUMN slot0_passed; ALTER TABLE divers_day_slots DROP COLUMN slot1_passed;
      DELETE FROM schema_migrations WHERE version = 17;
    `);
    await migrate(t.db);
    await migrate(t.db);
    const versions = (await t.db.getAllAsync<{ version: number }>(`SELECT version FROM schema_migrations ORDER BY version`)).map((r) => r.version);
    expect(versions[versions.length - 1]).toBe(17);
    const after = await t.db.getFirstAsync<{ slot0_activity_id: string; slot1_activity_id: string; slot0_passed: number }>(`SELECT * FROM divers_day_slots`);
    expect(after?.slot0_activity_id).toBe(before?.slot0_activity_id);
    expect(after?.slot0_passed).toBe(0);
    expect((await getDailyQuestBlock(t.db, o(T_ACCEPT))).cards).toHaveLength(3);
  });

  test('19. sauvegarde / restauration : offres, preuves consommées, historique', async () => {
    const inst = await acceptOne('dq_proches_call');
    const call = await makeCall();
    expect((await claim(inst)).ok).toBe(true);
    const expectedHist = await listDailyQuestHistory(t.db);
    const exported = await exportBackupPayload(t.db, '0.2.0');
    for (const tbl of ['daily_quest_sets', 'daily_quest_offers', 'quest_evidence_claims']) {
      expect((exported.manifest.tables as string[]).includes(tbl)).toBe(true);
    }
    const target = await openNodeSqliteDb();
    try {
      await importBackupPayload(target.db, exported.manifest, exported.data);
      expect(await listDailyQuestHistory(target.db)).toEqual(expectedHist);
      expect(await cancelCall(target.db, call.id, o(T_CLAIM))).toMatchObject({ ok: false, code: 'rewarded' });
      expect(Number((await target.db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM quest_evidence_claims`))?.n)).toBe(1);
    } finally {
      target.close();
    }
  });

  test('R1. respiration acceptée : navigation vers la carte quête avec instanceId', async () => {
    const inst = await acceptOne('rnw_breathe_calm');
    const c = await card(T_ACCEPT, 'rnw_breathe_calm');
    expect(c).toBeTruthy();
    const route = resolveDailyOpenRoute(c!);
    expect(route).toEqual({ kind: 'adventure', tab: 'quests', instanceId: inst });
  });

  test('R2. respiration : durée insuffisante puis chrono validé et réclamation unique', async () => {
    const inst = await acceptOne('rnw_breathe_calm');
    expect((await startRenewableTimer(t.db, inst)).ok).toBe(true);
    const tooSoon = await succeedRenewableTimer(t.db, inst);
    expect(tooSoon.ok).toBe(false);
    expect(tooSoon.message).toMatch(/Encore .* s/);
    const past = new Date(Date.now() - 120_000).toISOString();
    await t.db.runAsync(
      `UPDATE renewable_quest_instances SET progress_json = ? WHERE id = ?`,
      JSON.stringify({
        timer: { kind: 'breathing', startedUtc: past, targetSec: 60, state: 'running' },
        dailyOfferId: offerId(D1, 'rnw_breathe_calm'),
      }),
      inst,
    );
    expect((await succeedRenewableTimer(t.db, inst, at(T_CLAIM))).ok).toBe(true);
    expect((await card(T_CLAIM, 'rnw_breathe_calm'))?.state).toBe('ready');
    const r = await claim(inst);
    expect(r).toMatchObject({ ok: true, gold: 6 });
    expect(await claim(inst)).toMatchObject({ ok: false });
    expect(await goldSum()).toBe(6);
    const st = await t.db.getFirstAsync<{ status: string }>(`SELECT status FROM renewable_quest_instances WHERE id = ?`, inst);
    expect(st?.status).toBe('claimed');
  });

  test('R3. Sport : séance sur une autre métrique que la mission refusée', async () => {
    const goalWalk = await setSportGoal(
      t.db,
      { activityId: 'walking', metric: 'duration_sec', target: 1800 },
      o('2026-03-10T10:00:00.000Z'),
    );
    if (!goalWalk.ok || !goalWalk.goal) throw new Error('goal walk');
    await forceSet(D1, [
      {
        id: 'dq_sport_walking',
        params: {
          activityId: 'walking',
          goalId: goalWalk.goal.id,
          goalMetric: 'duration_sec',
          goalTarget: 1800,
        },
      },
      { id: 'dq_proches_call' },
    ]);
    const acc = await acceptDailyQuest(t.db, offerId(D1, 'dq_sport_walking'), o(T_ACCEPT));
    if (!acc.ok) throw new Error(acc.message);
    const distGoal = await setSportGoal(t.db, { activityId: 'walking', metric: 'distance_m', target: 5000 }, o(T_ACT));
    if (!distGoal.ok || !distGoal.goal) throw new Error('goal dist');
    const v = validateSessionForm({
      activityId: 'walking',
      reps: '',
      durationMin: '',
      distanceKm: '5',
      freeMetric: 'reps',
      disciplineName: '',
      note: '',
    });
    if (!v.ok) throw new Error('walk form');
    const s = await addSession(
      t.db,
      { session: v.value, performedAt: at(T_ACT), outcome: 'achieved', goalId: distGoal.goal.id },
      o(T_ACT),
    );
    expect(s.ok).toBe(true);
    expect((await claim(acc.instanceId)).ok).toBe(false);
    const progress = (await card(T_CLAIM, 'dq_sport_walking'))?.progress?.label ?? '';
    expect(progress).toMatch(/autre métrique|pas encore|objectif/);
  });

  test('R4. Sport : objectif abaissé après acceptation — 10 reps ne valide pas une mission à 20', async () => {
    const goalId = await setGoal20();
    const inst = await acceptSport(goalId);
    const lowered = await setSportGoal(t.db, { activityId: 'pushups', metric: 'reps', target: 10 }, o(T_ACT));
    if (!lowered.ok || !lowered.goal) throw new Error('lower');
    await logSport('10', 'achieved', lowered.goal.id);
    expect((await claim(inst)).ok).toBe(false);
  });

  test('R5. Sport : objectif abaissé — 20 reps achieved valide encore la mission figée à 20', async () => {
    const goalId = await setGoal20();
    const inst = await acceptSport(goalId);
    const lowered = await setSportGoal(t.db, { activityId: 'pushups', metric: 'reps', target: 10 }, o(T_ACT));
    if (!lowered.ok || !lowered.goal) throw new Error('lower');
    await logSport('20', 'achieved', lowered.goal.id);
    expect((await card(T_CLAIM, 'dq_sport_pushups'))?.state).toBe('ready');
    expect((await claim(inst))).toMatchObject({ ok: true, gold: 10 });
  });

  test('20. quêtes historiques inchangées : le carnet générique ne propose pas les missions du jour', async () => {
    const inst = await acceptOne('dq_proches_call');
    const board = await getRenewableQuestBoard(t.db);
    expect(board.entries.filter((e) => e.state === 'offered').every((e) => !e.template.id.startsWith('dq_'))).toBe(true);
    expect(board.entries.find((e) => e.instanceId === inst)?.state).toBe('active');
    expect(board.acceptedCount).toBe(1);
    await makeCall();
    await claim(inst);
    const after = await getRenewableQuestBoard(t.db);
    expect(after.entries.every((e) => !e.template.id.startsWith('dq_') || e.state !== 'offered')).toBe(true);
    // pas de nouvelle offre générique issue d'une mission du jour
    expect(after.entries.filter((e) => e.state === 'offered').length).toBeLessThanOrEqual(3);
  });
});
