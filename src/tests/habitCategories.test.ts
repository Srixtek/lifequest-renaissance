import { migrate } from '../data/db/client';
import * as goalRepo from '../data/db/repositories/goalRepo';
import {
  HABIT_CATEGORIES,
  TEMPLATE_CATEGORY,
  activeCountLabel,
  categoryForGoal,
  groupGoalsByCategory,
} from '../data/content/habitCategories';
import { GOAL_TEMPLATES } from '../data/content/goalTemplates';
import { createCustomGoal } from '../domain/services/goalCreationService';
import { scheduleVersionUpdate } from '../domain/services/goalLifecycleService';
import { confirmGoalDay } from '../domain/services/trackingService';
import { DAILY_XP_BUDGET, XP_RULE_VERSION } from '../domain/rules/xp';
import { nodeSqliteAvailable, openNodeSqliteDb, type TestDb } from './helpers/nodeSqliteDb';

describe('catalogue des catégories', () => {
  test('sept catégories typées, symboles et couleurs distincts', () => {
    expect(HABIT_CATEGORIES.map((c) => c.id)).toEqual([
      'vape',
      'alcool',
      'sport',
      'proches',
      'personnel',
      'sans_ecran',
      'divers',
    ]);
    expect(new Set(HABIT_CATEGORIES.map((c) => c.symbol)).size).toBe(7);
    expect(new Set(HABIT_CATEGORIES.map((c) => c.color)).size).toBe(7);
  });

  test('classification des modèles existants', () => {
    expect(TEMPLATE_CATEGORY).toEqual({
      vape_sessions: 'vape',
      alcohol_limit: 'alcool',
      sport_minutes: 'sport',
      call_family: 'proches',
      freq_regulation: 'personnel',
      screen_free: 'sans_ecran',
      breathing5: 'divers',
    });
    for (const t of GOAL_TEMPLATES) {
      expect(categoryForGoal({ categoryId: null, templateId: t.id })).toBe(TEMPLATE_CATEGORY[t.id]);
    }
  });

  test('perso sans catégorie → divers ; catégorie persistée prioritaire ; valeur inconnue ignorée', () => {
    expect(categoryForGoal({ categoryId: null, templateId: null })).toBe('divers');
    expect(categoryForGoal({ templateId: null })).toBe('divers');
    expect(categoryForGoal({ categoryId: 'sport', templateId: null })).toBe('sport');
    expect(categoryForGoal({ categoryId: 'inconnue' as never, templateId: 'alcohol_limit' })).toBe('alcool');
  });

  test('regroupement et libellés de comptage', () => {
    const g = groupGoalsByCategory([
      { categoryId: null, templateId: 'vape_sessions' },
      { categoryId: 'sport', templateId: null },
      { categoryId: null, templateId: null },
    ]);
    expect(g.vape).toHaveLength(1);
    expect(g.sport).toHaveLength(1);
    expect(g.divers).toHaveLength(1);
    expect(g.alcool).toHaveLength(0);
    expect(activeCountLabel(0)).toBe('Aucun objectif');
    expect(activeCountLabel(1)).toBe('1 objectif');
    expect(activeCountLabel(3)).toBe('3 objectifs');
  });
});

const suite = nodeSqliteAvailable() ? describe : describe.skip;

