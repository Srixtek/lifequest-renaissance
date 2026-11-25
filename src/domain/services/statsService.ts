import type { Db } from '../../data/db/client';
import * as goalRepo from '../../data/db/repositories/goalRepo';
import { addDays, rangeDates } from '../rules/dates';

export interface DayPoint {
  date: string;
  status: string;
  value: number | null;
}

export interface GoalStats {
  goalId: string;
  title: string;
  points: DayPoint[];
  covered: number;
  window: number;
  coverageRatio: number;
  successCount: number;
  followWithoutXp: boolean;
}

export async function goalChart(
  db: Db,
  goalId: string,
  endDate: string,
  window: 7 | 30,
): Promise<GoalStats> {
  const goals = await goalRepo.listGoals(db, true);
  const goal = goals.find((g) => g.id === goalId);
  const dates = rangeDates(endDate, window);
  const from = dates[0];
  const events = await goalRepo.listTrackingInRange(db, goalId, from, endDate);
  const byDate = new Map(events.map((e) => [e.localDate, e]));
  const points: DayPoint[] = dates.map((d) => {
    const e = byDate.get(d);
    return { date: d, status: e?.status ?? 'unknown', value: e?.value ?? null };
  });
  const covered = points.filter((p) => p.status !== 'unknown').length;
  const measure = !!goal?.followWithoutXp;
  const successCount = measure ? 0 : points.filter((p) => p.status === 'success').length;
  return {
    goalId,
    title: goal?.title ?? goalId,
    points,
    covered,
    window,
    coverageRatio: covered / window,
    successCount,
    followWithoutXp: measure,
  };
}

export function coverageLabel(stats: GoalStats): string {
  return `${stats.covered}/${stats.window} jours renseignés (${Math.round(stats.coverageRatio * 100)} %)`;
}

export function baselineReady(stats: GoalStats): boolean {
  // Evidence decision: ≥7 days entered over ≥14-day window and coverage ≥70%.
  if (stats.window < 14) return false;
  return stats.covered >= 7 && stats.coverageRatio >= 0.7;
}

export { addDays };
