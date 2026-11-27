jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: '/tmp/',
  documentDirectory: '/tmp/',
  EncodingType: { Base64: 'base64' },
  writeAsStringAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
}));

let mockDb: unknown;
jest.mock('../data/db/client', () => ({
  ...jest.requireActual('../data/db/client'),
  getDb: async () => mockDb,
}));
jest.mock('expo-router', () => {
  const React = require('react');
  return {
    useRouter: () => ({ push: jest.fn() }),
    useFocusEffect: (cb: () => void | (() => void)) => {
      React.useEffect(() => cb(), []);
    },
  };
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as rpgRepo from '../data/db/repositories/rpgRepo';
import { VapeTracker } from '../design-system/VapeTracker';
import { SHARED_DAILY_GOLD_CAP } from '../domain/services/goldDailyCap';
import { nodeSqliteAvailable, openNodeSqliteDb, type TestDb } from './helpers/nodeSqliteDb';

const suite = nodeSqliteAvailable() ? describe : describe.skip;

suite('VapeTracker (UI)', () => {
  let t: TestDb;
  beforeAll(() => {
    const original = console.error.bind(console);
    jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (/not configured to support act|not wrapped in act/.test(String(args[0]))) return;
      original(...args);
    });
  });
  afterAll(() => jest.restoreAllMocks());
  beforeEach(async () => {
    t = await openNodeSqliteDb();
    mockDb = t.db;
  });
  afterEach(() => t.close());

  test('le bouton de validation reste disponible à 0 or et valide le palier', async () => {
    await rpgRepo.addGold(t.db, SHARED_DAILY_GOLD_CAP, 'quêtes', 'renewable:ui:reward');
    const started = new Date(Date.now() - 65 * 60_000).toISOString();
    await t.db.runAsync(
      `INSERT INTO vape_main_sessions (id, status, started_at, created_at, updated_at) VALUES ('ui1','active',?,?,?)`,
      started,
      started,
      started,
    );

    await render(<VapeTracker />);
    const open = await screen.findByText('Valider sans or');
    expect(screen.getByText(/0 or \(plafond atteint\)/)).toBeTruthy();
    fireEvent.press(open);
    const confirm = await screen.findByText('Oui, valider (0 or)');
    fireEvent.press(confirm);

    await waitFor(() => expect(screen.getByText(/Palier validé, 0 or/)).toBeTruthy());
    const rows = await t.db.getAllAsync<{ granted_gold: number }>(`SELECT granted_gold FROM vape_main_claims`);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.granted_gold === 0)).toBe(true);
  });
  test('un intervalle terminé reste réclamable depuis l\'écran après un nouveau départ', async () => {
    const h = 3_600_000;
    const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
    await t.db.runAsync(
      `INSERT INTO vape_main_sessions (id, status, started_at, ended_at, duration_sec, end_reason, created_at, updated_at)
       VALUES ('old1','closed',?,?,5400,'vaped',?,?)`,
      iso(5 * h),
      iso(5 * h - 5400_000),
      iso(5 * h),
      iso(5 * h),
    );
    await t.db.runAsync(
      `INSERT INTO vape_main_sessions (id, status, started_at, created_at, updated_at) VALUES ('new1','active',?,?,?)`,
      iso(40 * 60_000),
      iso(40 * 60_000),
      iso(40 * 60_000),
    );

    await render(<VapeTracker />);
    expect(await screen.findByText(/Intervalle terminé/)).toBeTruthy();
    expect(screen.getByText(/Chrono en cours/)).toBeTruthy();
    const buttons = await screen.findAllByText('Confirmer et récupérer');
    expect(buttons).toHaveLength(2);
    fireEvent.press(buttons[1]);
    fireEvent.press(await screen.findByText(/Oui, je confirme/));
    await waitFor(() => expect(screen.getByText(/3 paliers validés/)).toBeTruthy());
    await waitFor(async () => {
      const rows = await t.db.getAllAsync<{ session_id: string }>(`SELECT DISTINCT session_id FROM vape_main_claims`);
      expect(rows.map((r) => r.session_id)).toEqual(['old1']);
    });
  });
});
