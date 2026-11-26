import type { SqlRunner } from '../../data/db/sqlRunner';
import type { Db } from '../../data/db/client';
import { nowIso } from '../rules/dates';
import { createId } from '../../utils/id';

type Conn = Db | SqlRunner;

/** Enregistre une séance respiration (sans bonus XP outil — évite double comptage avec les quêtes). */
export async function recordBreathingSessionOnConn(
  conn: Conn,
  durationSec: number,
  completed: boolean,
  opts?: { vapeAttemptId?: string; shortcut?: boolean },
): Promise<{ copingSessionId: string }> {
  const id = createId('cope');
  const meta: Record<string, unknown> = { pattern: '4-6' };
  if (opts?.vapeAttemptId) meta.vapeAttemptId = opts.vapeAttemptId;
  if (opts?.shortcut) meta.shortcut = true;
  await conn.runAsync(
    `INSERT INTO coping_sessions (id, kind, duration_sec, completed, meta_json, created_at)
     VALUES (?, 'breathing', ?, ?, ?, ?)`,
    id,
    Math.max(0, Math.floor(durationSec)),
    completed ? 1 : 0,
    JSON.stringify(meta),
    nowIso(),
  );
  return { copingSessionId: id };
}