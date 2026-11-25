import type { Db } from '../client';
import type { SqlRunner } from '../sqlRunner';
import type { GoalDefinition } from '../../../domain/models/types';
import { XP_RULE_VERSION, allocateXpCenti } from '../../../domain/rules/xp';
import { nowIso } from '../../../domain/rules/dates';

function clampWeight(weight: number): number {
  return Math.min(Math.max(weight, 0.1), 5);
}

export interface DailyRewardDay {
  localDate: string;
  ruleVersion: string;
  snapshotAt: string;
  legacy: boolean;
}

export interface DailyRewardGoalRow {
  localDate: string;
  goalId: string;
  weight: number;
  potentialCenti: number;
  creditedCenti: number;
  revision: number;
}

export async function getDay(db: SqlRunner, localDate: string): Promise<DailyRewardDay | null> {
  const r = await db.getFirstAsync<any>('SELECT * FROM daily_reward_days WHERE local_date = ?', localDate);
  if (!r) return null;
  return {
    localDate: r.local_date,
    ruleVersion: r.rule_version,
    snapshotAt: r.snapshot_at,
    legacy: !!r.legacy,
  };
}

export async function getGoalRow(
  db: SqlRunner,
  localDate: string,
  goalId: string,
): Promise<DailyRewardGoalRow | null> {
  const r = await db.getFirstAsync<any>(
    'SELECT * FROM daily_reward_goals WHERE local_date = ? AND goal_id = ?',
    localDate,
    goalId,
  );
  if (!r) return null;
  return mapGoalRow(r);
}

function mapGoalRow(r: any): DailyRewardGoalRow {
  return {
    localDate: r.local_date,
    goalId: r.goal_id,
    weight: r.weight,
    potentialCenti: r.potential_centi,
    creditedCenti: r.credited_centi,
    revision: r.revision,
  };
}

/** Day had legacy v0.1 daily-goal ledger entries and no v3 snapshot yet. */
export async function detectAndMarkLegacyDay(db: SqlRunner, localDate: string): Promise<boolean> {
  const day = await getDay(db, localDate);
  if (day?.legacy) return true;
  if (day && !day.legacy) return false;

  const legacyXp = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) as c FROM xp_ledger
     WHERE local_date = ? AND idempotency_key LIKE 'daily-goal:%' AND idempotency_key NOT LIKE 'daily-goal-v3:%'`,
    localDate,
  );
  if ((legacyXp?.c ?? 0) === 0) return false;

  await db.runAsync(
    `INSERT INTO daily_reward_days (local_date, rule_version, snapshot_at, legacy)
     VALUES (?, ?, ?, 1)
     ON CONFLICT(local_date) DO UPDATE SET legacy = 1`,
    localDate,
    '0.1.0',
    nowIso(),
  );
  return true;
}

export async function createSnapshot(
  tx: SqlRunner,
  localDate: string,
  activeGoals: GoalDefinition[],
): Promise<void> {
  const existing = await getDay(tx, localDate);
  if (existing) return;

  const eligible = activeGoals.filter((g) => g.status === 'active' && !g.followWithoutXp && g.weight > 0);
  const allocations = allocateXpCenti(eligible);
  const ts = nowIso();

  await tx.runAsync(
    `INSERT INTO daily_reward_days (local_date, rule_version, snapshot_at, legacy)
     VALUES (?, ?, ?, 0)`,
    localDate,
    XP_RULE_VERSION,
    ts,
  );

  for (const g of eligible) {
    const potentialCenti = allocations[g.id] ?? 0;
    if (potentialCenti <= 0) continue;
    await tx.runAsync(
      `INSERT INTO daily_reward_goals (local_date, goal_id, weight, potential_centi, credited_centi, revision)
       VALUES (?, ?, ?, ?, 0, 0)`,
      localDate,
      g.id,
      clampWeight(g.weight),
      potentialCenti,
    );
  }
}

export async function applyCreditedCenti(
  tx: SqlRunner,
  localDate: string,
  goalId: string,
  newCreditedCenti: number,
  newRevision: number,
): Promise<void> {
  await tx.runAsync(
    `UPDATE daily_reward_goals SET credited_centi = ?, revision = ? WHERE local_date = ? AND goal_id = ?`,
    newCreditedCenti,
    newRevision,
    localDate,
    goalId,
  );
}