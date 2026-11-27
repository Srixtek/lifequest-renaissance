import type { Db } from '../../data/db/client';
import type { SqlRunner } from '../../data/db/sqlRunner';
import { RENEWABLE_GOLD_DAILY_CAP } from '../../data/content/renewableQuestTemplates';

type Conn = Db | SqlRunner;

/**
 * Plafond d'or journalier PARTAGÉ : quêtes renouvelables, tracker vape (paliers/records)
 * et or des défis vape adaptatifs. Une seule économie, une seule limite.
 */
export const SHARED_DAILY_GOLD_CAP = RENEWABLE_GOLD_DAILY_CAP;

export function utcDayStart(now: Date = new Date()): string {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function getSharedGoldEarnedToday(db: Conn, dayStartIso: string): Promise<number> {
  const r = await db.getFirstAsync<{ s: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS s FROM wallet_ledger
     WHERE resource = 'gold' AND amount > 0
       AND (idempotency_key LIKE 'renewable:%' OR idempotency_key LIKE 'vape:%' OR idempotency_key LIKE 'adaptive:vape:%')
       AND created_at >= ?`,
    dayStartIso,
  );
  return Number(r?.s ?? 0);
}

export async function sharedGoldRemainingToday(db: Conn, now: Date = new Date()): Promise<number> {
  const earned = await getSharedGoldEarnedToday(db, utcDayStart(now));
  return Math.max(0, SHARED_DAILY_GOLD_CAP - earned);
}
