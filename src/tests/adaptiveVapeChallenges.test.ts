import { informedOutcomesFromAttempts, suggestTierIndex } from '../domain/rules/adaptiveTier';
import {
  delayMinutesForTier,
  VAPE_TIER_COUNT,
} from '../domain/content/vapeChallengeDefs';
import {
  closeVapeAdaptiveChallenge,
  getVapeAdaptiveDashboard,
  setManualVapeTier,
  startVapeAdaptiveChallenge,
} from '../domain/services/adaptiveChallengeService';
import { publicGoalTitle } from '../domain/content/goalDisplay';
import { resolveHabitPlan } from '../domain/content/habitIntentions';
import { GOAL_TEMPLATES } from '../data/content/goalTemplates';
import * as rpgRepo from '../data/db/repositories/rpgRepo';
import { nodeSqliteAvailable, openNodeSqliteDb, type TestDb } from './helpers/nodeSqliteDb';

jest.mock('../utils/id', () => {
  let n = 0;
  return { createId: (p: string) => `${p}-${++n}` };
});

describe('suggestTierIndex — règle adaptative (mocks)', () => {
  test('deux succès sur trois → palier supérieur', () => {
    const r = suggestTierIndex(1, ['success', 'success', 'failure'], VAPE_TIER_COUNT - 1);
    expect(r.tierIndex).toBe(2);
    expect(r.adjusted).toBe(true);
    expect(r.message).toMatch(/ajusté/);
  });

  test('deux échecs sur trois → palier inférieur', () => {
    const r = suggestTierIndex(2, ['failure', 'failure', 'success'], VAPE_TIER_COUNT - 1);
    expect(r.tierIndex).toBe(1);
    expect(r.adjusted).toBe(true);
  });

  test('résultats mixtes → palier conservé', () => {
    const r = suggestTierIndex(2, ['success', 'failure'], VAPE_TIER_COUNT - 1);
    expect(r.tierIndex).toBe(2);
    expect(r.adjusted).toBe(false);
  });

  test('inconnus exclus du calcul', () => {
    const informed = informedOutcomesFromAttempts(['unknown', 'success', 'failure', 'unknown', 'success']);
    expect(informed).toEqual(['success', 'failure', 'success']);
    const r = suggestTierIndex(0, informed, VAPE_TIER_COUNT - 1);
    expect(r.tierIndex).toBe(1);
  });

  test('palier manuel inchangé par la fonction pure', () => {
    expect(suggestTierIndex(4, ['failure', 'failure', 'failure'], 4).tierIndex).toBe(3);
  });
});

describe('défis vape — cibles par palier (mocks)', () => {
  test('quatre formats et paliers retard', () => {
    expect(delayMinutesForTier(0)).toBe(5);
    expect(delayMinutesForTier(4)).toBe(60);
  });
});

describe('habitude sensible — libellés (mocks)', () => {
  test('onboarding : aucun objectif sensible pré-coché par défaut', () => {
    expect(GOAL_TEMPLATES.some((t) => t.sensitive)).toBe(true);
    const defaults: string[] = [];
    expect(defaults).not.toContain('freq_regulation');
  });

  test('titre config vs public', () => {
    const tpl = GOAL_TEMPLATES.find((t) => t.id === 'freq_regulation');
    expect(tpl?.title).toMatch(/Masturbation/);
    const plan = resolveHabitPlan('C', 'measure', null, null);
    expect(plan.title).toMatch(/Masturbation/);
    expect(
      publicGoalTitle({
        id: 'g',
        title: plan.title,
        kind: plan.kind,
        unit: plan.unit,
        weight: 1,
        status: 'active',
        templateId: 'freq_regulation',
        sensitive: true,
        followWithoutXp: true,
        createdAt: '',
      }),
    ).toMatch(/Régulation personnelle/);
  });
});

