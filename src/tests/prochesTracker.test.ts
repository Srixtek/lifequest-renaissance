jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: '/tmp/',
  documentDirectory: '/tmp/',
  EncodingType: { Base64: 'base64' },
  writeAsStringAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
}));

import { migrate } from '../data/db/client';
import {
  DEFAULT_WEEKLY_CALL_TARGET,
  parseContactName,
  parseWeeklyCallTarget,
  weekBounds,
} from '../domain/rules/proches';
import {
  addCall,
  addContact,
  archiveContact,
  cancelCall,
  editCall,
  getProchesDashboard,
  getWeeklyGoalHistory,
  listCallCorrections,
  listDayCalls,
  listContacts,
  listProchesEvidence,
  setWeeklyCallGoal,
  updateContactName,
  type ProchesOpts,
} from '../domain/services/prochesTrackerService';
import { exportBackupPayload, importBackupPayload } from '../domain/services/backupService';
import {
  addConsumption,
  getAlcoholDashboard,
} from '../domain/services/alcoholTrackerService';
import { addSession, getSportDashboard } from '../domain/services/sportTrackerService';
import { declareVape, getVapeTrackerDashboard, startVapeMainSession } from '../domain/services/vapeTrackerService';
import { validateDrinkForm } from '../domain/rules/alcohol';
import { validateSessionForm } from '../domain/rules/sport';
import { nodeSqliteAvailable, openNodeSqliteDb, type TestDb } from './helpers/nodeSqliteDb';

const suite = nodeSqliteAvailable() ? describe : describe.skip;
const TZ = 'Europe/Paris';
const at = (iso: string) => new Date(iso);
const opts = (nowIso: string): ProchesOpts => ({ timeZone: TZ, dayStartHour: 4, now: at(nowIso) });
const NOW = '2026-03-11T12:00:00.000Z';

