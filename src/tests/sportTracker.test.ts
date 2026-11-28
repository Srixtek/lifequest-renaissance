jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: '/tmp/',
  documentDirectory: '/tmp/',
  EncodingType: { Base64: 'base64' },
  writeAsStringAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
}));

import { migrate } from '../data/db/client';
import {
  computeSportSuggestion,
  distanceToKmText,
  durationToMinutesText,
  formatDistance,
  formatDuration,
  matchHabitGoalToActivity,
  parseDistanceKmInput,
  parseDurationMinutesInput,
  parseRepsInput,
  validateSessionForm,
  type SessionFormInput,
  type SportActivityId,
  type SportOutcome,
  type ValidatedSession,
} from '../domain/rules/sport';
import {
  acceptSportSuggestion,
  addSession,
  adoptHabitGoal,
  cancelSession,
  dismissSportSuggestion,
  editSession,
  getSessionAudit,
  getSportDashboard,
  getSportDayTotals,
  getSportGoalHistory,
  listDaySessions,
  listSportEvidence,
  setSportGoal,
  type SportOpts,
} from '../domain/services/sportTrackerService';
import { exportBackupPayload, importBackupPayload } from '../domain/services/backupService';
import { addConsumption, getAlcoholDashboard } from '../domain/services/alcoholTrackerService';
import { declareVape, getVapeTrackerDashboard, startVapeMainSession } from '../domain/services/vapeTrackerService';
import { validateDrinkForm } from '../domain/rules/alcohol';
import { nodeSqliteAvailable, openNodeSqliteDb, type TestDb } from './helpers/nodeSqliteDb';

const TZ = 'Europe/Paris';
const at = (iso: string) => new Date(iso);
const opts = (nowIso: string): SportOpts => ({ timeZone: TZ, dayStartHour: 4, now: at(nowIso) });
const NOW = '2026-03-11T12:00:00.000Z';

function form(activityId: SportActivityId, patch: Partial<SessionFormInput> = {}): ValidatedSession {
  const v = validateSessionForm({
    activityId,
    reps: '',
    durationMin: '',
    distanceKm: '',
    freeMetric: 'reps',
    disciplineName: '',
    note: '',
    ...patch,
  });
  if (!v.ok) throw new Error(`séance invalide: ${JSON.stringify(v.errors)}`);
  return v.value;
}
const pushups = (reps: string, patch: Partial<SessionFormInput> = {}) => form('pushups', { reps, ...patch });
const walk = (min: string, km = '') => form('walking', { durationMin: min, distanceKm: km });
const run = (min: string, km = '') => form('running', { durationMin: min, distanceKm: km });

describe('V1-03A — règles pures du journal Sport', () => {
  test('saisies strictes : entiers, minutes, kilomètres ; vide ≠ zéro', () => {
    expect(parseRepsInput('16')).toEqual({ ok: true, value: 16 });
    expect(parseRepsInput('0')).toEqual({ ok: true, value: 0 });
    for (const bad of ['', '  ', '-1', '1.5', '1,5', 'abc', '1e3', '+4', '10001', '123456']) {
      expect(parseRepsInput(bad).ok).toBe(false);
    }
    expect(parseDurationMinutesInput('25')).toEqual({ ok: true, value: 1500 });
    expect(parseDurationMinutesInput('12,5')).toEqual({ ok: true, value: 750 });
    expect(parseDurationMinutesInput('0')).toEqual({ ok: true, value: 0 });
    for (const bad of ['', 'x', '-5', '12,55', '1441', '9999', '1e2']) {
      expect(parseDurationMinutesInput(bad).ok).toBe(false);
    }
    expect(parseDistanceKmInput('5')).toEqual({ ok: true, value: 5000 });
    expect(parseDistanceKmInput('3,25')).toEqual({ ok: true, value: 3250 });
    expect(parseDistanceKmInput('0,005')).toEqual({ ok: true, value: 5 });
    for (const bad of ['', 'x', '-1', '1,2345', '1001']) expect(parseDistanceKmInput(bad).ok).toBe(false);
  });

  test('formulaire par activité', () => {
    const base: SessionFormInput = {
      activityId: 'pushups',
      reps: '',
      durationMin: '',
      distanceKm: '',
      freeMetric: 'reps',
      disciplineName: '',
      note: '',
    };
    expect(validateSessionForm({ ...base, reps: '16' })).toMatchObject({ ok: true, value: { reps: 16, durationSec: null } });
    expect(validateSessionForm(base).ok).toBe(false); // répétitions non renseignées ≠ 0
    expect(validateSessionForm({ ...base, activityId: 'walking' }).ok).toBe(false);
    expect(validateSessionForm({ ...base, activityId: 'walking', durationMin: '30' })).toMatchObject({
      ok: true,
      value: { durationSec: 1800, distanceM: null },
    });
    expect(validateSessionForm({ ...base, activityId: 'running', distanceKm: '5' })).toMatchObject({
      ok: true,
      value: { durationSec: null, distanceM: 5000 },
    });
    expect(validateSessionForm({ ...base, activityId: 'running', durationMin: '25', distanceKm: 'x' }).ok).toBe(false);
    // Séance libre : durée OU répétitions
    expect(validateSessionForm({ ...base, activityId: 'free', freeMetric: 'duration', durationMin: '20', disciplineName: ' Yoga ' })).toMatchObject({
      ok: true,
      value: { durationSec: 1200, reps: null, disciplineName: 'Yoga' },
    });
    expect(validateSessionForm({ ...base, activityId: 'free', freeMetric: 'reps', reps: '12' })).toMatchObject({ ok: true, value: { reps: 12 } });
    expect(validateSessionForm({ ...base, activityId: 'free', freeMetric: 'duration' }).ok).toBe(false);
    expect(validateSessionForm({ ...base, reps: '5', note: 'x'.repeat(201) }).ok).toBe(false);
    expect(validateSessionForm({ ...base, activityId: 'nope' as SportActivityId, reps: '5' }).ok).toBe(false);
  });

  test('formats d\'affichage et aller-retour des champs', () => {
    expect(formatDuration(1500)).toBe('25 min');
    expect(formatDuration(750)).toBe('12 min 30 s');
    expect(formatDuration(3900)).toBe('1 h 05');
    expect(formatDistance(800)).toBe('800 m');
    expect(formatDistance(5000)).toBe('5 km');
    expect(formatDistance(3250)).toBe('3,25 km');
    expect(durationToMinutesText(750)).toBe('12,5');
    expect(durationToMinutesText(1500)).toBe('25');
    expect(distanceToKmText(3250)).toBe('3,25');
    expect(distanceToKmText(5000)).toBe('5');
  });

  test('suggestion : baisse mesurée (cible 20, 16 réalisé → 18), jamais après une seule réussite', () => {
    const att = (v: number, outcome: 'achieved' | 'failed', d: string) => ({ value: v, outcome, localDate: d });
    const failedThree = [att(16, 'failed', '2026-03-10'), att(15, 'failed', '2026-03-09'), att(17, 'failed', '2026-03-08')];
    const s = computeSportSuggestion({ metric: 'reps', target: 20, attemptsNewestFirst: failedThree, attemptsSinceDismissal: null });
    expect(s).toMatchObject({ direction: 'lower', proposedTarget: 18, currentTarget: 20 });
    expect(s?.message).toMatch(/rien ne change sans ton accord/);
    // Deux tentatives seulement : pas assez de données
    expect(computeSportSuggestion({ metric: 'reps', target: 20, attemptsNewestFirst: failedThree.slice(0, 2), attemptsSinceDismissal: null })).toBeNull();
    // Une seule réussite, ou 3 réussites : aucune hausse
    expect(computeSportSuggestion({ metric: 'reps', target: 20, attemptsNewestFirst: [att(22, 'achieved', 'a')], attemptsSinceDismissal: null })).toBeNull();
    const three = [att(20, 'achieved', 'd1'), att(21, 'achieved', 'd2'), att(22, 'achieved', 'd3')];
    expect(computeSportSuggestion({ metric: 'reps', target: 20, attemptsNewestFirst: three, attemptsSinceDismissal: null })).toBeNull();
    // 4 réussites sur 3 jours : hausse proposée (+10 %)
    const four = [att(20, 'achieved', 'd4'), ...three];
    expect(computeSportSuggestion({ metric: 'reps', target: 20, attemptsNewestFirst: four, attemptsSinceDismissal: null })).toMatchObject({
      direction: 'raise',
      proposedTarget: 22,
    });
    // 4 réussites le même jour : pas de hausse
    const sameDay = four.map((a) => ({ ...a, localDate: 'd1' }));
    expect(computeSportSuggestion({ metric: 'reps', target: 20, attemptsNewestFirst: sameDay, attemptsSinceDismissal: null })).toBeNull();
    // Mélange : pas de baisse si la majorité est réussie
    const mixed = [att(16, 'failed', 'a'), att(20, 'achieved', 'b'), att(21, 'achieved', 'c'), att(20, 'achieved', 'd')];
    expect(computeSportSuggestion({ metric: 'reps', target: 20, attemptsNewestFirst: mixed, attemptsSinceDismissal: null })).toBeNull();
    // Après un refus : silence jusqu'à 2 nouvelles tentatives
    expect(computeSportSuggestion({ metric: 'reps', target: 20, attemptsNewestFirst: failedThree, attemptsSinceDismissal: 1 })).toBeNull();
    expect(computeSportSuggestion({ metric: 'reps', target: 20, attemptsNewestFirst: failedThree, attemptsSinceDismissal: 2 })).not.toBeNull();
    // Durée : arrondie à la minute
    const dur = computeSportSuggestion({
      metric: 'duration_sec',
      target: 1800,
      attemptsNewestFirst: [att(1500, 'failed', 'a'), att(1500, 'failed', 'b'), att(1500, 'failed', 'c')],
      attemptsSinceDismissal: null,
    });
    expect(dur?.proposedTarget).toBe(1620);
  });

  test('habitudes Sport personnalisées : rattachement seulement sans ambiguïté', () => {
    expect(matchHabitGoalToActivity({ title: 'Pompes du matin', unit: 'pompes', target: 30 })).toEqual({
      activityId: 'pushups',
      metric: 'reps',
      target: 30,
    });
    expect(matchHabitGoalToActivity({ title: 'Marche', unit: 'min', target: 45 })).toEqual({
      activityId: 'walking',
      metric: 'duration_sec',
      target: 2700,
    });
    expect(matchHabitGoalToActivity({ title: 'Course à pied', unit: 'km', target: 5 })).toEqual({
      activityId: 'running',
      metric: 'distance_m',
      target: 5000,
    });
    expect(matchHabitGoalToActivity({ title: 'Marche ou course', unit: 'min', target: 30 })).toBeNull();
    expect(matchHabitGoalToActivity({ title: 'Sport ou mouvement', unit: 'min', target: 30 })).toBeNull();
    expect(matchHabitGoalToActivity({ title: 'Pompes', unit: 'kg', target: 30 })).toBeNull();
    expect(matchHabitGoalToActivity({ title: 'Parcours santé', unit: 'min', target: 30 })).toBeNull();
    expect(matchHabitGoalToActivity({ title: 'Marche', unit: 'min', target: null })).toBeNull();
  });
});

