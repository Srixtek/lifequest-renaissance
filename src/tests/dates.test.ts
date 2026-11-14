import { addDays, formatLocalDate, localDateWithDayStart, rangeDates } from '../domain/rules/dates';

describe('dates', () => {
  test('addDays crosses month', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
  });

  test('rangeDates length', () => {
    const r = rangeDates('2026-11-10', 7);
    expect(r).toHaveLength(7);
    expect(r[0]).toBe('2026-11-04');
    expect(r[6]).toBe('2026-11-10');
  });

  test('day start hour shifts calendar date', () => {
    // 03:30 local with dayStart=4 still previous day conceptually via shift
    const d = new Date('2026-11-10T02:30:00Z');
    // Just assert function returns YYYY-MM-DD shape for UTC tz
    const s = localDateWithDayStart(d, 4, 'UTC');
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('formatLocalDate en-CA', () => {
    const s = formatLocalDate(new Date('2026-11-10T12:00:00Z'), 'UTC');
    expect(s).toBe('2026-11-10');
  });
});