suite('V1-03B — journal Proches', () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await openNodeSqliteDb();
  });
  afterEach(() => t.close());

  const addPerson = async (name: string) => {
    const r = await addContact(t.db, { name, relation: 'family' }, opts(NOW));
    if (!r.ok) throw new Error('contact');
    return r.contact;
  };

  const logCall = async (contactId: string, iso: string, extra: { requestId?: string; note?: string } = {}) => {
    return addCall(t.db, { contactId, calledAt: at(iso), clientRequestId: extra.requestId, note: extra.note }, opts(NOW));
  };

  const count = (tbl: string) =>
    t.db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${tbl}`).then((r) => Number(r?.n ?? 0));

  test('1. ajout proche : nom obligatoire, relation facultative', async () => {
    expect(parseContactName('  ').ok).toBe(false);
    const r = await addContact(t.db, { name: 'Maman', relation: 'family' }, opts(NOW));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.contact.name).toBe('Maman');
    expect(await count('proches_contacts')).toBe(1);
  });

  test('2. modification nom + archivage sans effacer appels', async () => {
    const c = await addPerson('Papa');
    const call = await logCall(c.id, '2026-03-11T10:00:00Z');
    expect(call.ok).toBe(true);
    const renamed = await updateContactName(t.db, c.id, 'Père', opts(NOW));
    expect(renamed.ok).toBe(true);
  await archiveContact(t.db, c.id, opts(NOW));
    const day = await listDayCalls(t.db, '2026-03-11', true);
    expect(day).toHaveLength(1);
    expect(day[0].contactName).toBe('Père');
    expect(day[0].contactArchived).toBe(true);
  });

  test('3. enregistrer appel avec date/heure', async () => {
    const c = await addPerson('Julie');
    const r = await logCall(c.id, '2026-03-10T15:30:00Z', { note: 'Nouvelles' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.call.localDate).toBe('2026-03-10');
      expect(r.call.note).toBe('Nouvelles');
    }
  });

  test('4. plusieurs appels même jour même personne', async () => {
    const c = await addPerson('Marc');
    await logCall(c.id, '2026-03-11T08:00:00Z');
    await logCall(c.id, '2026-03-11T10:00:00Z');
    const day = await listDayCalls(t.db, '2026-03-11');
    expect(day).toHaveLength(2);
  });

  test('5. double clic : client_request_id idempotent', async () => {
    const c = await addPerson('Léa');
    const a = await logCall(c.id, '2026-03-11T10:00:00Z', { requestId: 'req-1' });
    const b = await logCall(c.id, '2026-03-11T10:00:00Z', { requestId: 'req-1' });
    expect(a.ok && b.ok && a.call.id).toBe(b.ok && b.call.id);
    expect(b.ok && b.duplicate).toBe(true);
    expect(await count('proches_calls')).toBe(1);
  });

  test('6. objectif 1–7, défaut 2', async () => {
    expect(parseWeeklyCallTarget('2')).toEqual({ ok: true, value: 2 });
    expect(parseWeeklyCallTarget('0').ok).toBe(false);
    expect(parseWeeklyCallTarget('8').ok).toBe(false);
    const d = await getProchesDashboard(t.db, opts(NOW));
    expect(d.weekTarget).toBe(DEFAULT_WEEKLY_CALL_TARGET);
    expect(d.weekTargetSource).toBe('default');
  });

  test('7. modifier objectif : versionné append-only', async () => {
    await getProchesDashboard(t.db, opts(NOW));
    const { start } = weekBounds('2026-03-11');
    await setWeeklyCallGoal(t.db, 4, opts(NOW));
    await setWeeklyCallGoal(t.db, 4, opts(NOW));
    const hist = await getWeeklyGoalHistory(t.db);
    const forWeek = hist.filter((h) => h.effectiveFrom === start);
    expect(forWeek.length).toBeGreaterThanOrEqual(1);
    expect(forWeek[0].targetCount).toBe(4);
    expect(await count('proches_weekly_goals')).toBeGreaterThanOrEqual(2);
  });

  test('8. calendrier et totaux semaine', async () => {
    const c = await addPerson('Sam');
    await logCall(c.id, '2026-03-09T10:00:00Z');
    await logCall(c.id, '2026-03-11T10:00:00Z');
    const d = await getProchesDashboard(t.db, opts(NOW));
    expect(d.weekCallCount).toBe(2);
    expect(d.monthDays.find((x) => x.localDate === '2026-03-11')?.count).toBe(1);
  });

  test('9. correction et annulation avec trace', async () => {
    const c = await addPerson('Noé');
    const logged = await logCall(c.id, '2026-03-11T10:00:00Z');
    if (!logged.ok) throw new Error('call');
    await editCall(t.db, logged.call.id, { calledAt: at('2026-03-11T11:00:00Z'), note: 'Corrigé' }, opts(NOW));
    const audit = await listCallCorrections(t.db, logged.call.id);
    expect(audit.some((a) => a.kind === 'edit')).toBe(true);
    await cancelCall(t.db, logged.call.id, opts(NOW));
    const activeN = await t.db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM proches_calls WHERE status = 'active'`);
    expect(Number(activeN?.n)).toBe(0);
    const cancelled = await listCallCorrections(t.db, logged.call.id);
    expect(cancelled.some((a) => a.kind === 'cancel')).toBe(true);
  });

  test('10. archivage garde historique lisible', async () => {
    const c = await addPerson('Eva');
    await logCall(c.id, '2026-03-08T10:00:00Z');
    await archiveContact(t.db, c.id, opts(NOW));
    const list = await listContacts(t.db, true);
    expect(list.find((x) => x.id === c.id)?.status).toBe('archived');
    expect(await listDayCalls(t.db, '2026-03-08', true)).toHaveLength(1);
  });

  test('11. aucune récompense XP / or sur enregistrement', async () => {
    const snap = async () => ({
      xp: await t.db.getAllAsync(`SELECT * FROM xp_ledger`),
      wallet: await t.db.getAllAsync(`SELECT * FROM wallet_ledger`),
    });
    const before = await snap();
    const c = await addPerson('Test');
    await logCall(c.id, '2026-03-11T10:00:00Z');
    await getProchesDashboard(t.db, opts(NOW));
    expect(await snap()).toEqual(before);
  });

  test('12. call_family intact : tracking_events inchangés', async () => {
    await t.db.execAsync(`
      INSERT INTO goal_definitions (id, title, kind, unit, weight, status, template_id, sensitive, follow_without_xp, created_at, category_id)
        VALUES ('g_call', 'Appeler', 'habit', NULL, 1, 'active', 'call_family', 0, 0, '2026-01-02T00:00:00.000Z', 'proches');
      INSERT INTO goal_versions (id, goal_id, version, tier, target_value, schedule_kind, weekly_target_count, notes, effective_from, effective_to)
        VALUES ('gv_call', 'g_call', 1, 'normal', NULL, 'weekly', 2, NULL, '2026-01-01', NULL);
      INSERT INTO tracking_events (id, goal_id, local_date, status, value, note, created_at, updated_at)
        VALUES ('te_call', 'g_call', '2026-03-11', 'success', 1, NULL, '2026-03-11T09:00:00.000Z', '2026-03-11T09:00:00.000Z');
    `);
    const before = await t.db.getAllAsync(`SELECT * FROM tracking_events WHERE goal_id = 'g_call'`);
    const c = await addPerson('Famille');
    await logCall(c.id, '2026-03-11T10:00:00Z');
    const after = await t.db.getAllAsync(`SELECT * FROM tracking_events WHERE goal_id = 'g_call'`);
    expect(after).toEqual(before);
  });

  test('13. migration 014 → 015 additive', async () => {
    await t.db.execAsync(`
      DROP TABLE IF EXISTS proches_events; DROP TABLE IF EXISTS proches_corrections; DROP TABLE IF EXISTS proches_calls;
      DROP TABLE IF EXISTS proches_weekly_goals; DROP TABLE IF EXISTS proches_contacts;
      DELETE FROM schema_migrations WHERE version = 15;
    `);
    await t.db.execAsync(`
      INSERT INTO sport_sessions (id, activity_id, performed_at, local_date, reps, outcome, status, created_at, updated_at)
        VALUES ('spt_x', 'pushups', '2026-03-11T10:00:00Z', '2026-03-11', 10, 'free', 'active', 'x', 'x');
    `);
    const sportBefore = await t.db.getAllAsync(`SELECT * FROM sport_sessions`);
    await migrate(t.db);
    await migrate(t.db);
    const versions = (await t.db.getAllAsync<{ version: number }>(`SELECT version FROM schema_migrations ORDER BY version`)).map((r) => r.version);
    expect(versions).toContain(15);
    expect(await t.db.getAllAsync(`SELECT * FROM sport_sessions`)).toEqual(sportBefore);
    const tables = (await t.db.getAllAsync<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'proches_%' ORDER BY name`)).map((r) => r.name);
    expect(tables).toEqual(['proches_calls', 'proches_contacts', 'proches_corrections', 'proches_events', 'proches_weekly_goals']);
    const c = await addPerson('Post-mig');
    await logCall(c.id, '2026-03-11T10:00:00Z');
    expect((await getProchesDashboard(t.db, opts(NOW))).weekCallCount).toBe(1);
  });

  test('14. export / import roundtrip', async () => {
    const c = await addPerson('Backup');
    await logCall(c.id, '2026-03-11T10:00:00Z');
    await setWeeklyCallGoal(t.db, 3, opts(NOW));
    const expected = await getProchesDashboard(t.db, opts(NOW));
    const exported = await exportBackupPayload(t.db, '0.2.0');
    const tables = ['proches_contacts', 'proches_calls', 'proches_weekly_goals', 'proches_corrections', 'proches_events'];
    for (const tbl of tables) {
      expect((exported.manifest.tables as string[]).includes(tbl)).toBe(true);
    }
    const target = await openNodeSqliteDb();
    try {
      await importBackupPayload(target.db, exported.manifest, exported.data);
      expect(await getProchesDashboard(target.db, opts(NOW))).toEqual(expected);
      expect(await listProchesEvidence(target.db)).toEqual(await listProchesEvidence(t.db));
    } finally {
      target.close();
    }
  });

  test('15. non-régression Vape, Alcool, Sport', async () => {
    const sport = validateSessionForm({
      activityId: 'pushups',
      reps: '12',
      durationMin: '',
      distanceKm: '',
      freeMetric: 'reps',
      disciplineName: '',
      note: '',
    });
    if (!sport.ok) throw new Error('sport');
    await addSession(t.db, { session: sport.value, performedAt: at('2026-03-11T09:00:00Z') }, { timeZone: TZ, dayStartHour: 4, now: at(NOW) });
    const drink = validateDrinkForm({ type: 'beer', name: '', volumeMl: '250', abvPct: '5', quantity: '1' });
    if (!drink.ok) throw new Error('drink');
    await addConsumption(t.db, { drink: drink.value, consumedAt: at('2026-03-11T10:00:00Z') }, { timeZone: TZ, dayStartHour: 4, now: at(NOW) });
    const vapeStart = await startVapeMainSession(t.db, at('2026-03-11T08:00:00Z'));
    expect(vapeStart.ok).toBe(true);
    const snap = async () => ({
      sport: await getSportDashboard(t.db, { timeZone: TZ, dayStartHour: 4, now: at(NOW) }),
      alcohol: (await getAlcoholDashboard(t.db, { timeZone: TZ, dayStartHour: 4, now: at(NOW) })).todayMg,
      vape: (await getVapeTrackerDashboard(t.db, at('2026-03-11T11:00:00Z'))).active?.elapsedSec,
    });
    const before = await snap();
    const c = await addPerson('Iso');
    await logCall(c.id, '2026-03-11T11:00:00Z');
    expect(await snap()).toEqual(before);
  });

  test('preuves : evidenceKey stable', async () => {
    const c = await addPerson('Preuve');
    const r = await logCall(c.id, '2026-03-11T10:00:00Z');
    if (!r.ok) throw new Error('call');
    const ev = await listProchesEvidence(t.db);
    expect(ev).toHaveLength(1);
    expect(ev[0].evidenceKey).toBe(`proches_call:${r.call.id}`);
  });
});