import { addDays } from '../domain/rules/dates';

describe('deferred target — rules', () => {
  test('new version applies from tomorrow', () => {
    const today = '2025-11-26';
    expect(addDays(today, 1)).toBe('2025-11-27');
  });

  test('closed version ends today', () => {
    const today = '2025-12-31';
    const next = addDays(today, 1);
    expect(next).toBe('2026-01-01');
  });
});