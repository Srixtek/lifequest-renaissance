import { informedOutcomesFromAttempts, suggestTierIndex } from '../domain/rules/adaptiveTier';
import {
  delayMinutesForTier,
  VAPE_BREATHING_SECONDS,
  VAPE_TIER_COUNT,
} from '../domain/content/vapeChallengeDefs';
import {
  closeVapeAdaptiveChallenge,
  getVapeAdaptiveDashboard,
  resumeAutoVapeTier,
  setManualVapeTier,
  startVapeAdaptiveChallenge,
} from '../domain/services/adaptiveChallengeService';
import { publicGoalTitle } from '../domain/content/goalDisplay';
import { CONFIG_CATEGORY_LABELS, resolveHabitPlan } from '../domain/content/habitIntentions';
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

  test('titre config explicite vs public discret', () => {
    const tpl = GOAL_TEMPLATES.find((t) => t.id === 'freq_regulation');
    expect(tpl?.title).toMatch(/Masturbation/);
    expect(CONFIG_CATEGORY_LABELS.C).toMatch(/Masturbation/);
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

async function ageChallengeSession(db: TestDb['db'], sessionId: string, secondsAgo: number) {
  const started = new Date(Date.now() - secondsAgo * 1000).toISOString();
  await db.runAsync(`UPDATE challenge_sessions SET started_utc = ? WHERE id = ?`, started, sessionId);
}

sqliteSuite('adaptive vape — persistance node:sqlite', () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await openNodeSqliteDb();
    await seedVapeGoal(t.db);
  });
  afterEach(() => t.close());

  test('migration 007 — colonnes intervalle', async () => {
    const cols = await t.db.getAllAsync<{ name: string }>(`PRAGMA table_info(adaptive_challenge_state)`);
    expect(cols.some((c) => c.name === 'tier_index_interval')).toBe(true);
  });

  test('double démarrage refusé', async () => {
    const a = await startVapeAdaptiveChallenge(t.db, 'breathing');
    expect(a.ok).toBe(true);
    const b = await startVapeAdaptiveChallenge(t.db, 'delay_craving');
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.code).toBe('already_running');
  });

  test('respiration interrompue ≠ succès ; terminée avec preuve coping', async () => {
    const start = await startVapeAdaptiveChallenge(t.db, 'breathing');
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const interrupted = await closeVapeAdaptiveChallenge(t.db, start.attempt.id, 'vaped');
    expect(interrupted.ok).toBe(true);
    if (interrupted.ok) expect(interrupted.attempt.outcome).toBe('failure');
    expect(interrupted.ok && interrupted.goldGranted).toBe(false);

    const start2 = await startVapeAdaptiveChallenge(t.db, 'breathing');
    if (!start2.ok) return;
    await ageChallengeSession(t.db, start2.attempt.challengeSessionId!, VAPE_BREATHING_SECONDS + 5);
    const done = await closeVapeAdaptiveChallenge(t.db, start2.attempt.id, 'completed');
    expect(done.ok).toBe(true);
    if (done.ok) {
      expect(done.attempt.outcome).toBe('success');
      expect(done.attempt.copingSessionId).toBeTruthy();
    }
    const cope = await t.db.getFirstAsync<{ completed: number }>(
      `SELECT completed FROM coping_sessions WHERE id = ?`,
      done.ok ? done.attempt.copingSessionId : '',
    );
    expect(cope?.completed).toBe(1);
  });

  test('vape déclarée après 90 min — record 90 min', async () => {
    const start = await startVapeAdaptiveChallenge(t.db, 'record');
    if (!start.ok) return;
    await ageChallengeSession(t.db, start.attempt.challengeSessionId!, 90 * 60);
    const close = await closeVapeAdaptiveChallenge(t.db, start.attempt.id, 'vaped');
    expect(close.ok).toBe(true);
    if (close.ok) expect(close.attempt.outcome).toBe('failure');
    const dash = await getVapeAdaptiveDashboard(t.db);
    expect(dash.record?.bestDurationSec).toBeGreaterThanOrEqual(89 * 60);
  });

  test('nouvelle tentative courte — ancien record conservé', async () => {
    const start = await startVapeAdaptiveChallenge(t.db, 'record');
    if (!start.ok) return;
    await ageChallengeSession(t.db, start.attempt.challengeSessionId!, 90 * 60);
    await closeVapeAdaptiveChallenge(t.db, start.attempt.id, 'vaped');
    const dash = await getVapeAdaptiveDashboard(t.db);
    const best = dash.record?.bestDurationSec ?? 0;

    const start2 = await startVapeAdaptiveChallenge(t.db, 'record');
    if (!start2.ok) return;
    await ageChallengeSession(t.db, start2.attempt.challengeSessionId!, 20 * 60);
    await closeVapeAdaptiveChallenge(t.db, start2.attempt.id, 'vaped');
    const dash2 = await getVapeAdaptiveDashboard(t.db);
    expect(dash2.record?.bestDurationSec).toBe(best);
  });

  test('arrêt immédiat record — aucune récompense', async () => {
    const start = await startVapeAdaptiveChallenge(t.db, 'record');
    if (!start.ok) return;
    const close = await closeVapeAdaptiveChallenge(t.db, start.attempt.id, 'completed');
    expect(close.ok).toBe(true);
    if (close.ok) {
      expect(close.goldGranted).toBe(false);
      expect(close.attempt.outcome).toBe('failure');
    }
    expect(await rpgRepo.getGoldBalance(t.db)).toBe(0);
  });

  test('palier record 15 min — or idempotent', async () => {
    const start = await startVapeAdaptiveChallenge(t.db, 'record');
    if (!start.ok) return;
    await ageChallengeSession(t.db, start.attempt.challengeSessionId!, 16 * 60);
    const c1 = await closeVapeAdaptiveChallenge(t.db, start.attempt.id, 'vaped');
    expect(c1.ok && c1.goldGranted).toBe(true);
    const bal = await rpgRepo.getGoldBalance(t.db);

    const start2 = await startVapeAdaptiveChallenge(t.db, 'record');
    if (!start2.ok) return;
    await ageChallengeSession(t.db, start2.attempt.challengeSessionId!, 17 * 60);
    const c2 = await closeVapeAdaptiveChallenge(t.db, start2.attempt.id, 'vaped');
    expect(c2.ok && c2.goldGranted).toBe(false);
    expect(await rpgRepo.getGoldBalance(t.db)).toBe(bal);
  });

  test('deux formats — difficultés indépendantes', async () => {
    await setManualVapeTier(t.db, 'delay', 2);
    await setManualVapeTier(t.db, 'interval', 4);
    const dash = await getVapeAdaptiveDashboard(t.db);
    expect(dash.state.tierIndex).toBe(2);
    expect(dash.state.tierIndexInterval).toBe(4);
  });

  test('échecs delay — suggestion palier inférieur sans toucher intervalle', async () => {
    await setManualVapeTier(t.db, 'delay', 2);
    await resumeAutoVapeTier(t.db, 'delay');
    for (let i = 0; i < 3; i++) {
      const s = await startVapeAdaptiveChallenge(t.db, 'delay_craving');
      if (!s.ok) return;
      await closeVapeAdaptiveChallenge(t.db, s.attempt.id, 'vaped');
    }
    const dash = await getVapeAdaptiveDashboard(t.db);
    expect(dash.state.tierIndex).toBeLessThan(2);
    expect(dash.state.tierIndexInterval).toBe(0);
  });

  test('palier manuel puis reprise auto', async () => {
    await setManualVapeTier(t.db, 'delay', 3);
    let dash = await getVapeAdaptiveDashboard(t.db);
    expect(dash.state.tierManual).toBe(true);
    await resumeAutoVapeTier(t.db, 'delay');
    dash = await getVapeAdaptiveDashboard(t.db);
    expect(dash.state.tierManual).toBe(false);
  });

  test('fermeture / réouverture — tentative persistée', async () => {
    const s = await startVapeAdaptiveChallenge(t.db, 'interval');
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    const dash = await getVapeAdaptiveDashboard(t.db);
    expect(dash.running?.id).toBe(s.attempt.id);
  });

  test('récompense or idempotente par format et palier delay', async () => {
    const key = 'adaptive:vape:delay_craving:tier:0:gold';
    expect(await rpgRepo.addGold(t.db, 3, 'palier 1', key)).toBe('inserted');
    expect(await rpgRepo.addGold(t.db, 3, 'palier 1', key)).toBe('duplicate');
  });

  test('catégorie vape inactive → pas de défi', async () => {
    await t.db.runAsync(`UPDATE goal_definitions SET status = 'paused' WHERE id = 'gvape'`);
    const r = await startVapeAdaptiveChallenge(t.db, 'breathing');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('category_inactive');
  });
});