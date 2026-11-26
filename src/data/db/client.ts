import * as SQLite from 'expo-sqlite';
import migration001 from './migrations/001_initial';
import migration002 from './migrations/002_content_seed';
import migration003 from './migrations/003_daily_rewards';
import migration004 from './migrations/004_challenge_sessions';
import migration005 from './migrations/005_quest_board';
import migration006 from './migrations/006_adaptive_challenges';
import migration007 from './migrations/007_vape_reliability';
import migration008 from './migrations/008_kingdom_bastion';
import migration009 from './migrations/009_combat_v2';

export type Db = SQLite.SQLiteDatabase;

const MIGRATIONS: Array<{ version: number; sql: string }> = [
  { version: 1, sql: migration001 },
  { version: 2, sql: migration002 },
  { version: 3, sql: migration003 },
  { version: 4, sql: migration004 },
  { version: 5, sql: migration005 },
  { version: 6, sql: migration006 },
  { version: 7, sql: migration007 },
  { version: 8, sql: migration008 },
  { version: 9, sql: migration009 },
];

let dbPromise: Promise<Db> | null = null;

export async function getDb(): Promise<Db> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('lifequest.db');
      await db.execAsync('PRAGMA foreign_keys = ON;');
      await migrate(db);
      return db;
    })();
  }
  return dbPromise;
}

/** Test helper: open an in-memory DB with migrations applied. */
export async function openMemoryDb(): Promise<Db> {
  const db = await SQLite.openDatabaseAsync(':memory:');
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await migrate(db);
  return db;
}

export async function migrate(db: Db): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  const rows = await db.getAllAsync<{ version: number }>('SELECT version FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.version));
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    await db.withTransactionAsync(async () => {
      await db.execAsync(m.sql);
      await db.runAsync(
        'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
        m.version,
        new Date().toISOString(),
      );
    });
  }
}

export async function resetDbForTests(): Promise<void> {
  dbPromise = null;
}
