/** Ensures v0.2 tables are part of backup manifest (no native FS in unit tests). */

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: '/tmp/',
  documentDirectory: '/tmp/',
  EncodingType: { Base64: 'base64' },
  writeAsStringAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
}));

import { exportBackup } from '../domain/services/backupService';

describe('backup v0.2 tables', () => {
  test('export includes daily_reward tables when present', async () => {
    const db = {
      getAllAsync: jest.fn(async (sql: string) => {
        if (sql.includes('daily_reward_days')) return [];
        if (sql.includes('daily_reward_goals')) return [];
        if (sql.includes('xp_ledger')) return [];
        if (sql.includes('profiles')) return [{ pseudo: 'test' }];
        return [];
      }),
      runAsync: jest.fn(),
    } as any;
    await exportBackup(db, '0.2.0');
    const calls = (db.getAllAsync as jest.Mock).mock.calls.map((c) => c[0]);
    expect(calls.some((s: string) => s.includes('daily_reward_days'))).toBe(true);
    expect(calls.some((s: string) => s.includes('daily_reward_goals'))).toBe(true);
    expect(calls.some((s: string) => s.includes('challenge_sessions'))).toBe(true);
  });
});