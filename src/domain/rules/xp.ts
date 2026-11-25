import type { GoalDefinition, GoalKind, TrackingStatus } from '../models/types';

export const DAILY_XP_BUDGET = 50;
/** Whole XP budget expressed in centièmes (hundredths of XP). */
export const DAILY_XP_BUDGET_CENTI = 5000;
export const XP_RULE_VERSION = '0.2.0';
export const XP_PER_LEVEL = 100;
export const FIRST_TOOL_BONUS = 10;
export const CAMP_UPGRADE_SHARD_COST = 5;
export const QUEST_SHARD_REWARD = 2;

export type GoalXpPick = Pick<GoalDefinition, 'id' | 'weight' | 'followWithoutXp'>;

function clampWeight(weight: number): number {
  return Math.min(Math.max(weight, 0.1), 5);
}

/** Largest-remainder split; sum is exactly DAILY_XP_BUDGET_CENTI when eligible goals exist. */
export function allocateXpCenti(goals: GoalXpPick[]): Record<string, number> {
  const eligible = goals.filter((g) => !g.followWithoutXp && g.weight > 0);
  if (!eligible.length) return {};

  const weighted = eligible
    .map((g) => ({ id: g.id, w: clampWeight(g.weight) }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const sumW = weighted.reduce((acc, g) => acc + g.w, 0);
  if (sumW <= 0) return {};

  const parts = weighted.map((g) => {
    const exact = (DAILY_XP_BUDGET_CENTI * g.w) / sumW;
    const floor = Math.floor(exact);
    return { id: g.id, floor, remainder: exact - floor };
  });

  const out: Record<string, number> = {};
  let allocated = 0;
  for (const p of parts) {
    out[p.id] = p.floor;
    allocated += p.floor;
  }
  let toDistribute = DAILY_XP_BUDGET_CENTI - allocated;
  if (toDistribute > 0) {
    const order = [...parts].sort((a, b) => {
      if (b.remainder !== a.remainder) return b.remainder - a.remainder;
      return a.id.localeCompare(b.id);
    });
    for (let i = 0; i < toDistribute; i++) {
      out[order[i].id] += 1;
    }
  }
  return out;
}

/** Legacy float potentials for display/tests; derived from centi allocation. */
export function potentialXpForGoals(goals: GoalXpPick[]): Record<string, number> {
  const centi = allocateXpCenti(goals);
  const out: Record<string, number> = {};
  for (const [id, c] of Object.entries(centi)) {
    out[id] = c / 100;
  }
  return out;
}

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
    if (target != null && target === 0) {
      if (value === 0) return 1;
      return 0;
    }
    if (
      (kind === 'reduce' || kind === 'limit' || kind === 'quantity' || kind === 'duration') &&
      value != null &&
      target != null &&
      target > 0
    ) {
      if (kind === 'reduce' || kind === 'limit') {
        if (value <= target) return 1;
        return Math.max(0, Math.min(0.99, target / Math.max(value, 1)));
      }
      return Math.max(0, Math.min(1, value / target));
    }
    return 0.5;
  }
  return 0;
}

export function earnedXpCenti(potentialCenti: number, ratio: number): number {
  if (potentialCenti <= 0 || ratio <= 0) return 0;
  return Math.floor(potentialCenti * Math.min(1, Math.max(0, ratio)));
}

export function centiToXp(centi: number): number {
  return Math.round(centi) / 100;
}

export function earnedXp(potential: number, ratio: number): number {
  return centiToXp(earnedXpCenti(Math.round(potential * 100), ratio));
}

export function levelFromTotalXp(totalXp: number): number {
  return Math.max(1, Math.floor(totalXp / XP_PER_LEVEL) + 1);
}

/** @deprecated Per-goal shard grants removed in XP rules v0.2; kept for unrelated code paths. */
export function shardsFromXpGrant(xp: number): number {
  if (xp <= 0) return 0;
  return Math.max(1, Math.floor(xp / 10));
}

export function idempotencyKeyDailyGoal(goalId: string, localDate: string): string {
  return `daily-goal:${goalId}:${localDate}`;
}

export function idempotencyKeyDailyGoalRevision(
  goalId: string,
  localDate: string,
  revision: number,
): string {
  return `daily-goal-v3:${goalId}:${localDate}:r${revision}`;
}

export function idempotencyKeyDailyCheckin(localDate: string): string {
  return `daily-checkin:${localDate}`;
}

export function idempotencyKeyBonus(kind: string, subjectId: string): string {
  return `bonus:${kind}:${subjectId}`;
}

export function isExplicitTrackingStatus(status: TrackingStatus): boolean {
  return status !== 'unknown' && status !== 'paused';
}