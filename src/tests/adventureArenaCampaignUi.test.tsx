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

const mockPush = jest.fn();
jest.mock('expo-router', () => {
  const React = require('react');
  return {
    useRouter: () => ({ push: mockPush }),
    useLocalSearchParams: () => ({}),
    useFocusEffect: (cb: () => void | (() => void)) => {
      React.useEffect(() => cb(), [cb]);
    },
  };
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AdventureScreen from '@/app/(tabs)/adventure';
import { startCampaignCombat } from '../domain/services/kingdomService';
import { nodeSqliteAvailable, openNodeSqliteDb, type TestDb } from './helpers/nodeSqliteDb';

const suite = nodeSqliteAvailable() ? describe : describe.skip;

suite('Adventure — arène avec campagne active', () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await openNodeSqliteDb();
    mockDb = t.db;
    const start = await startCampaignCombat(t.db, 'eloria_forest_01');
    expect(start.ok).toBe(true);
  });
  afterEach(() => t.close());

  test('ouvre l’arène : bouton Forêt visible, pas d’engagement arène', async () => {
    await render(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        <AdventureScreen />
      </SafeAreaProvider>,
    );
    await screen.findByText('Bastion', { exact: true });
    const arena = await screen.findByLabelText('Arène de combat');
    fireEvent.press(arena);
    const forestBtn = await screen.findByText('Aller à la Forêt');
    expect(forestBtn).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Engager le combat')).toBeNull());
    fireEvent.press(forestBtn);
    await waitFor(() => expect(screen.getByText(/Campagne d'Eloria/i)).toBeTruthy());
  });
});