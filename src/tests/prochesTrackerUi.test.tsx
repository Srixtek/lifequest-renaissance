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
    useFocusEffect: (cb: () => void | (() => void)) => {
      React.useEffect(() => cb(), []);
    },
  };
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ProchesTracker } from '../design-system/ProchesTracker';
import { nodeSqliteAvailable, openNodeSqliteDb, type TestDb } from './helpers/nodeSqliteDb';

const suite = nodeSqliteAvailable() ? describe : describe.skip;

suite('ProchesTracker (UI)', () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await openNodeSqliteDb();
    mockDb = t.db;
  });
  afterEach(() => t.close());

  test('fiche : objectif défaut, enregistrement appel', async () => {
    await render(<ProchesTracker />);
    expect(await screen.findByText(/Semaine en cours/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Enregistrer un appel'));
    await fireEvent.changeText(screen.getByLabelText('Nom du proche'), 'Maman');
    await fireEvent.press(screen.getByText('Confirmer l\'appel'));
    await waitFor(() => expect(screen.getByText(/Appel avec Maman enregistré/)).toBeTruthy());
    const rows = await t.db.getAllAsync<{ status: string }>(`SELECT status FROM proches_calls`);
    expect(rows).toEqual([{ status: 'active' }]);
  });
});