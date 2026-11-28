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
import { DailyQuestsBlock } from '../design-system/DailyQuestsBlock';
import { addCall, addContact } from '../domain/services/prochesTrackerService';
import { alcoholLogicalDate } from '../domain/rules/alcohol';
import { nodeSqliteAvailable, openNodeSqliteDb, type TestDb } from './helpers/nodeSqliteDb';

const suite = nodeSqliteAvailable() ? describe : describe.skip;

suite('DailyQuestsBlock (UI)', () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await openNodeSqliteDb();
    mockDb = t.db;
    const today = alcoholLogicalDate(new Date(), undefined, 4);
    const iso = new Date().toISOString();
    await t.db.runAsync(`INSERT INTO daily_quest_sets (local_date, replacements_used, created_at, updated_at) VALUES (?, 0, ?, ?)`, today, iso, iso);
    for (const [i, id] of ['dq_proches_call', 'dq_divers_activity', 'rnw_breathe_calm'].entries()) {
      await t.db.runAsync(
        `INSERT INTO daily_quest_offers (id, local_date, slot_index, template_id, params_json, state, created_at, updated_at) VALUES (?, ?, ?, ?, '{}', 'offered', ?, ?)`,
        `o-${id}`,
        today,
        i,
        id,
        iso,
        iso,
      );
    }
  });
  afterEach(() => t.close());

  test('affiche 3 missions, accepte, réclame après un vrai appel, montre l\'or crédité', async () => {
    await render(<DailyQuestsBlock onOpenActivity={jest.fn()} />);
    expect(await screen.findByText(/Trois missions du jour/)).toBeTruthy();
    expect(await screen.findByText('Appeler un proche')).toBeTruthy();
    expect(screen.getByText('Une petite activité Divers')).toBeTruthy();
    expect(screen.getAllByText('Accepter')).toHaveLength(3);
    expect(screen.getByText(/minuit UTC/)).toBeTruthy();

    fireEvent.press(screen.getAllByText('Accepter')[0]);
    await waitFor(() => expect(screen.getByText(/l'action compte à partir de maintenant/)).toBeTruthy());
    expect(await screen.findByText('En cours')).toBeTruthy();
    expect(screen.getByText(/Aucun appel déclaré depuis l'acceptation/)).toBeTruthy();

    const c = await addContact(t.db, { name: 'Léa' });
    if (!c.ok) throw new Error('contact');
    await addCall(t.db, { contactId: c.contact.id, calledAt: new Date() });
    await render(<DailyQuestsBlock onOpenActivity={jest.fn()} />);
    const claimBtn = await screen.findByText(/Réclamer/);
    fireEvent.press(claimBtn);
    await waitFor(() => expect(screen.getByText(/\+8 or crédités\. Nouveau solde : 8 or/)).toBeTruthy());
  });

  test('remplacement : une seule fois par jour, bouton disparaît ensuite', async () => {
    await render(<DailyQuestsBlock onOpenActivity={jest.fn()} />);
    await screen.findByText('Appeler un proche');
    expect(screen.getAllByText('Remplacer').length).toBe(3);
    await t.db.runAsync(`INSERT OR IGNORE INTO sport_activities (id, label, kind, sort_order) VALUES ('pushups','Pompes','reps',1)`);
    await t.db.runAsync(
      `INSERT INTO sport_goals (id, activity_id, metric, target_value, effective_from, source, created_at) VALUES ('g1','pushups','reps',20,'2026-01-01','manual','2026-01-01T00:00:00.000Z')`,
    );
    fireEvent.press(screen.getAllByText('Remplacer')[0]);
    await waitFor(() => expect(screen.getByText(/Mission remplacée par/)).toBeTruthy());
    expect(screen.queryAllByText('Remplacer')).toHaveLength(0);
    expect(screen.getByText(/Remplacement du jour déjà utilisé/)).toBeTruthy();
  });
});
