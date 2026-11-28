jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: '/tmp/',
  documentDirectory: '/tmp/',
  EncodingType: { Base64: 'base64' },
  writeAsStringAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
}));

import { migrate } from '../data/db/client';
import { DIVERS_ACTIVITY_IDS } from '../data/content/diversActivities';
import {
  cancelDiversCompletion,
  confirmDiversActivity,
  diversCatalogSize,
  getDiversDashboard,
  listDiversEvidence,
  passDiversSuggestion,
  replaceDiversSuggestion,
} from '../domain/services/diversTrackerService';
import { exportBackupPayload, importBackupPayload } from '../domain/services/backupService';
import {
  addCall,
  addContact,
  addContactAndCall,
  getProchesDashboard,
} from '../domain/services/prochesTrackerService';
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
const opts = { timeZone: TZ, dayStartHour: 4, now: at('2026-03-11T12:00:00.000Z') };
const DAY = '2026-03-11';

suite('V1-04A — petites activités Divers', () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await openNodeSqliteDb();
  });
  afterEach(() => t.close());

  const count = (tbl: string) =>
    t.db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${tbl}`).then((r) => Number(r?.n ?? 0));

  test('4. catalogue 10–12 activités typées', () => {
    const n = diversCatalogSize();
    expect(n).toBeGreaterThanOrEqual(10);
    expect(n).toBeLessThanOrEqual(12);
    expect(DIVERS_ACTIVITY_IDS.length).toBe(n);
  });

  test('5. suggestions : max 2, persistance après reload', async () => {
    const a = await getDiversDashboard(t.db, opts);
    expect(a.suggestions).toHaveLength(2);
    expect(a.suggestions[0].activityId).not.toBe(a.suggestions[1].activityId);
    const b = await getDiversDashboard(t.db, opts);
    expect(b.suggestions.map((s) => s.activityId)).toEqual(a.suggestions.map((s) => s.activityId));
  });

  test('6. rotation jour suivant ≠ même paire forcée', async () => {
    const day1 = await getDiversDashboard(t.db, opts);
    const nextOpts = { ...opts, now: at('2026-03-12T12:00:00.000Z') };
    const day2 = await getDiversDashboard(t.db, nextOpts);
    const ids1 = day1.suggestions.map((s) => s.activityId).sort().join(',');
    const ids2 = day2.suggestions.map((s) => s.activityId).sort().join(',');
    expect(ids2).not.toBe(ids1);
  });

  test('7. remplacement limité à 1/jour', async () => {
    await getDiversDashboard(t.db, opts);
    const r1 = await replaceDiversSuggestion(t.db, 0, opts);
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.dashboard.replacementsRemaining).toBe(0);
    const r2 = await replaceDiversSuggestion(t.db, 1, opts);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe('limit_reached');
  });

  test('8. passer masque la suggestion sans en créer une autre ni consommer le remplacement', async () => {
    const before = await getDiversDashboard(t.db, opts);
    const id0 = before.suggestions[0].activityId;
    const passed = await passDiversSuggestion(t.db, 0, opts);
    expect(passed.ok).toBe(true);
    if (passed.ok) {
      expect(passed.dashboard.suggestions[0].activityId).toBe(id0);
      expect(passed.dashboard.suggestions[0].passed).toBe(true);
      expect(passed.dashboard.replacementsRemaining).toBe(1);
    }
  });

  test('9. confirm idempotent client_request_id', async () => {
    const dash = await getDiversDashboard(t.db, opts);
    const act = dash.suggestions[0].activityId;
    const a = await confirmDiversActivity(t.db, act, 'creq-1', opts);
    const b = await confirmDiversActivity(t.db, act, 'creq-1', opts);
    expect(a.ok && b.ok && a.completion.id).toBe(b.ok && b.completion.id);
    if (b.ok) expect(b.duplicate).toBe(true);
    expect(await count('divers_completions')).toBe(1);
  });

  test('10. annulation confirmation', async () => {
    const dash = await getDiversDashboard(t.db, opts);
    const act = dash.suggestions[0].activityId;
    const c = await confirmDiversActivity(t.db, act, 'creq-x', opts);
    if (!c.ok) throw new Error('confirm');
    await cancelDiversCompletion(t.db, c.completion.id, opts);
    const active = await t.db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM divers_completions WHERE status = 'active'`,
    );
    expect(Number(active?.n)).toBe(0);
    const ev = await listDiversEvidence(t.db);
    expect(ev).toHaveLength(0);
  });

  test('11. aucune écriture XP / or', async () => {
    const snap = async () => ({
      xp: await t.db.getAllAsync(`SELECT * FROM xp_ledger`),
      wallet: await t.db.getAllAsync(`SELECT * FROM wallet_ledger`),
    });
    const before = await snap();
    const dash = await getDiversDashboard(t.db, opts);
    await confirmDiversActivity(t.db, dash.suggestions[0].activityId, 'creq-y', opts);
    expect(await snap()).toEqual(before);
  });

  test('12. migration 015 → 016 additive', async () => {
    await t.db.execAsync(`
      DROP TABLE IF EXISTS divers_events; DROP TABLE IF EXISTS divers_completions; DROP TABLE IF EXISTS divers_day_slots;
      DELETE FROM schema_migrations WHERE version IN (16, 17);
    `);
    const prochesBefore = await getProchesDashboard(t.db, { timeZone: TZ, dayStartHour: 4, now: at(DAY + 'T12:00:00.000Z') });
    await migrate(t.db);
    await migrate(t.db);
    const versions = (await t.db.getAllAsync<{ version: number }>(`SELECT version FROM schema_migrations ORDER BY version`)).map(
      (r) => r.version,
    );
    expect(versions).toContain(16);
    const prochesAfter = await getProchesDashboard(t.db, { timeZone: TZ, dayStartHour: 4, now: at(DAY + 'T12:00:00.000Z') });
    expect(prochesAfter.weekTarget).toBe(prochesBefore.weekTarget);
    await getDiversDashboard(t.db, opts);
    expect(await count('divers_day_slots')).toBe(1);
  });

  test('13. export / import roundtrip', async () => {
    const dash = await getDiversDashboard(t.db, opts);
    await confirmDiversActivity(t.db, dash.suggestions[0].activityId, 'creq-z', opts);
    const expected = await getDiversDashboard(t.db, opts);
    const exported = await exportBackupPayload(t.db, '0.2.0');
    for (const tbl of ['divers_day_slots', 'divers_completions', 'divers_events']) {
      expect((exported.manifest.tables as string[]).includes(tbl)).toBe(true);
    }
    const target = await openNodeSqliteDb();
    try {
      await importBackupPayload(target.db, exported.manifest, exported.data);
      const imported = await getDiversDashboard(target.db, opts);
      expect(imported.suggestions.map((s) => s.activityId)).toEqual(expected.suggestions.map((s) => s.activityId));
      expect(await listDiversEvidence(target.db)).toEqual(await listDiversEvidence(t.db));
    } finally {
      target.close();
    }
  });

  test('14. non-régression Vape / Alcool / Sport / Proches', async () => {
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
    await addSession(t.db, { session: sport.value, performedAt: at('2026-03-11T09:00:00Z') }, opts);
    const drink = validateDrinkForm({ type: 'beer', name: '', volumeMl: '250', abvPct: '5', quantity: '1' });
    if (!drink.ok) throw new Error('drink');
    await addConsumption(t.db, { drink: drink.value, consumedAt: at('2026-03-11T10:00:00Z') }, opts);
    await startVapeMainSession(t.db, at('2026-03-11T08:00:00Z'));
    const c = await addContact(t.db, { name: 'Proche' }, opts);
    if (!c.ok) throw new Error('contact');
    await addCall(t.db, { contactId: c.contact.id, calledAt: at('2026-03-11T11:00:00Z') }, opts);
    const snap = async () => ({
      sport: await getSportDashboard(t.db, opts),
      alcohol: (await getAlcoholDashboard(t.db, opts)).todayMg,
      vape: (await getVapeTrackerDashboard(t.db, at('2026-03-11T11:00:00Z'))).active?.elapsedSec,
      proches: (await getProchesDashboard(t.db, opts)).weekCallCount,
    });
    const before = await snap();
    await getDiversDashboard(t.db, opts);
    await confirmDiversActivity(t.db, (await getDiversDashboard(t.db, opts)).suggestions[0].activityId, 'creq-nr', opts);
    expect(await snap()).toEqual(before);
  });

  test('preuves evidenceKey stable', async () => {
    const dash = await getDiversDashboard(t.db, opts);
    const r = await confirmDiversActivity(t.db, dash.suggestions[0].activityId, 'creq-ev', opts);
    if (!r.ok) throw new Error('confirm');
    const ev = await listDiversEvidence(t.db);
    expect(ev).toHaveLength(1);
    expect(ev[0].evidenceKey).toBe(`divers_activity:${r.completion.id}`);
  });
});

suite('V1-04A — correctifs Proches (service)', () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await openNodeSqliteDb();
  });
  afterEach(() => t.close());

  const prochesOpts = { timeZone: TZ, dayStartHour: 4, now: at('2026-03-11T12:00:00.000Z') };

  test('A/C. addContactAndCall atomique : échec temps invalide → 0 contact', async () => {
    const r = await addContactAndCall(
      t.db,
      { name: 'Orphelin?', calledAt: at('2099-01-01T10:00:00Z') },
      prochesOpts,
    );
    expect(r.ok).toBe(false);
    const n = await t.db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM proches_contacts`);
    expect(Number(n?.n)).toBe(0);
  });

  test('C. addContactAndCall succès : contact + appel', async () => {
    const r = await addContactAndCall(
      t.db,
      { name: 'Rapide', calledAt: at('2026-03-11T10:00:00Z'), clientRequestId: 'pcq-1' },
      prochesOpts,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.call.contactName).toBe('Rapide');
    const contacts = await t.db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM proches_contacts`);
    const calls = await t.db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM proches_calls`);
    expect(Number(contacts?.n)).toBe(1);
    expect(Number(calls?.n)).toBe(1);
  });
});