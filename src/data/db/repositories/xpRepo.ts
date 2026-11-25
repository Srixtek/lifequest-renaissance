import type { SqlRunner } from '../sqlRunner';
import type { Db } from '../client';
import type { XpLedgerEntry } from '../../../domain/models/types';
import { levelFromTotalXp } from '../../../domain/rules/xp';

type Conn = Db | SqlRunner;

export async function findByIdempotency(db: Conn, key: string): Promise<XpLedgerEntry | null> {
  const r = await db.getFirstAsync<any>('SELECT * FROM xp_ledger WHERE idempotency_key = ?', key);
  return r ? map(r) : null;
}

export async function insertXp(db: Conn, e: XpLedgerEntry): Promise<'inserted' | 'duplicate'> {
  try {
    await db.runAsync(
      `INSERT INTO xp_ledger (id, source_event_id, source_rule_version, xp_amount, reason, idempotency_key, local_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      e.id,
      e.sourceEventId,
      e.sourceRuleVersion,
      e.xpAmount,
      e.reason,
      e.idempotencyKey,
      e.localDate,
      e.createdAt,
    );
    return 'inserted';
  } catch (err: unknown) {
    const msg = String((err as Error)?.message ?? err);
    if (msg.toLowerCase().includes('unique')) return 'duplicate';
    throw err;
  }
}

export async function sumXp(db: Conn): Promise<number> {
  const r = await db.getFirstAsync<{ s: number }>('SELECT COALESCE(SUM(xp_amount),0) as s FROM xp_ledger');
  return r?.s ?? 0;
}

export async function listXp(db: Conn): Promise<XpLedgerEntry[]> {
  const rows = await db.getAllAsync<any>('SELECT * FROM xp_ledger ORDER BY created_at');
  return rows.map(map);
}

export async function refreshCharacterFromLedger(db: Conn): Promise<void> {
  const total = await sumXp(db);
  const level = levelFromTotalXp(total);
  await db.runAsync('UPDATE character_progress SET total_xp = ?, level = ? WHERE id = 1', total, level);
}

function map(r: any): XpLedgerEntry {
  return {
    id: r.id,
    sourceEventId: r.source_event_id,
    sourceRuleVersion: r.source_rule_version,
    xpAmount: r.xp_amount,
    reason: r.reason,
    idempotencyKey: r.idempotency_key,
    localDate: r.local_date,
    createdAt: r.created_at,
  };
}