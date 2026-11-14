import type { GoalDefinition, GoalKind, TrackingStatus } from '../models/types';

export const DAILY_XP_BUDGET = 50;
export const XP_RULE_VERSION = '0.1.0';
export const XP_PER_LEVEL = 100;
export const FIRST_TOOL_BONUS = 10;
export const CAMP_UPGRADE_SHARD_COST = 5;
export const QUEST_SHARD_REWARD = 2;

/** Completion ratio in [0,1] from tracking status / kind. */
export function completionRatio(
  status: TrackingStatus,
  kind: GoalKind,
  value: number | null,
  target: number | null,
): number {
  if (status === 'unknown' || status === 'paused') return 0;
  if (status === 'miss') return 0;
  if (status === 'success') return 1;
  if (status === 'partial') {
    if (
      (kind === 'reduce' || kind === 'limit' || kind === 'quantity' || kind === 'duration') &&
      value != null &&
      target != null &&
      target > 0
    ) {
      // For reduce/limit: lower is better when target is a max.
      if (kind === 'reduce' || kind === 'limit') {
        if (value <= target) return 1;
        // Over target: degrade gently but never invent success.
        return Math.max(0, Math.min(0.99, target / Math.max(value, 1)));
      }
      return Math.max(0, Math.min(1, value / target));
    }
    return 0.5;
  }
  return 0;
}

export function potentialXpForGoals(
  goals: Array<Pick<GoalDefinition, 'id' | 'weight' | 'followWithoutXp'>>,
): Record<string, number> {
  const eligible = goals.filter((g) => !g.followWithoutXp && g.weight > 0);
  const sum = eligible.reduce((acc, g) => acc + Math.min(Math.max(g.weight, 0.1), 5), 0);
  const out: Record<string, number> = {};
  if (sum <= 0) return out;
  for (const g of eligible) {
    const w = Math.min(Math.max(g.weight, 0.1), 5);
    out[g.id] = (DAILY_XP_BUDGET * w) / sum;
  }
  return out;
}

export function earnedXp(potential: number, ratio: number): number {
  if (potential <= 0 || ratio <= 0) return 0;
  return Math.round(potential * Math.min(1, Math.max(0, ratio)) * 100) / 100;
}

export function levelFromTotalXp(totalXp: number): number {
  return Math.max(1, Math.floor(totalXp / XP_PER_LEVEL) + 1);
}

export function shardsFromXpGrant(xp: number): number {
  if (xp <= 0) return 0;
  return Math.max(1, Math.floor(xp / 10));
}

export function idempotencyKeyDailyGoal(goalId: string, localDate: string): string {
  return `daily-goal:${goalId}:${localDate}`;
}

export function idempotencyKeyBonus(kind: string, subjectId: string): string {
  return `bonus:${kind}:${subjectId}`;
}
