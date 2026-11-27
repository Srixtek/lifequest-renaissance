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
import { AlcoholTracker } from '../design-system/AlcoholTracker';
import { nodeSqliteAvailable, openNodeSqliteDb, type TestDb } from './helpers/nodeSqliteDb';

const suite = nodeSqliteAvailable() ? describe : describe.skip;

suite('AlcoholTracker (UI)', () => {
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

  const rows = () =>
    t.db.getAllAsync<{ status: string; alcohol_mg: number; quantity_x100: number }>(
      `SELECT status, alcohol_mg, quantity_x100 FROM alcohol_consumptions ORDER BY rowid`,
    );

  test('fiche : aucune donnée ≠ zéro, ajout avec préréglage, correction, annulation', async () => {
    await render(<AlcoholTracker />);
    expect(await screen.findByText('Aucune donnée')).toBeTruthy();
    expect(screen.getByText(/On ne suppose rien|ne suppose rien/)).toBeTruthy();

    await fireEvent.press(screen.getByText('Ajouter une boisson'));
    expect(await screen.findByText('= 0,99 verre standard · 9,9 g d\'alcool pur')).toBeTruthy();

    // Champ invalide : refus clair, rien d'écrit
    await fireEvent.changeText(screen.getByLabelText('Volume en millilitres'), '');
    await fireEvent.press(screen.getByText('Enregistrer la boisson'));
    expect(await screen.findByText('Indique le volume en ml')).toBeTruthy();
    expect(await rows()).toHaveLength(0);

    // Préréglage vin, puis double appui sur « Enregistrer »
    await fireEvent.press(screen.getByText('Vin 10 cl · 12 %'));
    expect(await screen.findByText('= 0,95 verre standard · 9,5 g d\'alcool pur')).toBeTruthy();
    await fireEvent.press(screen.getByText('Enregistrer la boisson'));
    await waitFor(() => expect(screen.getByText(/Ajouté : 0,95 verre standard/)).toBeTruthy());
    expect(await rows()).toEqual([{ status: 'active', alcohol_mg: 9468, quantity_x100: 100 }]);
    expect(screen.queryByText('Aucune donnée')).toBeNull();
    expect(screen.getAllByText('0,95 verre standard').length).toBeGreaterThan(0);

    // Correction : 2 verres → total recalculé, ancienne valeur tracée
    await fireEvent.press(await screen.findByText('Corriger'));
    await fireEvent.changeText(screen.getByLabelText('Nombre de consommations identiques'), '2');
    expect(await screen.findByText(/= 1,89 verre standard/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Enregistrer la correction'));
    await waitFor(() => expect(screen.getByText(/Correction enregistrée : 1,89 verre standard/)).toBeTruthy());
    expect(await rows()).toEqual([{ status: 'active', alcohol_mg: 18936, quantity_x100: 200 }]);
    const audit = await t.db.getAllAsync(`SELECT kind FROM alcohol_corrections`);
    expect(audit).toHaveLength(1);

    // Annulation en deux temps : la ligne reste, le total retombe à « aucune donnée »
    await fireEvent.press(await screen.findByText('Annuler la saisie'));
    await fireEvent.press(await screen.findByText('Oui, annuler cette saisie'));
    await waitFor(() => expect(screen.getByText(/Saisie annulée/)).toBeTruthy());
    expect(await rows()).toEqual([{ status: 'cancelled', alcohol_mg: 18936, quantity_x100: 200 }]);
    expect(await screen.findByText('Aucune donnée')).toBeTruthy();
  });

  test('« Autre » ne suppose rien ; zéro explicite et départ confirmé', async () => {
    await render(<AlcoholTracker />);
    await fireEvent.press(await screen.findByText('Ajouter une boisson'));
    await fireEvent.press(screen.getByText('Autre'));
    expect(await screen.findByText(/rien n'est supposé/)).toBeTruthy();
    expect(screen.getByText('Remplis volume, degré et nombre pour voir le calcul.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Fermer'));

    await fireEvent.press(await screen.findByText('Aucune boisson aujourd\'hui'));
    await waitFor(() => expect(screen.getByText('0 déclaré')).toBeTruthy());
    expect(await t.db.getAllAsync(`SELECT local_date FROM alcohol_zero_days WHERE revoked_at IS NULL`)).toHaveLength(1);

    await fireEvent.press(screen.getByText('Confirmer ce départ'));
    await waitFor(() => expect(screen.getByText(/Départ confirmé/)).toBeTruthy());
    expect(await screen.findByText('Depuis le départ que tu as confirmé')).toBeTruthy();
    expect(await t.db.getAllAsync(`SELECT id FROM alcohol_start_markers`)).toHaveLength(1);
  });
});
