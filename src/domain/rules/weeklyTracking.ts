import type { TrackingEvent } from '../models/types';
import { addDays } from './dates';

/** Local-date week Monday–Sunday containing `localDate` (YYYY-MM-DD). */
export function weekBoundsMondaySunday(localDate: string): { start: string; end: string } {
  const [y, m, d] = localDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const start = addDays(localDate, mondayOffset);
  const end = addDays(start, 6);
  return { start, end };
}

/** Successful days in range (at most one count per localDate). */
export function countWeeklySuccessDays(
  events: Pick<TrackingEvent, 'localDate' | 'status'>[],
  start: string,
  end: string,
): number {
  const seen = new Set<string>();
  let count = 0;
  for (const e of events) {
    if (e.localDate < start || e.localDate > end) continue;
    if (e.status !== 'success') continue;
    if (seen.has(e.localDate)) continue;
    seen.add(e.localDate);
    count += 1;
  }
  return count;
}

export function formatWeeklyProgress(done: number, target: number): string {
  return `${done}/${target} jours avec appel cette semaine`;
}