suite('catégories — SQLite réel (node:sqlite)', () => {
  let t: TestDb;

  beforeEach(async () => {
    t = await openNodeSqliteDb();
  });
  afterEach(() => t.close());

  async function downgradeTo010() {
    await t.db.execAsync(`
      DROP INDEX IF EXISTS idx_goal_definitions_category;
      ALTER TABLE goal_definitions DROP COLUMN category_id;
      DELETE FROM schema_migrations WHERE version = 11;
    `);
  }

  test('migration 010→011 sans perte : objectifs, suivis, récompenses', async () => {
    await downgradeTo010();
    const cols = await t.db.getAllAsync<{ name: string }>(`PRAGMA table_info(goal_definitions)`);
    expect(cols.map((c) => c.name)).not.toContain('category_id');

    await t.db.execAsync(`
      INSERT INTO goal_definitions (id, title, kind, unit, weight, status, template_id, sensitive, follow_without_xp, created_at) VALUES
        ('g_vape', 'Vape', 'limit', 'séances', 1, 'active', 'vape_sessions', 0, 0, '2026-01-01T00:00:00.000Z'),
        ('g_call', 'Appeler', 'habit', NULL, 1, 'paused', 'call_family', 0, 0, '2026-01-02T00:00:00.000Z'),
        ('g_old_custom', 'Lire', 'duration', 'min', 1, 'active', NULL, 0, 0, '2026-01-03T00:00:00.000Z'),
        ('g_arch', 'Ancien sport', 'duration', 'min', 1, 'archived', 'sport_minutes', 0, 0, '2026-01-04T00:00:00.000Z');
      INSERT INTO goal_versions (id, goal_id, version, tier, target_value, schedule_kind, weekly_target_count, notes, effective_from, effective_to) VALUES
        ('v1', 'g_vape', 1, 'normal', 5, 'daily', NULL, NULL, '2026-01-01', NULL),
        ('v2', 'g_old_custom', 1, 'minimal', 20, 'daily', NULL, NULL, '2026-01-03', NULL);
      INSERT INTO tracking_events (id, goal_id, local_date, status, value, note, created_at, updated_at) VALUES
        ('t1', 'g_vape', '2026-01-05', 'success', 3, NULL, '2026-01-05T10:00:00.000Z', '2026-01-05T10:00:00.000Z'),
        ('t2', 'g_old_custom', '2026-01-05', 'partial', 10, NULL, '2026-01-05T10:00:00.000Z', '2026-01-05T10:00:00.000Z');
      INSERT INTO xp_ledger (id, source_event_id, source_rule_version, xp_amount, reason, idempotency_key, local_date, created_at)
        VALUES ('x1', 't1', '0.2.0', 12.5, 'test', 'k1', '2026-01-05', '2026-01-05T10:00:00.000Z');
      INSERT INTO wallet_ledger (id, resource, amount, reason, idempotency_key, created_at)
        VALUES ('w1', 'gold', 15, 'quête', 'quest:x:reward', '2026-01-05T10:00:00.000Z'),
               ('w2', 'shards', 1, 'éclat', 'shard:x', '2026-01-05T10:00:00.000Z');
    `);
    const before = {
      goals: await t.db.getAllAsync(`SELECT id, title, kind, unit, weight, status, template_id FROM goal_definitions ORDER BY id`),
      versions: await t.db.getAllAsync(`SELECT * FROM goal_versions ORDER BY id`),
      tracking: await t.db.getAllAsync(`SELECT * FROM tracking_events ORDER BY id`),
      xp: await t.db.getAllAsync(`SELECT * FROM xp_ledger ORDER BY id`),
      wallet: await t.db.getAllAsync(`SELECT * FROM wallet_ledger ORDER BY id`),
    };

    await migrate(t.db);

    const after = {
      goals: await t.db.getAllAsync(`SELECT id, title, kind, unit, weight, status, template_id FROM goal_definitions ORDER BY id`),
      versions: await t.db.getAllAsync(`SELECT * FROM goal_versions ORDER BY id`),
      tracking: await t.db.getAllAsync(`SELECT * FROM tracking_events ORDER BY id`),
      xp: await t.db.getAllAsync(`SELECT * FROM xp_ledger ORDER BY id`),
      wallet: await t.db.getAllAsync(`SELECT * FROM wallet_ledger ORDER BY id`),
    };
    expect(after).toEqual(before);

    const applied = await t.db.getAllAsync<{ version: number }>(`SELECT version FROM schema_migrations ORDER BY version`);
    expect(applied.map((r) => r.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

    const goals = await goalRepo.listGoals(t.db, true);
    const byId = Object.fromEntries(goals.map((g) => [g.id, g]));
    expect(byId.g_vape.categoryId).toBe('vape');
    expect(byId.g_call.categoryId).toBe('proches');
    expect(byId.g_arch.categoryId).toBe('sport');
    expect(byId.g_old_custom.categoryId).toBeNull();
    expect(categoryForGoal(byId.g_old_custom)).toBe('divers');
  });

  test('création d\'une habitude perso avec catégorie, relue depuis SQLite', async () => {
    const r = await createCustomGoal(t.db, {
      title: '  Marche du soir ',
      kind: 'duration',
      unit: ' min ',
      targetRaw: '20',
      tier: 'ambitieux',
      categoryId: 'sport',
    });
    if (!r.ok) throw new Error(r.error);
    expect(r.title).toBe('Marche du soir');

    const goals = await goalRepo.listGoals(t.db);
    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({
      id: r.goalId,
      title: 'Marche du soir',
      kind: 'duration',
      unit: 'min',
      templateId: null,
      categoryId: 'sport',
      status: 'active',
    });
    expect(categoryForGoal(goals[0])).toBe('sport');
    const v = await goalRepo.getCurrentVersion(t.db, r.goalId);
    expect(v).toMatchObject({ tier: 'ambitieux', targetValue: 20, scheduleKind: 'daily', version: 1 });
    const raw = await t.db.getFirstAsync<{ category_id: string }>(
      `SELECT category_id FROM goal_definitions WHERE id = ?`,
      r.goalId,
    );
    expect(raw?.category_id).toBe('sport');
  });

  test('validation : nom vide, cible manquante ou invalide → rien n\'est créé', async () => {
    const base = { kind: 'limit' as const, unit: null, tier: 'normal' as const, categoryId: 'divers' as const };
    expect(await createCustomGoal(t.db, { ...base, title: '  ', targetRaw: '3' })).toMatchObject({ ok: false });
    expect(await createCustomGoal(t.db, { ...base, title: 'X', targetRaw: '' })).toMatchObject({ ok: false });
    expect(await createCustomGoal(t.db, { ...base, title: 'X', targetRaw: 'abc' })).toMatchObject({ ok: false });
    expect(
      await createCustomGoal(t.db, { ...base, kind: 'habit', title: 'X', targetRaw: '3' }),
    ).toMatchObject({ ok: false });
    expect(await goalRepo.listGoals(t.db, true)).toHaveLength(0);
  });

  test('modèle guidé inséré : catégorie dérivée et persistée', async () => {
    await goalRepo.insertGoal(
      t.db,
      {
        id: 'g_alc',
        title: 'Alcool',
        kind: 'limit',
        unit: 'verres',
        weight: 1,
        status: 'active',
        templateId: 'alcohol_limit',
        sensitive: false,
        followWithoutXp: false,
        createdAt: '2026-02-01T00:00:00.000Z',
      },
      {
        id: 'gv_alc',
        goalId: 'g_alc',
        version: 1,
        tier: 'normal',
        targetValue: 2,
        scheduleKind: 'daily',
        weeklyTargetCount: null,
        notes: null,
        effectiveFrom: '2026-02-01',
        effectiveTo: null,
      },
    );
    const [g] = await goalRepo.listGoals(t.db);
    expect(g.categoryId).toBe('alcool');
  });

  test('modification de cible et archivage : catégorie, historique et règles XP inchangés', async () => {
    const r = await createCustomGoal(t.db, {
      title: 'Écran',
      kind: 'limit',
      unit: 'h',
      targetRaw: '2',
      tier: 'normal',
      categoryId: 'sans_ecran',
    });
    if (!r.ok) throw new Error(r.error);

    const day = new Date().toISOString().slice(0, 10);
    const conf = await confirmGoalDay(t.db, r.goalId, day, 'success', 1);
    expect(conf.xpGranted).toBeGreaterThan(0);
    expect(conf.xpGranted).toBeLessThanOrEqual(DAILY_XP_BUDGET);

    await scheduleVersionUpdate(t.db, r.goalId, day, { targetValue: 3 });
    let versions = await t.db.getAllAsync<{ version: number; target_value: number }>(
      `SELECT version, target_value FROM goal_versions WHERE goal_id = ? ORDER BY version`,
      r.goalId,
    );
    expect(versions.map((v) => v.target_value)).toEqual([2, 3]);

    await goalRepo.setGoalStatus(t.db, r.goalId, 'archived');
    expect(await goalRepo.listGoals(t.db)).toHaveLength(0);
    const [archived] = await goalRepo.listGoals(t.db, true);
    expect(archived.status).toBe('archived');
    expect(archived.categoryId).toBe('sans_ecran');
    const ev = await goalRepo.getTracking(t.db, r.goalId, day);
    expect(ev).toMatchObject({ status: 'success', value: 1 });
    versions = await t.db.getAllAsync(`SELECT version, target_value FROM goal_versions WHERE goal_id = ?`, r.goalId);
    expect(versions).toHaveLength(2);
  });

  test('règles XP inchangées (garde de non-régression)', () => {
    expect(DAILY_XP_BUDGET).toBe(50);
    expect(XP_RULE_VERSION).toBe('0.2.0');
  });
});