const suite = nodeSqliteAvailable() ? describe : describe.skip;

suite('V1-03A — journal Sport (SQLite réel, node:sqlite)', () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await openNodeSqliteDb();
  });
  afterEach(() => t.close());

  const count = async (table: string) =>
    Number((await t.db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))!.n);

  const log = async (
    nowIso: string,
    session: ValidatedSession,
    performedIso: string,
    extra: { outcome?: SportOutcome; goalId?: string | null; requestId?: string } = {},
  ) => {
    const r = await addSession(
      t.db,
      {
        session,
        performedAt: at(performedIso),
        outcome: extra.outcome,
        goalId: extra.goalId,
        clientRequestId: extra.requestId,
      },
      opts(nowIso),
    );
    if (!r.ok) throw new Error(`addSession: ${r.code}`);
    return r;
  };

  const setGoal = async (activityId: SportActivityId, metric: 'reps' | 'duration_sec' | 'distance_m', target: number | null, now = NOW) => {
    const r = await setSportGoal(t.db, { activityId, metric, target }, opts(now));
    if (!r.ok) throw new Error(`setSportGoal: ${r.code}`);
    return r;
  };

  const summary = async (id: SportActivityId, now = NOW) =>
    (await getSportDashboard(t.db, opts(now))).activities.find((a) => a.activity.id === id)!;

  const rewardTables = [
    'xp_ledger',
    'wallet_ledger',
    'inventory_items',
    'quest_instances',
    'renewable_quest_history',
    'daily_reward_days',
    'tracking_events',
    'challenge_sessions',
    'goal_definitions',
    'goal_versions',
  ];
  const rewardSnapshot = async () => ({
    counts: await Promise.all(rewardTables.map((n) => count(n))),
    rows: await t.db.getAllAsync(`SELECT * FROM xp_ledger ORDER BY id`),
    wallet: await t.db.getAllAsync(`SELECT * FROM wallet_ledger ORDER BY id`),
    character: await t.db.getAllAsync(`SELECT * FROM character_progress`),
  });

  test('1. séance Pompes 16 répétitions : stockée en entiers, séance neutre', async () => {
    const r = await log(NOW, pushups('16'), '2026-03-11T10:00:00Z');
    expect(r.duplicate).toBe(false);
    expect(r.session).toMatchObject({
      activityId: 'pushups',
      reps: 16,
      durationSec: null,
      distanceM: null,
      outcome: 'free',
      goalId: null,
      status: 'active',
      localDate: '2026-03-11',
    });
    const s = await summary('pushups');
    expect(s.today).toMatchObject({ count: 1, totalReps: 16, bestReps: 16 });
    expect(s.records.reps).toMatchObject({ value: 16, localDate: '2026-03-11' });
    expect(r.newRecords).toEqual([{ metric: 'reps', value: 16, previous: null }]);
  });

  test('2. objectif 20, réalisé 16, « Échoué » : tentative conservée, 16 comptées, record, aucune réussite', async () => {
    const before = await rewardSnapshot();
    const goal = await setGoal('pushups', 'reps', 20);
    const goalId = goal.goal!.id;

    // « Atteint » avec 16 est refusé : une tentative non atteinte n'est jamais présentée comme réussie
    expect(
      await addSession(t.db, { session: pushups('16'), performedAt: at('2026-03-11T10:00:00Z'), outcome: 'achieved', goalId }, opts(NOW)),
    ).toEqual({ ok: false, code: 'below_target' });
    expect(await count('sport_sessions')).toBe(0);

    const r = await log(NOW, pushups('16'), '2026-03-11T10:00:00Z', { outcome: 'failed', goalId });
    expect(r.session).toMatchObject({ outcome: 'failed', reps: 16, goalId, goalMetric: 'reps', goalTarget: 20 });
    expect(r.newRecords).toEqual([{ metric: 'reps', value: 16, previous: null }]);

    const s = await summary('pushups');
    expect(s.today).toMatchObject({ count: 1, totalReps: 16, bestReps: 16, achieved: 0, failed: 1 });
    expect(s.week).toMatchObject({ totalReps: 16, achieved: 0, failed: 1 });
    expect(s.records.reps?.value).toBe(16);

    const evidence = await listSportEvidence(t.db);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({ outcome: 'failed', reps: 16, countsAsSuccess: false, goalTarget: 20 });

    expect(await rewardSnapshot()).toEqual(before);
  });

  test('3. objectif atteint correctement classé ; échec déclaré malgré 20+ accepté ; classement explicite exigé', async () => {
    const goalId = (await setGoal('pushups', 'reps', 20)).goal!.id;
    const a = await log(NOW, pushups('20'), '2026-03-11T08:00:00Z', { outcome: 'achieved', goalId });
    expect(a.session).toMatchObject({ outcome: 'achieved', goalTarget: 20 });
    await log(NOW, pushups('24'), '2026-03-11T09:00:00Z', { outcome: 'achieved', goalId });
    const s = await summary('pushups');
    expect(s.today).toMatchObject({ count: 2, achieved: 2, failed: 0, totalReps: 44, bestReps: 24 });
    const ev = await listSportEvidence(t.db);
    expect(ev.map((e) => e.countsAsSuccess)).toEqual([true, true]);

    // Objectif inconnu / périmé / activité sans objectif / résultat sans objectif
    expect(await addSession(t.db, { session: pushups('20'), performedAt: at('2026-03-11T09:30:00Z'), outcome: 'achieved', goalId: 'sgl_x' }, opts(NOW))).toEqual({ ok: false, code: 'stale_goal' });
    expect(await addSession(t.db, { session: pushups('20'), performedAt: at('2026-03-11T09:30:00Z'), outcome: 'achieved' }, opts(NOW))).toEqual({ ok: false, code: 'no_goal' });
    expect(await addSession(t.db, { session: walk('30'), performedAt: at('2026-03-11T09:30:00Z'), outcome: 'failed', goalId }, opts(NOW))).toEqual({ ok: false, code: 'no_goal' });
    expect(await addSession(t.db, { session: pushups('20'), performedAt: at('2026-03-11T09:30:00Z'), outcome: 'free', goalId }, opts(NOW))).toEqual({ ok: false, code: 'invalid_outcome' });
    // Échec déclaré par l'utilisateur alors que la valeur dépasse la cible : toujours accepté tel quel
    const f = await log(NOW, pushups('21'), '2026-03-11T09:40:00Z', { outcome: 'failed', goalId });
    expect(f.session.outcome).toBe('failed');
    expect(await count('sport_sessions')).toBe(3);
  });

  test('3. objectif de durée (marche) : classement sur la bonne mesure', async () => {
    const goalId = (await setGoal('walking', 'duration_sec', 1800)).goal!.id;
    expect(await addSession(t.db, { session: walk('', '2'), performedAt: at('2026-03-11T09:00:00Z'), outcome: 'achieved', goalId }, opts(NOW))).toEqual({ ok: false, code: 'missing_performance' });
    expect(await addSession(t.db, { session: walk('25'), performedAt: at('2026-03-11T09:00:00Z'), outcome: 'achieved', goalId }, opts(NOW))).toEqual({ ok: false, code: 'below_target' });
    const ok = await log(NOW, walk('35', '2,8'), '2026-03-11T09:00:00Z', { outcome: 'achieved', goalId });
    expect(ok.session).toMatchObject({ durationSec: 2100, distanceM: 2800, goalMetric: 'duration_sec', goalTarget: 1800 });
    // Une activité ne peut pas porter une mesure incompatible
    expect(await setSportGoal(t.db, { activityId: 'pushups', metric: 'duration_sec', target: 60 }, opts(NOW))).toEqual({ ok: false, code: 'invalid_goal' });
    expect(await setSportGoal(t.db, { activityId: 'free', metric: 'reps', target: 10 }, opts(NOW))).toEqual({ ok: false, code: 'invalid_goal' });
  });

  test('4. séance libre neutre : ni réussite ni échec, même avec un objectif actif', async () => {
    const goalId = (await setGoal('pushups', 'reps', 20)).goal!.id;
    const r = await log(NOW, form('free', { freeMetric: 'duration', durationMin: '40', disciplineName: 'Yoga' }), '2026-03-11T07:00:00Z');
    expect(r.session).toMatchObject({ activityId: 'free', outcome: 'free', goalId: null, durationSec: 2400, disciplineName: 'Yoga', reps: null });
    expect(r.newRecords).toEqual([]);
    const reps = await log(NOW, pushups('8'), '2026-03-11T08:00:00Z'); // pompes sans défi
    expect(reps.session.outcome).toBe('free');
    const s = await summary('pushups');
    expect(s.today).toMatchObject({ count: 1, achieved: 0, failed: 0, totalReps: 8 });
    expect(s.suggestion).toBeNull();
    const ev = await listSportEvidence(t.db);
    expect(ev.every((e) => !e.countsAsSuccess)).toBe(true);
    expect(goalId).toBeTruthy();
    const free = await summary('free');
    expect(free.records).toEqual({});
    expect(free.today).toMatchObject({ count: 1, totalDurationSec: 2400 });
  });

  test('5. plusieurs séances le même jour : nombre, total, meilleure séance, durée et distance totales', async () => {
    await log(NOW, pushups('10'), '2026-03-11T06:00:00Z');
    await log(NOW, pushups('16'), '2026-03-11T08:00:00Z');
    await log(NOW, pushups('12'), '2026-03-11T10:00:00Z');
    const p = await summary('pushups');
    expect(p.today).toMatchObject({ count: 3, totalReps: 38, bestReps: 16 });
    expect(p.today.totalReps).not.toBe(p.today.bestReps);

    await log(NOW, walk('30', '2,5'), '2026-03-11T07:00:00Z');
    await log(NOW, walk('45'), '2026-03-11T09:00:00Z');
    const w = await summary('walking');
    expect(w.today).toMatchObject({ count: 2, totalDurationSec: 4500, bestDurationSec: 2700, totalDistanceM: 2500, bestDistanceM: 2500 });
    const onlyTime = await getSportDayTotals(t.db, 'walking', '2026-03-10', '2026-03-11');
    expect(onlyTime[0]).toMatchObject({ localDate: '2026-03-10', agg: { count: 0, totalDurationSec: null } });

    // « Non renseigné » ≠ « réalisé à zéro »
    await log(NOW, pushups('0'), '2026-03-10T09:00:00Z');
    const days = await getSportDayTotals(t.db, 'pushups', '2026-03-09', '2026-03-11');
    expect(days[0].agg).toMatchObject({ count: 0, totalReps: null });
    expect(days[1].agg).toMatchObject({ count: 1, totalReps: 0 });
    expect(days[2].agg).toMatchObject({ count: 3, totalReps: 38 });
    // Un zéro explicite n'est pas un record
    expect((await summary('pushups')).records.reps?.value).toBe(16);
  });

  test('5. semaine : totaux hebdomadaires lundi–dimanche, séances d\'autres semaines exclues', async () => {
    await log('2026-03-09T12:00:00Z', pushups('10'), '2026-03-09T08:00:00Z'); // lundi
    await log('2026-03-11T12:00:00Z', pushups('15'), '2026-03-11T08:00:00Z'); // mercredi
    await log('2026-03-08T12:00:00Z', pushups('99'), '2026-03-08T08:00:00Z'); // dimanche précédent
    const s = await summary('pushups');
    expect(s.week).toMatchObject({ count: 2, totalReps: 25, bestReps: 15 });
    expect(s.today).toMatchObject({ count: 1, totalReps: 15 });
    const d = await getSportDashboard(t.db, opts(NOW));
    expect(d).toMatchObject({ weekStart: '2026-03-09', weekEnd: '2026-03-15', today: '2026-03-11' });
  });

  test('6. records par activité : pompes, durée et distance marche/course séparés ; échecs et annulées', async () => {
    await log(NOW, pushups('16'), '2026-03-10T10:00:00Z');
    await log(NOW, walk('60', '4'), '2026-03-10T11:00:00Z');
    await log(NOW, walk('30', '5'), '2026-03-10T12:00:00Z');
    await log(NOW, run('25', '4,5'), '2026-03-10T13:00:00Z');
    await log(NOW, run('40'), '2026-03-10T14:00:00Z');
    const d = await getSportDashboard(t.db, opts(NOW));
    const rec = (id: SportActivityId) => d.activities.find((a) => a.activity.id === id)!.records;
    expect(rec('pushups').reps?.value).toBe(16);
    expect(rec('walking').duration_sec?.value).toBe(3600);
    expect(rec('walking').distance_m?.value).toBe(5000);
    expect(rec('walking').reps).toBeUndefined();
    expect(rec('running').duration_sec?.value).toBe(2400);
    expect(rec('running').distance_m?.value).toBe(4500);
    expect(rec('free')).toEqual({});
    // Égalité : le plus ancien garde le record
    const later = await log(NOW, pushups('16'), '2026-03-11T09:00:00Z');
    expect(later.newRecords).toEqual([]);
    expect((await summary('pushups')).records.reps?.performedAt).toBe('2026-03-10T10:00:00.000Z');
    // Un record battu est signalé avec la valeur précédente
    const better = await log(NOW, pushups('18'), '2026-03-11T10:00:00Z');
    expect(better.newRecords).toEqual([{ metric: 'reps', value: 18, previous: 16 }]);
  });

  test('7. correction d\'une performance : totaux et record recalculés, avant/après tracés', async () => {
    const a = await log(NOW, pushups('16'), '2026-03-10T10:00:00Z');
    await log(NOW, pushups('14'), '2026-03-11T08:00:00Z');
    expect((await summary('pushups')).records.reps?.value).toBe(16);

    const r = await editSession(t.db, a.session.id, { session: pushups('10', { note: 'main fatiguée' }), performedAt: at('2026-03-10T10:00:00Z') }, opts(NOW));
    expect(r).toMatchObject({ ok: true, changed: true });
    const s = await summary('pushups');
    expect(s.records.reps?.value).toBe(14); // recalculé depuis les séances valides
    expect(s.week).toMatchObject({ totalReps: 24 });
    const audit = await getSessionAudit(t.db, a.session.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ kind: 'edit', before: { reps: 16, note: null }, after: { reps: 10, note: 'main fatiguée' } });

    // Aucun changement : aucune ligne d'audit
    const same = await editSession(t.db, a.session.id, { session: pushups('10', { note: 'main fatiguée' }), performedAt: at('2026-03-10T10:00:00Z') }, opts(NOW));
    expect(same).toMatchObject({ ok: true, changed: false });
    expect(await getSessionAudit(t.db, a.session.id)).toHaveLength(1);

    // Correction de la date : la journée logique est recalculée (03:30 Paris → veille)
    const moved = await editSession(t.db, a.session.id, { session: pushups('10', { note: 'main fatiguée' }), performedAt: at('2026-03-11T02:30:00Z') }, opts(NOW));
    expect(moved).toMatchObject({ ok: true, changed: true });
    if (moved.ok) expect(moved.session.localDate).toBe('2026-03-10');
    const day = await listDaySessions(t.db, '2026-03-10');
    expect(day.map((x) => x.id)).toEqual([a.session.id]);
    expect(day[0].corrections).toBe(2);

    // Marche : durée et distance corrigées
    const w = await log(NOW, walk('30', '2'), '2026-03-11T07:00:00Z');
    await editSession(t.db, w.session.id, { session: walk('40', '3,5'), performedAt: at('2026-03-11T07:00:00Z') }, opts(NOW));
    const ws = await summary('walking');
    expect(ws.records.duration_sec?.value).toBe(2400);
    expect(ws.records.distance_m?.value).toBe(3500);
  });

  test('7. correction d\'une tentative : le classement reste cohérent avec la cible figée', async () => {
    const goalId = (await setGoal('pushups', 'reps', 20)).goal!.id;
    const a = await log(NOW, pushups('20'), '2026-03-11T08:00:00Z', { outcome: 'achieved', goalId });
    // 20 → 16 en restant « atteint » : refusé
    expect(await editSession(t.db, a.session.id, { session: pushups('16'), performedAt: at('2026-03-11T08:00:00Z') }, opts(NOW))).toEqual({
      ok: false,
      code: 'below_target',
    });
    // L'objectif change ensuite : la tentative garde la cible d'alors
    await setGoal('pushups', 'reps', 25, '2026-03-11T12:30:00.000Z');
    const r = await editSession(t.db, a.session.id, { session: pushups('16'), performedAt: at('2026-03-11T08:00:00Z'), outcome: 'failed' }, opts(NOW));
    expect(r).toMatchObject({ ok: true, changed: true });
    if (r.ok) expect(r.session).toMatchObject({ outcome: 'failed', reps: 16, goalTarget: 20, goalId });
    expect((await summary('pushups')).today).toMatchObject({ achieved: 0, failed: 1, totalReps: 16 });
    // Une séance libre ne peut pas devenir une tentative par correction
    const free = await log(NOW, pushups('5'), '2026-03-11T09:00:00Z');
    expect(await editSession(t.db, free.session.id, { session: pushups('5'), performedAt: at('2026-03-11T09:00:00Z'), outcome: 'failed' }, opts(NOW))).toEqual({
      ok: false,
      code: 'invalid_outcome',
    });
    // Activité immuable
    expect(await editSession(t.db, free.session.id, { session: walk('20'), performedAt: at('2026-03-11T09:00:00Z') }, opts(NOW))).toEqual({
      ok: false,
      code: 'invalid_session',
    });
    expect(await editSession(t.db, 'spt_nope', { session: pushups('5'), performedAt: at(NOW) }, opts(NOW))).toEqual({ ok: false, code: 'not_found' });
  });

  test('8. annulation : séance et audit conservés, totaux et records recalculés, aucune preuve', async () => {
    const goalId = (await setGoal('pushups', 'reps', 20)).goal!.id;
    const a = await log(NOW, pushups('22'), '2026-03-11T08:00:00Z', { outcome: 'achieved', goalId });
    await log(NOW, pushups('14'), '2026-03-11T09:00:00Z');
    expect((await summary('pushups')).records.reps?.value).toBe(22);
    expect((await listSportEvidence(t.db)).filter((e) => e.countsAsSuccess)).toHaveLength(1);

    expect(await cancelSession(t.db, a.session.id, opts(NOW))).toEqual({ ok: true });
    expect(await cancelSession(t.db, a.session.id, opts(NOW))).toEqual({ ok: false, code: 'already_cancelled' });
    expect(await cancelSession(t.db, 'spt_nope', opts(NOW))).toEqual({ ok: false, code: 'not_found' });

    const s = await summary('pushups');
    expect(s.records.reps?.value).toBe(14);
    expect(s.today).toMatchObject({ count: 1, totalReps: 14, achieved: 0 });
    expect(await count('sport_sessions')).toBe(2); // jamais d'effacement silencieux
    const audit = await getSessionAudit(t.db, a.session.id);
    expect(audit.map((k) => k.kind)).toEqual(['cancel']);
    expect(audit[0].before).toMatchObject({ reps: 22, outcome: 'achieved' });
    expect((await listSportEvidence(t.db)).filter((e) => e.countsAsSuccess)).toHaveLength(0);
    expect((await listDaySessions(t.db, '2026-03-11')).map((x) => x.status)).toEqual(['cancelled', 'active']);
    expect((await listDaySessions(t.db, '2026-03-11', false)).map((x) => x.status)).toEqual(['active']);
    // Une séance annulée ne peut plus être corrigée
    expect(await editSession(t.db, a.session.id, { session: pushups('30'), performedAt: at('2026-03-11T08:00:00Z') }, opts(NOW))).toEqual({ ok: false, code: 'cancelled' });
    const kinds = (await t.db.getAllAsync<{ kind: string }>(`SELECT kind FROM sport_events ORDER BY rowid`)).map((e) => e.kind);
    expect(kinds).toContain('session_cancelled');
  });

  test('9. saisies invalides refusées sans rien écrire', async () => {
    const bad = (session: ValidatedSession, performedAt: Date = at('2026-03-11T10:00:00Z')) =>
      addSession(t.db, { session, performedAt }, opts(NOW));
    expect(await bad({ ...pushups('5'), reps: 1.5 })).toEqual({ ok: false, code: 'invalid_session' });
    expect(await bad({ ...pushups('5'), reps: -1 })).toEqual({ ok: false, code: 'invalid_session' });
    expect(await bad({ ...pushups('5'), reps: Number.NaN })).toEqual({ ok: false, code: 'invalid_session' });
    expect(await bad({ ...pushups('5'), reps: 10_001 })).toEqual({ ok: false, code: 'invalid_session' });
    expect(await bad({ ...pushups('5'), reps: null })).toEqual({ ok: false, code: 'invalid_session' });
    expect(await bad({ ...pushups('5'), durationSec: 60 })).toEqual({ ok: false, code: 'invalid_session' });
    expect(await bad({ ...walk('30'), durationSec: 86_401 })).toEqual({ ok: false, code: 'invalid_session' });
    expect(await bad({ ...walk('30'), distanceM: 2.5 })).toEqual({ ok: false, code: 'invalid_session' });
    expect(await bad({ ...walk('30'), durationSec: null })).toEqual({ ok: false, code: 'invalid_session' });
    expect(await bad({ ...pushups('5'), activityId: 'swim' as SportActivityId })).toEqual({ ok: false, code: 'invalid_session' });
    expect(await bad({ ...pushups('5'), note: 'x'.repeat(201) })).toEqual({ ok: false, code: 'invalid_session' });
    expect(await bad(pushups('5'), at('2026-03-11T13:00:00Z'))).toEqual({ ok: false, code: 'future_time' });
    expect(await bad(pushups('5'), new Date('nope'))).toEqual({ ok: false, code: 'invalid_time' });
    expect(await bad(pushups('5'), at('1999-01-01T00:00:00Z'))).toEqual({ ok: false, code: 'invalid_time' });
    expect(await count('sport_sessions')).toBe(0);
    expect(await count('sport_events')).toBe(0);
    expect(await setSportGoal(t.db, { activityId: 'pushups', metric: 'reps', target: 0 }, opts(NOW))).toEqual({ ok: false, code: 'invalid_goal' });
    expect(await setSportGoal(t.db, { activityId: 'pushups', metric: 'reps', target: 2.5 }, opts(NOW))).toEqual({ ok: false, code: 'invalid_goal' });
    expect(await setSportGoal(t.db, { activityId: 'pushups', metric: 'reps', target: 10_001 }, opts(NOW))).toEqual({ ok: false, code: 'invalid_goal' });
    expect(await count('sport_goals')).toBe(0);
  });

  test('9. contraintes SQL : la base refuse les valeurs et classements incohérents', async () => {
    const ins = (cols: string, vals: string) =>
      t.db.runAsync(`INSERT INTO sport_sessions (id, activity_id, performed_at, local_date, ${cols}, created_at, updated_at) VALUES ('x', 'pushups', 'x', '2026-03-11', ${vals}, 'x', 'x')`);
    await expect(ins('reps', '-1')).rejects.toThrow();
    await expect(ins('duration_sec', '-5')).rejects.toThrow();
    await expect(ins('note', `'sans mesure'`)).rejects.toThrow();
    await expect(ins('reps, outcome', `5, 'failed'`)).rejects.toThrow(); // échec sans objectif
    await expect(ins('reps, outcome', `5, 'banana'`)).rejects.toThrow();
    await expect(
      t.db.runAsync(`INSERT INTO sport_sessions (id, activity_id, performed_at, local_date, reps, created_at, updated_at) VALUES ('y', 'swim', 'x', 'd', 5, 'x', 'x')`),
    ).rejects.toThrow(); // clé étrangère
    await expect(
      t.db.runAsync(`INSERT INTO sport_goals (id, activity_id, metric, target_value, effective_from, source, created_at) VALUES ('g', 'pushups', 'reps', 0, 'd', 'manual', 'x')`),
    ).rejects.toThrow();
    expect(await count('sport_sessions')).toBe(0);
  });

  test('10. anti-double enregistrement : même identifiant de demande, séquentiel et simultané', async () => {
    const first = await log(NOW, pushups('16'), '2026-03-11T10:00:00Z', { requestId: 'req-1' });
    const second = await log(NOW, pushups('16'), '2026-03-11T10:00:00Z', { requestId: 'req-1' });
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.session.id).toBe(first.session.id);
    expect(second.newRecords).toEqual([]);

    const input = { session: pushups('12'), performedAt: at('2026-03-11T10:30:00Z'), clientRequestId: 'req-2' };
    const [x, y, z] = await Promise.all([
      addSession(t.db, input, opts(NOW)),
      addSession(t.db, input, opts(NOW)),
      addSession(t.db, input, opts(NOW)),
    ]);
    expect(x.ok && y.ok && z.ok).toBe(true);
    if (x.ok && y.ok && z.ok) expect([x.duplicate, y.duplicate, z.duplicate].sort()).toEqual([false, true, true]);
    expect(await count('sport_sessions')).toBe(2);
    expect((await t.db.getAllAsync(`SELECT id FROM sport_events WHERE kind = 'session_logged'`)).length).toBe(2);
    // Deux séances identiques volontaires (identifiants distincts) restent possibles
    await log(NOW, pushups('12'), '2026-03-11T10:30:00Z', { requestId: 'req-3' });
    await log(NOW, pushups('12'), '2026-03-11T10:30:00Z', { requestId: 'req-4' });
    expect(await count('sport_sessions')).toBe(4);
    // Sans identifiant : aucune déduplication implicite
    await log(NOW, pushups('12'), '2026-03-11T10:30:00Z');
    expect(await count('sport_sessions')).toBe(5);
  });

  test('11. suggestion : calculée sur les tentatives, jamais appliquée seule, acceptation tracée, refus silencieux', async () => {
    const goalId = (await setGoal('pushups', 'reps', 20, '2026-03-01T12:00:00.000Z')).goal!.id;
    const days = ['2026-03-05', '2026-03-06', '2026-03-07'];
    for (const [i, d] of days.entries()) {
      await log(`${d}T20:00:00.000Z`, pushups(String(15 + i)), `${d}T18:00:00Z`, { outcome: 'failed', goalId });
    }
    const NOW2 = '2026-03-08T10:00:00.000Z';
    let s = await summary('pushups', NOW2);
    expect(s.suggestion).toMatchObject({ direction: 'lower', currentTarget: 20, proposedTarget: 18 });
    // Aucune application automatique
    expect(await count('sport_goals')).toBe(1);
    expect(s.goal).toMatchObject({ target: 20, source: 'manual' });

    // Valeur périmée refusée ; acceptation = nouvelle version, raison conservée
    expect(await acceptSportSuggestion(t.db, 'pushups', 19, opts(NOW2))).toEqual({ ok: false, code: 'stale_suggestion' });
    const acc = await acceptSportSuggestion(t.db, 'pushups', 18, opts(NOW2));
    expect(acc).toMatchObject({ ok: true, changed: true });
    s = await summary('pushups', NOW2);
    expect(s.goal).toMatchObject({ target: 18, source: 'suggestion' });
    expect(s.goal?.reason).toMatch(/dernières tentatives/);
    expect(s.suggestion).toBeNull(); // les tentatives antérieures sont liées à l'ancienne version d'objectif
    // Les tentatives passées gardent leur cible d'alors
    const old = await t.db.getAllAsync<{ goal_target: number; outcome: string }>(`SELECT goal_target, outcome FROM sport_sessions ORDER BY rowid`);
    expect(old.every((r) => r.goal_target === 20 && r.outcome === 'failed')).toBe(true);
  });

  test('11. refus : objectif inchangé, silence jusqu\'à deux nouvelles tentatives ; hausse après 4 réussites seulement', async () => {
    const goalId = (await setGoal('pushups', 'reps', 20, '2026-03-01T12:00:00.000Z')).goal!.id;
    for (const [i, d] of ['2026-03-02', '2026-03-03', '2026-03-04'].entries()) {
      await log(`${d}T20:00:00.000Z`, pushups(String(15 + i)), `${d}T18:00:00Z`, { outcome: 'failed', goalId });
    }
    const NOW2 = '2026-03-05T10:00:00.000Z';
    expect((await summary('pushups', NOW2)).suggestion).not.toBeNull();
    await dismissSportSuggestion(t.db, 'pushups', opts(NOW2));
    expect((await summary('pushups', NOW2)).suggestion).toBeNull();
    expect(await count('sport_goals')).toBe(1);
    await log('2026-03-06T10:00:00.000Z', pushups('16'), '2026-03-06T09:00:00Z', { outcome: 'failed', goalId });
    expect((await summary('pushups', '2026-03-06T11:00:00.000Z')).suggestion).toBeNull();
    await log('2026-03-07T10:00:00.000Z', pushups('17'), '2026-03-07T09:00:00Z', { outcome: 'failed', goalId });
    expect((await summary('pushups', '2026-03-07T11:00:00.000Z')).suggestion).toMatchObject({ direction: 'lower' });

    // Hausse : jamais après une seule réussite, ni 3 ; seulement après 4 sur 3 jours
    const g2 = (await setGoal('walking', 'duration_sec', 1200, '2026-03-01T12:00:00.000Z')).goal!.id;
    const dates = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05'];
    for (const [i, d] of dates.entries()) {
      await log(`${d}T20:00:00.000Z`, walk('21'), `${d}T18:00:00Z`, { outcome: 'achieved', goalId: g2 });
      const s = await summary('walking', `${d}T21:00:00.000Z`);
      if (i < 3) expect(s.suggestion).toBeNull();
      else expect(s.suggestion).toMatchObject({ direction: 'raise', proposedTarget: 1320 });
    }
    expect(await count('sport_goals')).toBe(2);
  });

  test('12. historique des objectifs : versions successives, retrait, date et raison conservées', async () => {
    const g1 = await setGoal('pushups', 'reps', 20, '2026-03-02T10:00:00.000Z');
    expect(await setSportGoal(t.db, { activityId: 'pushups', metric: 'reps', target: 20 }, opts('2026-03-02T11:00:00.000Z'))).toMatchObject({ ok: true, changed: false });
    await log('2026-03-03T10:00:00.000Z', pushups('16'), '2026-03-03T09:00:00Z', { outcome: 'failed', goalId: g1.goal!.id });
    const g2 = await setGoal('pushups', 'reps', 25, '2026-03-09T10:00:00.000Z');
    await setGoal('pushups', 'reps', null, '2026-03-10T10:00:00.000Z');
    expect(await setSportGoal(t.db, { activityId: 'pushups', metric: 'reps', target: null }, opts('2026-03-10T11:00:00.000Z'))).toMatchObject({ ok: true, changed: false });

    const hist = await getSportGoalHistory(t.db, 'pushups');
    expect(hist.map((h) => [h.targetValue, h.source, h.effectiveFrom])).toEqual([
      [20, 'manual', '2026-03-02'],
      [25, 'manual', '2026-03-09'],
      [null, 'manual', '2026-03-10'],
    ]);
    expect(hist[2].reason).toBe('Objectif retiré');
    expect(g2.goal?.id).toBe(hist[1].id);
    expect((await summary('pushups', '2026-03-10T12:00:00.000Z')).goal).toBeNull();
    // La séance d'alors garde l'objectif d'alors
    const s = await t.db.getFirstAsync<{ goal_id: string; goal_target: number }>(`SELECT goal_id, goal_target FROM sport_sessions`);
    expect(s).toMatchObject({ goal_id: hist[0].id, goal_target: 20 });
    // Après retrait, plus de tentative possible
    expect(await addSession(t.db, { session: pushups('20'), performedAt: at('2026-03-10T09:00:00Z'), outcome: 'achieved', goalId: hist[1].id }, opts('2026-03-10T12:00:00.000Z'))).toEqual({ ok: false, code: 'no_goal' });
    const events = (await t.db.getAllAsync<{ kind: string }>(`SELECT kind FROM sport_events WHERE kind = 'goal_set'`)).length;
    expect(events).toBe(3);
  });

  test('habitudes Sport personnalisées : rattachement explicite, sans modifier l\'habitude', async () => {
    await t.db.execAsync(`
      INSERT INTO goal_definitions (id, title, kind, unit, weight, status, template_id, sensitive, follow_without_xp, created_at, category_id)
        VALUES ('g_push', 'Pompes du matin', 'quantity', 'pompes', 1, 'active', NULL, 0, 0, '2026-01-01T00:00:00.000Z', 'sport'),
               ('g_gen', 'Sport ou mouvement', 'duration', 'min', 1, 'active', 'sport_minutes', 0, 0, '2026-01-01T00:00:00.000Z', 'sport'),
               ('g_other', 'Lire', 'duration', 'min', 1, 'active', NULL, 0, 0, '2026-01-01T00:00:00.000Z', 'personnel');
      INSERT INTO goal_versions (id, goal_id, version, tier, target_value, schedule_kind, weekly_target_count, notes, effective_from, effective_to)
        VALUES ('gv1', 'g_push', 1, 'normal', 30, 'daily', NULL, NULL, '2026-01-01', NULL),
               ('gv2', 'g_gen', 1, 'normal', 30, 'daily', NULL, NULL, '2026-01-01', NULL),
               ('gv3', 'g_other', 1, 'normal', 30, 'daily', NULL, NULL, '2026-01-01', NULL);
    `);
    const legacyBefore = await rewardSnapshot();
    const goalsBefore = await t.db.getAllAsync(`SELECT * FROM goal_definitions ORDER BY id`);
    let d = await getSportDashboard(t.db, opts(NOW));
    expect(d.habitLinks.map((l) => [l.goalId, l.match?.activityId ?? null, l.adopted, l.ambiguous])).toEqual([
      ['g_push', 'pushups', false, false],
      ['g_gen', null, false, false],
    ]);
    expect(await adoptHabitGoal(t.db, 'g_gen', opts(NOW))).toEqual({ ok: false, code: 'not_compatible' });
    expect(await adoptHabitGoal(t.db, 'g_other', opts(NOW))).toEqual({ ok: false, code: 'not_found' });
    expect(await adoptHabitGoal(t.db, 'g_push', opts(NOW))).toMatchObject({ ok: true, changed: true, activityId: 'pushups' });
    expect(await adoptHabitGoal(t.db, 'g_push', opts(NOW))).toMatchObject({ ok: true, changed: false });
    d = await getSportDashboard(t.db, opts(NOW));
    expect(d.activities[0].goal).toMatchObject({ target: 30, source: 'habit', legacyGoalId: 'g_push' });
    expect(d.habitLinks[0].adopted).toBe(true);
    expect(await t.db.getAllAsync(`SELECT * FROM goal_definitions ORDER BY id`)).toEqual(goalsBefore);
    expect(await rewardSnapshot()).toEqual(legacyBefore);

    // Deux habitudes pour la même activité : ambiguïté, aucun rattachement
    await t.db.execAsync(`
      INSERT INTO goal_definitions (id, title, kind, unit, weight, status, template_id, sensitive, follow_without_xp, created_at, category_id)
        VALUES ('g_push2', 'Pompes du soir', 'quantity', 'pompes', 1, 'active', NULL, 0, 0, '2026-01-02T00:00:00.000Z', 'sport');
      INSERT INTO goal_versions (id, goal_id, version, tier, target_value, schedule_kind, weekly_target_count, notes, effective_from, effective_to)
        VALUES ('gv4', 'g_push2', 1, 'normal', 20, 'daily', NULL, NULL, '2026-01-01', NULL);
    `);
    expect(await adoptHabitGoal(t.db, 'g_push2', opts(NOW))).toEqual({ ok: false, code: 'ambiguous' });
    expect((await getSportDashboard(t.db, opts(NOW))).habitLinks.filter((l) => l.ambiguous)).toHaveLength(2);
  });

  test('13. migration 013 → 014 : additive, sans perte, idempotente', async () => {
    await t.db.execAsync(`
      DROP TABLE sport_events; DROP TABLE sport_corrections; DROP TABLE sport_sessions;
      DROP TABLE sport_goals; DROP TABLE sport_activities;
      DELETE FROM schema_migrations WHERE version = 14;
    `);
    await t.db.execAsync(`
      INSERT INTO goal_definitions (id, title, kind, unit, weight, status, template_id, sensitive, follow_without_xp, created_at, category_id)
        VALUES ('g_sp', 'Sport ou mouvement', 'duration', 'min', 1, 'active', 'sport_minutes', 0, 0, '2026-01-01T00:00:00.000Z', 'sport');
      INSERT INTO goal_versions (id, goal_id, version, tier, target_value, schedule_kind, weekly_target_count, notes, effective_from, effective_to)
        VALUES ('gv_sp', 'g_sp', 1, 'normal', 30, 'daily', NULL, NULL, '2026-01-01', NULL);
      INSERT INTO tracking_events (id, goal_id, local_date, status, value, note, created_at, updated_at)
        VALUES ('te_sp', 'g_sp', '2026-03-11', 'success', 35, NULL, '2026-03-11T09:00:00.000Z', '2026-03-11T09:00:00.000Z');
      INSERT INTO xp_ledger (id, source_event_id, source_rule_version, xp_amount, reason, idempotency_key, local_date, created_at)
        VALUES ('x1', 'te_sp', '0.2.0', 4, 'test', 'k1', '2026-03-11', '2026-03-11T09:00:00.000Z');
      INSERT INTO wallet_ledger (id, resource, amount, reason, idempotency_key, created_at)
        VALUES ('w1', 'gold', 15, 'quête', 'quest:x:reward', '2026-03-11T09:00:00.000Z');
      INSERT INTO challenge_sessions (id, type, state, started_utc, ended_utc, target_duration_sec, duration_sec, user_confirmed, user_confirmed_duration_sec, created_at, updated_at)
        VALUES ('cs1', 'sport', 'completed', '2026-03-11T08:00:00.000Z', '2026-03-11T08:30:00.000Z', 1800, 1800, 1, 1800, '2026-03-11T08:00:00.000Z', '2026-03-11T08:30:00.000Z');
      INSERT INTO alcohol_consumptions (id, drink_type, volume_ml_x10, abv_x10, quantity_x100, alcohol_mg, consumed_at, local_date, status, created_at, updated_at)
        VALUES ('alc1', 'beer', 2500, 50, 100, 9863, '2026-03-11T10:00:00.000Z', '2026-03-11', 'active', 'x', 'x');
      INSERT INTO vape_main_sessions (id, status, started_at, created_at, updated_at)
        VALUES ('vms_old', 'active', '2026-03-10T10:00:00.000Z', '2026-03-10T10:00:00.000Z', '2026-03-10T10:00:00.000Z');
    `);
    const dump = async () => ({
      goals: await t.db.getAllAsync(`SELECT * FROM goal_definitions ORDER BY id`),
      versions: await t.db.getAllAsync(`SELECT * FROM goal_versions ORDER BY id`),
      tracking: await t.db.getAllAsync(`SELECT * FROM tracking_events ORDER BY id`),
      xp: await t.db.getAllAsync(`SELECT * FROM xp_ledger ORDER BY id`),
      wallet: await t.db.getAllAsync(`SELECT * FROM wallet_ledger ORDER BY id`),
      challenges: await t.db.getAllAsync(`SELECT * FROM challenge_sessions ORDER BY id`),
      alcohol: await t.db.getAllAsync(`SELECT * FROM alcohol_consumptions ORDER BY id`),
      vape: await t.db.getAllAsync(`SELECT * FROM vape_main_sessions ORDER BY id`),
      migrations: (await t.db.getAllAsync<{ version: number }>(`SELECT version FROM schema_migrations ORDER BY version`)).filter((r) => r.version <= 13),
    });
    const before = await dump();
    await migrate(t.db);
    await migrate(t.db);
    expect(await dump()).toEqual(before);

    const versions = (await t.db.getAllAsync<{ version: number }>(`SELECT version FROM schema_migrations ORDER BY version`)).map((r) => r.version);
    expect(versions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
    const names = (await t.db.getAllAsync<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'sport_%' ORDER BY name`)).map((r) => r.name);
    expect(names).toEqual(['sport_activities', 'sport_corrections', 'sport_events', 'sport_goals', 'sport_sessions']);
    expect((await t.db.getAllAsync<{ id: string }>(`SELECT id FROM sport_activities ORDER BY sort_order`)).map((r) => r.id)).toEqual([
      'pushups',
      'walking',
      'running',
      'free',
    ]);
    // Les nouvelles tables sont utilisables immédiatement, et le suivi sport historique reste lisible
    await log(NOW, pushups('16'), '2026-03-11T10:00:00Z');
    expect((await summary('pushups')).today.totalReps).toBe(16);
    expect(await t.db.getAllAsync(`SELECT * FROM challenge_sessions ORDER BY id`)).toEqual(before.challenges);
  });

  const fullScenario = async () => {
    const goalId = (await setGoal('pushups', 'reps', 20, '2026-03-01T12:00:00.000Z')).goal!.id;
    const a = await log(NOW, pushups('16'), '2026-03-10T10:00:00Z', { outcome: 'failed', goalId, requestId: 'req-a' });
    await log(NOW, pushups('21'), '2026-03-11T08:00:00Z', { outcome: 'achieved', goalId });
    await log(NOW, walk('45', '3,2'), '2026-03-11T09:00:00Z');
    await log(NOW, form('free', { freeMetric: 'duration', durationMin: '30', disciplineName: 'Yoga' }), '2026-03-11T10:00:00Z');
    const c = await log(NOW, run('20', '3'), '2026-03-11T10:30:00Z');
    await cancelSession(t.db, c.session.id, opts(NOW));
    await editSession(t.db, a.session.id, { session: pushups('17'), performedAt: at('2026-03-10T10:00:00Z') }, opts(NOW));
    await setGoal('walking', 'distance_m', 3000);
    return a;
  };

  test('14. export / import : séances, objectifs, corrections et événements restaurés à l\'identique', async () => {
    const a = await fullScenario();
    const expected = await getSportDashboard(t.db, opts(NOW));
    const exported = await exportBackupPayload(t.db, '0.2.0');
    const json = JSON.parse(JSON.stringify(exported)) as typeof exported;
    const tables = ['sport_activities', 'sport_goals', 'sport_sessions', 'sport_corrections', 'sport_events'];
    for (const tbl of tables) {
      expect((json.manifest.tables as string[]).includes(tbl)).toBe(true);
      expect(json.data[tbl].length).toBeGreaterThan(0);
    }

    const target = await openNodeSqliteDb();
    try {
      await addSession(target.db, { session: pushups('99'), performedAt: at('2026-03-11T09:00:00Z') }, opts(NOW));
      await importBackupPayload(target.db, json.manifest, json.data);
      expect(await getSportDashboard(target.db, opts(NOW))).toEqual(expected);
      for (const tbl of tables) {
        expect(await target.db.getAllAsync(`SELECT * FROM ${tbl} ORDER BY id`)).toEqual(await t.db.getAllAsync(`SELECT * FROM ${tbl} ORDER BY id`));
      }
      const audit = await getSessionAudit(target.db, a.session.id);
      expect(audit).toHaveLength(1);
      expect(audit[0].before).toMatchObject({ reps: 16 });
      expect(await listSportEvidence(target.db)).toEqual(await listSportEvidence(t.db));
    } finally {
      target.close();
    }
  });

  test('14. sauvegarde antérieure (sans tables sport) : import accepté, journal vide, activités présentes', async () => {
    await log(NOW, pushups('16'), '2026-03-11T10:00:00Z');
    const exported = await exportBackupPayload(t.db, '0.2.0');
    const old = { ...exported.data };
    for (const k of Object.keys(old)) if (k.startsWith('sport_')) delete old[k];
    await importBackupPayload(t.db, exported.manifest, old);
    expect(await count('sport_sessions')).toBe(0);
    expect(await count('sport_goals')).toBe(0);
    expect(await count('sport_activities')).toBe(4);
    const d = await getSportDashboard(t.db, opts(NOW));
    expect(d.activities.every((s) => s.today.count === 0)).toBe(true);
    await log(NOW, pushups('12'), '2026-03-11T10:00:00Z');
    expect((await summary('pushups')).today.totalReps).toBe(12);
  });

  test('15. aucun XP, or, quête ni habitude modifiés par le journal Sport (échecs, annulations, corrections compris)', async () => {
    await t.db.execAsync(`
      INSERT INTO goal_definitions (id, title, kind, unit, weight, status, template_id, sensitive, follow_without_xp, created_at, category_id)
        VALUES ('g_sp', 'Sport ou mouvement', 'duration', 'min', 1, 'active', 'sport_minutes', 0, 0, '2026-01-01T00:00:00.000Z', 'sport');
      INSERT INTO goal_versions (id, goal_id, version, tier, target_value, schedule_kind, weekly_target_count, notes, effective_from, effective_to)
        VALUES ('gv_sp', 'g_sp', 1, 'normal', 30, 'daily', NULL, NULL, '2026-01-01', NULL);
      INSERT INTO tracking_events (id, goal_id, local_date, status, value, note, created_at, updated_at)
        VALUES ('te_sp', 'g_sp', '2026-03-11', 'success', 35, NULL, '2026-03-11T09:00:00.000Z', '2026-03-11T09:00:00.000Z');
      INSERT INTO xp_ledger (id, source_event_id, source_rule_version, xp_amount, reason, idempotency_key, local_date, created_at)
        VALUES ('x1', 'te_sp', '0.2.0', 4, 'test', 'k1', '2026-03-11', '2026-03-11T09:00:00.000Z');
      INSERT INTO wallet_ledger (id, resource, amount, reason, idempotency_key, created_at)
        VALUES ('w1', 'gold', 15, 'quête', 'quest:x:reward', '2026-03-11T09:00:00.000Z');
      INSERT INTO challenge_sessions (id, type, state, started_utc, ended_utc, target_duration_sec, duration_sec, user_confirmed, user_confirmed_duration_sec, created_at, updated_at)
        VALUES ('cs1', 'sport', 'completed', '2026-03-11T08:00:00.000Z', '2026-03-11T08:30:00.000Z', 1800, 1800, 1, 1800, '2026-03-11T08:00:00.000Z', '2026-03-11T08:30:00.000Z');
    `);
    const before = await rewardSnapshot();
    const allBefore = {
      tracking: await t.db.getAllAsync(`SELECT * FROM tracking_events`),
      challenges: await t.db.getAllAsync(`SELECT * FROM challenge_sessions`),
      xp: await t.db.getAllAsync(`SELECT * FROM xp_ledger`),
      wallet: await t.db.getAllAsync(`SELECT * FROM wallet_ledger`),
    };
    await fullScenario();
    await getSportDashboard(t.db, opts(NOW));
    await listSportEvidence(t.db);
    expect(await rewardSnapshot()).toEqual(before);
    expect({
      tracking: await t.db.getAllAsync(`SELECT * FROM tracking_events`),
      challenges: await t.db.getAllAsync(`SELECT * FROM challenge_sessions`),
      xp: await t.db.getAllAsync(`SELECT * FROM xp_ledger`),
      wallet: await t.db.getAllAsync(`SELECT * FROM wallet_ledger`),
    }).toEqual(allBefore);
  });

  test('16. non-régression Vape et Alcool : journaux indépendants', async () => {
    const start = await startVapeMainSession(t.db, at('2026-03-11T08:00:00Z'));
    expect(start.ok).toBe(true);
    const drink = validateDrinkForm({ type: 'beer', name: '', volumeMl: '250', abvPct: '5', quantity: '1' });
    if (!drink.ok) throw new Error('boisson');
    await addConsumption(t.db, { drink: drink.value, consumedAt: at('2026-03-11T10:00:00Z') }, opts(NOW));
    const vapeTables = ['vape_main_sessions', 'vape_main_claims', 'vape_events', 'adaptive_challenge_attempts'];
    const alcoholTables = ['alcohol_consumptions', 'alcohol_corrections', 'alcohol_zero_days', 'alcohol_weekly_goals', 'alcohol_events'];
    const snap = async () => ({
      vape: await Promise.all(vapeTables.map((n) => t.db.getAllAsync(`SELECT * FROM ${n}`))),
      alcohol: await Promise.all(alcoholTables.map((n) => t.db.getAllAsync(`SELECT * FROM ${n}`))),
    });
    const before = await snap();
    await fullScenario();
    expect(await snap()).toEqual(before);

    expect((await getAlcoholDashboard(t.db, opts(NOW))).todayMg).toBe(9863);
    const vape = await getVapeTrackerDashboard(t.db, at('2026-03-11T11:00:00Z'));
    expect(vape.active?.elapsedSec).toBe(3 * 3600);
    expect(await declareVape(t.db, { now: at('2026-03-11T11:00:00Z') })).toMatchObject({ ok: true, durationSec: 3 * 3600 });
  });

  test('progression : tendance sur séances récentes, activité principale = dernière utilisée', async () => {
    for (const [i, reps] of [10, 11, 12, 16, 18, 20].entries()) {
      await log(NOW, pushups(String(reps)), `2026-03-0${i + 1}T10:00:00Z`);
    }
    const p = await summary('pushups');
    expect(p.trend).toBe('up');
    expect(p.recent.map((s) => s.reps)).toEqual([20, 18, 16, 12, 11]);
    expect((await getSportDashboard(t.db, opts(NOW))).mainActivityId).toBe('pushups');
    await log(NOW, walk('20'), '2026-03-11T09:00:00Z');
    const d = await getSportDashboard(t.db, opts(NOW));
    expect(d.mainActivityId).toBe('walking');
    expect(d.recentSessions[0].activityId).toBe('walking');
    expect((await summary('walking')).trend).toBeNull();
  });

  test('journées : fuseau et début de journée lus depuis le profil par défaut', async () => {
    await t.db.runAsync(
      `INSERT INTO profiles (id, pseudo, class_id, tone, day_start_hour, timezone, created_at, onboarding_done)
       VALUES ('p1', 'Test', 'rodeur', 'fantasy', 6, 'Europe/Paris', '2026-01-01T00:00:00.000Z', 1)`,
    );
    const r = await addSession(t.db, { session: pushups('10'), performedAt: at('2026-03-11T04:30:00Z') }, { now: at(NOW) });
    expect(r.ok && r.session.localDate).toBe('2026-03-10'); // 05:30 Paris, avant 6 h
    const d = await getSportDashboard(t.db, { now: at(NOW) });
    expect(d).toMatchObject({ dayStartHour: 6, timeZone: 'Europe/Paris', today: '2026-03-11' });
    expect(d.activities[0].today.count).toBe(0);
    expect(d.activities[0].week.totalReps).toBe(10);
  });
});
