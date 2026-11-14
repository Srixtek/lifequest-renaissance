/** Local calendar helpers. Events store UTC ISO; goals use YYYY-MM-DD localDate. */

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatLocalDate(d: Date, timeZone?: string): string {
  // Use Intl so timezone travel is testable without depending on host TZ alone.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // en-CA yields YYYY-MM-DD
  return fmt.format(d);
}

export function localDateWithDayStart(
  now: Date,
  dayStartHour: number,
  timeZone?: string,
): string {
  const shifted = new Date(now.getTime() - dayStartHour * 60 * 60 * 1000);
  return formatLocalDate(shifted, timeZone);
}

export function addDays(localDate: string, days: number): string {
  const [y, m, d] = localDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

export function rangeDates(endInclusive: string, count: number): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) out.push(addDays(endInclusive, -i));
  return out;
}

export function nowIso(): string {
  return new Date().toISOString();
}
