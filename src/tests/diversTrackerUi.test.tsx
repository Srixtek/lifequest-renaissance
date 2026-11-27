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
import { DiversTracker } from '../design-system/DiversTracker';
import { nodeSqliteAvailable, openNodeSqliteDb, type TestDb } from './helpers/nodeSqliteDb';

const suite = nodeSqliteAvailable() ? describe : describe.skip;

suite('DiversTracker (UI)', () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await openNodeSqliteDb();
    mockDb = t.db;
  });
  afterEach(() => t.close());

  test('affiche suggestions et confirmation', async () => {
    await render(<DiversTracker />);
    expect(await screen.findByText(/Petites activités/)).toBeTruthy();
    expect(await screen.findByText(/Suggestions du jour/)).toBeTruthy();
    const btns = await screen.findAllByText("Je l'ai fait");
    fireEvent.press(btns[0]);
    await waitFor(() => expect(screen.getByText(/^Noté :/)).toBeTruthy());
  });
});