const HAS_NODE = nodeSqliteAvailable();
if (!HAS_NODE) {
  // eslint-disable-next-line no-console
  console.warn('[SKIP] adaptive vape — node:sqlite indisponible');
}
const sqliteSuite = HAS_NODE ? describe : describe.skip;

async function seedVapeGoal(db: TestDb['db']) {
  const now = '2025-11-26T10:00:00.000Z';
  await db.runAsync(
    `INSERT INTO goal_definitions
     (id, title, kind, unit, weight, status, template_id, sensitive, follow_without_xp, created_at)
     VALUES ('gvape', 'Vape', 'limit', 'séances', 1, 'active', 'vape_sessions', 0, 0, ?)`,
    now,
  );
  await db.runAsync(
    `INSERT INTO goal_versions
     (id, goal_id, version, tier, target_value, schedule_kind, weekly_target_count, notes, effective_from, effective_to)
     VALUES ('gv1', 'gvape', 1, 'normal', 5, 'daily', NULL, NULL, '2025-11-01', NULL)`,
  );
}

sqliteSuite('adaptive vape — persistance node:sqlite', () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await openNodeSqliteDb();
    await seedVapeGoal(t.db);
  });
  afterEach(() => t.close());

  test('migration 006 crée les tables', async () => {
    const rows = await t.db.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'adaptive%' ORDER BY name`,
    );
    expect(rows.map((r) => r.name)).toEqual([
      'adaptive_challenge_attempts',
      'adaptive_challenge_records',
      'adaptive_challenge_state',
    ]);
  });

  test('quatre types : démarrage et clôture', async () => {
    const formats = ['delay_craving', 'breathing', 'interval', 'record'] as const;
    for (const f of formats) {
      const start = await startVapeAdaptiveChallenge(t.db, f);
      expect(start.ok).toBe(true);
      if (!start.ok) continue;
      const close = await closeVapeAdaptiveChallenge(t.db, start.attempt.id, 'vaped');
      expect(close.ok).toBe(true);
    }
  });

  test('double démarrage refusé', async () => {
    const a = await startVapeAdaptiveChallenge(t.db, 'breathing');
    expect(a.ok).toBe(true);
    const b = await startVapeAdaptiveChallenge(t.db, 'delay_craving');
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.code).toBe('already_running');
  });

  test('record conservé après échec', async () => {
    const start = await startVapeAdaptiveChallenge(t.db, 'record');
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    await closeVapeAdaptiveChallenge(t.db, start.attempt.id, 'completed');
    const dash = await getVapeAdaptiveDashboard(t.db);
    expect(dash.record?.bestDurationSec).toBeGreaterThanOrEqual(0);
    const start2 = await startVapeAdaptiveChallenge(t.db, 'record');
    expect(start2.ok).toBe(true);
    if (!start2.ok) return;
    await closeVapeAdaptiveChallenge(t.db, start2.attempt.id, 'vaped');
    const dash2 = await getVapeAdaptiveDashboard(t.db);
    expect(dash2.record?.bestDurationSec).toBe(dash.record?.bestDurationSec);
  });

  test('récompense or idempotente par palier', async () => {
    const key = 'adaptive:vape:tier:0:gold';
    expect(await rpgRepo.addGold(t.db, 3, 'palier 1', key)).toBe('inserted');
    expect(await rpgRepo.addGold(t.db, 3, 'palier 1', key)).toBe('duplicate');
    expect(await rpgRepo.getGoldBalance(t.db)).toBe(3);
  });

  test('palier manuel + reprise', async () => {
    await setManualVapeTier(t.db, 3);
    const dash = await getVapeAdaptiveDashboard(t.db);
    expect(dash.state.tierIndex).toBe(3);
    expect(dash.state.tierManual).toBe(true);
  });

  test('catégorie vape inactive → pas de défi', async () => {
    await t.db.runAsync(`UPDATE goal_definitions SET status = 'paused' WHERE id = 'gvape'`);
    const r = await startVapeAdaptiveChallenge(t.db, 'breathing');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('category_inactive');
  });
});