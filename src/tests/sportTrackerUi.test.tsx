jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: '/tmp/',
  documentDirectory: '/tmp/',
  EncodingType: { Base64: 'base64' },
  writeAsStringAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
}));

let mockDb: unknown;
const mockPush = jest.fn();
jest.mock('../data/db/client', () => ({
  ...jest.requireActual('../data/db/client'),
  getDb: async () => mockDb,
}));
jest.mock('expo-router', () => {
  const React = require('react');
  return {
    useRouter: () => ({ push: mockPush }),
    useFocusEffect: (cb: () => void | (() => void)) => {
      React.useEffect(() => cb(), []);
    },
  };
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SportTracker } from '../design-system/SportTracker';
import { nodeSqliteAvailable, openNodeSqliteDb, type TestDb } from './helpers/nodeSqliteDb';

const suite = nodeSqliteAvailable() ? describe : describe.skip;

suite('SportTracker (UI)', () => {
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
    mockPush.mockClear();
    t = await openNodeSqliteDb();
    mockDb = t.db;
  });
  afterEach(() => t.close());

  const rows = () =>
    t.db.getAllAsync<{ activity_id: string; status: string; outcome: string; reps: number | null; duration_sec: number | null; distance_m: number | null }>(
      `SELECT activity_id, status, outcome, reps, duration_sec, distance_m FROM sport_sessions ORDER BY rowid`,
    );

  test('fiche : accueil sans donnée, saisie invalide refusée, séance libre enregistrée une seule fois', async () => {
    await render(<SportTracker />);
    expect((await screen.findAllByText('Aucune séance')).length).toBe(2); // aujourd'hui et semaine
    expect(screen.getByText('Définir un objectif')).toBeTruthy();
    expect(screen.getByText('Défis Sport (chrono)')).toBeTruthy();
    expect(screen.getByText(/Pas de séance, pas de pénalité/)).toBeTruthy();

    await fireEvent.press(screen.getByText('Enregistrer une séance'));
    await fireEvent.press(await screen.findByText('Enregistrer la séance'));
    expect(await screen.findByText(/Indique le nombre de répétitions/)).toBeTruthy();
    expect(await rows()).toHaveLength(0);

    await fireEvent.changeText(screen.getByLabelText('Répétitions réalisées'), '1,5');
    await fireEvent.press(screen.getByText('Enregistrer la séance'));
    expect(await screen.findByText(/Nombre entier de répétitions/)).toBeTruthy();
    expect(await rows()).toHaveLength(0);

    await fireEvent.changeText(screen.getByLabelText('Répétitions réalisées'), '16');
    expect(screen.getByText(/Séance libre : elle ne revendique ni réussite ni échec/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Enregistrer la séance'));
    await waitFor(() => expect(screen.getByText(/Séance enregistrée : 16 répétitions/)).toBeTruthy());
    expect(await rows()).toEqual([{ activity_id: 'pushups', status: 'active', outcome: 'free', reps: 16, duration_sec: null, distance_m: null }]);
    expect(screen.queryByText('Aucune séance')).toBeNull();
    expect(screen.getAllByText(/1 séance · 16 répétitions/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Nouveau record personnel/)).toBeTruthy();

    await fireEvent.press(screen.getByText('Défis Sport (chrono)'));
    expect(mockPush).toHaveBeenCalledWith('/tools/challenges?type=sport');
  });

  test('objectif 20, réalisé 16 : « Échoué » conserve la performance, aucune réussite, message neutre', async () => {
    await render(<SportTracker />);
    await fireEvent.press(await screen.findByText('Définir un objectif'));
    await fireEvent.changeText(screen.getByLabelText("Valeur de l'objectif"), '20');
    await fireEvent.press(screen.getByText("Enregistrer l'objectif"));
    await waitFor(() => expect(screen.getByText(/Objectif enregistré : 20 répétitions/)).toBeTruthy());
    expect(await screen.findByText(/Objectif actuel : 20 répétitions/)).toBeTruthy();

    await fireEvent.press(screen.getByText('Enregistrer une séance'));
    await fireEvent.changeText(await screen.findByLabelText('Répétitions réalisées'), '16');
    expect(await screen.findByText(/Résultat : non atteint \(16 répétitions sur 20 répétitions\)/)).toBeTruthy();
    // « Atteint » avec 16 : refusé, rien n'est écrit
    await fireEvent.press(screen.getByText('Atteint'));
    await fireEvent.press(screen.getByText('Enregistrer la séance'));
    expect(await screen.findByText(/« Atteint » demande une performance au moins égale/)).toBeTruthy();
    expect(await rows()).toHaveLength(0);

    await fireEvent.press(screen.getByText('Échoué'));
    await fireEvent.press(screen.getByText('Enregistrer la séance'));
    await waitFor(() => expect(screen.getByText(/Tentative enregistrée : 16 répétitions \(objectif 20 répétitions, non atteint\)/)).toBeTruthy());
    expect(screen.getByText(/Ta performance compte dans tes totaux et ton record/)).toBeTruthy();
    expect(await rows()).toEqual([{ activity_id: 'pushups', status: 'active', outcome: 'failed', reps: 16, duration_sec: null, distance_m: null }]);
    expect(screen.getByText(/objectif non atteint \(20 répétitions\)/)).toBeTruthy();
    expect(screen.queryByText(/Objectif atteint :/)).toBeNull();
    expect(await t.db.getAllAsync(`SELECT * FROM xp_ledger`)).toHaveLength(0);
    expect(await t.db.getAllAsync(`SELECT * FROM wallet_ledger`)).toHaveLength(0);
  });

  test('correction recalcule le record ; annulation en deux temps conserve la ligne', async () => {
    await render(<SportTracker />);
    await fireEvent.press(await screen.findByText('Enregistrer une séance'));
    await fireEvent.changeText(await screen.findByLabelText('Répétitions réalisées'), '12');
    await fireEvent.press(screen.getByText('Enregistrer la séance'));
    await waitFor(() => expect(screen.getByText(/Séance enregistrée : 12 répétitions/)).toBeTruthy());

    await fireEvent.press(await screen.findByText('Corriger'));
    await fireEvent.changeText(screen.getByLabelText('Répétitions réalisées'), '14');
    await fireEvent.press(screen.getByText('Enregistrer la correction'));
    await waitFor(() => expect(screen.getByText(/Correction enregistrée/)).toBeTruthy());
    expect(await rows()).toEqual([{ activity_id: 'pushups', status: 'active', outcome: 'free', reps: 14, duration_sec: null, distance_m: null }]);
    expect(await t.db.getAllAsync(`SELECT kind FROM sport_corrections`)).toHaveLength(1);
    expect(await screen.findByText(/corrigée 1 fois/)).toBeTruthy();

    await fireEvent.press(await screen.findByText('Annuler la séance'));
    await fireEvent.press(await screen.findByText('Oui, annuler cette séance'));
    await waitFor(() => expect(screen.getByText(/Séance annulée/)).toBeTruthy());
    expect(await rows()).toEqual([{ activity_id: 'pushups', status: 'cancelled', outcome: 'free', reps: 14, duration_sec: null, distance_m: null }]);
    expect((await screen.findAllByText('Aucune séance')).length).toBe(2);
    expect(await t.db.getAllAsync(`SELECT kind FROM sport_corrections ORDER BY rowid`)).toEqual([{ kind: 'edit' }, { kind: 'cancel' }]);
  });

  test('marche : durée et distance ; séance libre : durée avec discipline', async () => {
    await render(<SportTracker />);
    await fireEvent.press(await screen.findByText('Marche'));
    await fireEvent.press(await screen.findByText('Enregistrer une séance'));
    await fireEvent.press(await screen.findByText('Enregistrer la séance'));
    expect(await screen.findByText(/au moins la durée \(min\) ou la distance \(km\)/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Durée en minutes'), '30');
    await fireEvent.changeText(screen.getByLabelText('Distance en kilomètres'), '2,5');
    await fireEvent.press(screen.getByText('Enregistrer la séance'));
    await waitFor(() => expect(screen.getByText(/Séance enregistrée : 30 min · 2,5 km/)).toBeTruthy());
    expect(await rows()).toEqual([{ activity_id: 'walking', status: 'active', outcome: 'free', reps: null, duration_sec: 1800, distance_m: 2500 }]);

    await fireEvent.press(screen.getByText('Séance libre'));
    await fireEvent.press(await screen.findByText('Enregistrer une séance'));
    await fireEvent.changeText(await screen.findByLabelText('Nom de la discipline'), 'Yoga');
    await fireEvent.changeText(screen.getByLabelText('Durée en minutes'), '45');
    await fireEvent.press(screen.getByText('Enregistrer la séance'));
    await waitFor(() => expect(screen.getByText(/Séance enregistrée : 45 min/)).toBeTruthy());
    expect((await rows())[1]).toMatchObject({ activity_id: 'free', outcome: 'free', duration_sec: 2700 });
  });
});
