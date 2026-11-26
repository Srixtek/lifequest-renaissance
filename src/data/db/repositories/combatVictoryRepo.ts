import type { Db } from '../client';
import type { SqlRunner } from '../sqlRunner';
import { createId } from '../../../utils/id';

type Conn = Db | SqlRunner;

export async function logCombatOutcome(
  db: Conn,
  enemyId: string,
  outcome: 'victory' | 'defeat',
  foughtAt: string,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO combat_victory_log (id, enemy_id, outcome, fought_at) VALUES (?, ?, ?, ?)`,
    createId('cbt'),
    enemyId,
    outcome,
    foughtAt,
  );
}

export async function countVictoriesAfter(db: Conn, enemyId: string, afterIso: string): Promise<number> {
  const r = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) AS c FROM combat_victory_log WHERE enemy_id = ? AND outcome = 'victory' AND fought_at >= ?`,
    enemyId,
    afterIso,
  );
  return Number(r?.c ?? 0);
}