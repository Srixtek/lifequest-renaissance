import type { Db } from '../../data/db/client';
import { migrate } from '../../data/db/client';

/**
 * Adaptateur de test : moteur SQLite RÉEL (module Node `node:sqlite`) derrière l'API expo-sqlite utilisée par l'app.
 * Ce n'est PAS le module natif expo-sqlite (indisponible sous Jest) : sémantique SQL, contraintes, triggers et
 * rollback sont réels ; le multi-connexion natif d'une transaction exclusive est émulé (file d'attente + BEGIN IMMEDIATE).
 * Une transaction imbriquée échoue (BEGIN dans BEGIN), comme en natif.
 */
export function nodeSqliteAvailable(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite');
    new DatabaseSync(':memory:').close();
    return true;
  } catch {
    return false;
  }
}

export interface TestDb {
  db: Db;
  raw: { exec(sql: string): void };
  close(): void;
}

export async function openNodeSqliteDb(path = ':memory:'): Promise<TestDb> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite');
  const conn = new DatabaseSync(path);
  conn.exec('PRAGMA foreign_keys = ON;');

  let queue: Promise<unknown> = Promise.resolve();

  const api = {
    async execAsync(sql: string) {
      conn.exec(sql);
    },
    async runAsync(sql: string, ...params: unknown[]) {
      const r = conn.prepare(sql).run(...flat(params));
      return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
    },
    async getFirstAsync(sql: string, ...params: unknown[]) {
      return conn.prepare(sql).get(...flat(params)) ?? null;
    },
    async getAllAsync(sql: string, ...params: unknown[]) {
      return conn.prepare(sql).all(...flat(params));
    },
    async withTransactionAsync(fn: () => Promise<void>) {
      conn.exec('BEGIN');
      try {
        await fn();
        conn.exec('COMMIT');
      } catch (err) {
        conn.exec('ROLLBACK');
        throw err;
      }
    },
    withExclusiveTransactionAsync(fn: (tx: unknown) => Promise<void>) {
      const run = async () => {
        conn.exec('BEGIN IMMEDIATE');
        try {
          await fn(api);
          conn.exec('COMMIT');
        } catch (err) {
          conn.exec('ROLLBACK');
          throw err;
        }
      };
      const p = queue.then(run, run);
      queue = p.catch(() => undefined);
      return p;
    },
  };

  const db = api as unknown as Db;
  await migrate(db);
  return { db, raw: conn, close: () => conn.close() };
}

function flat(params: unknown[]): unknown[] {
  return params.length === 1 && Array.isArray(params[0]) ? (params[0] as unknown[]) : params;
}
