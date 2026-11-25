import type { Db } from '../../data/db/client';
import * as xpRepo from '../../data/db/repositories/xpRepo';
import * as rpgRepo from '../../data/db/repositories/rpgRepo';
import { FIRST_TOOL_BONUS, XP_RULE_VERSION, idempotencyKeyBonus } from '../rules/xp';
import { nowIso } from '../rules/dates';
import { createId } from '../../utils/id';

export async function recordBreathingSession(
  db: Db,
  durationSec: number,
  completed: boolean,
  opts?: { shortcut?: boolean },
): Promise<{ bonusXp: number }> {
  await db.runAsync(
    `INSERT INTO coping_sessions (id, kind, duration_sec, completed, meta_json, created_at)
     VALUES (?, 'breathing', ?, ?, ?, ?)`,
    createId('cope'),
    durationSec,
    completed ? 1 : 0,
    JSON.stringify(opts?.shortcut ? { pattern: '4-6', shortcut: true } : { pattern: '4-6' }),
    nowIso(),
  );

  if (!completed) return { bonusXp: 0 };

  const key = idempotencyKeyBonus('first_breathing', 'global');
  const existing = await xpRepo.findByIdempotency(db, key);
  if (existing) return { bonusXp: 0 };

  await xpRepo.insertXp(db, {
    id: createId('xp'),
    sourceEventId: null,
    sourceRuleVersion: XP_RULE_VERSION,
    xpAmount: FIRST_TOOL_BONUS,
    reason: 'Première session de respiration terminée',
    idempotencyKey: key,
    localDate: null,
    createdAt: nowIso(),
  });
  await xpRepo.refreshCharacterFromLedger(db);
  await rpgRepo.addShards(db, 1, 'first breathing', 'shards:first_breathing');
  return { bonusXp: FIRST_TOOL_BONUS };
}

/** Urge tool: no XP per urge logged — only first-ever use bonus. */
export async function recordUrgeSession(
  db: Db,
  durationSec: number,
  completed: boolean,
): Promise<{ bonusXp: number }> {
  await db.runAsync(
    `INSERT INTO coping_sessions (id, kind, duration_sec, completed, meta_json, created_at)
     VALUES (?, 'urge', ?, ?, ?, ?)`,
    createId('cope'),
    durationSec,
    completed ? 1 : 0,
    JSON.stringify({ defaultMinutes: 3 }),
    nowIso(),
  );

  if (!completed) return { bonusXp: 0 };
  const key = idempotencyKeyBonus('first_urge_tool', 'global');
  const existing = await xpRepo.findByIdempotency(db, key);
  if (existing) return { bonusXp: 0 };

  await xpRepo.insertXp(db, {
    id: createId('xp'),
    sourceEventId: null,
    sourceRuleVersion: XP_RULE_VERSION,
    xpAmount: FIRST_TOOL_BONUS,
    reason: 'Première utilisation de l\'outil envie',
    idempotencyKey: key,
    localDate: null,
    createdAt: nowIso(),
  });
  await xpRepo.refreshCharacterFromLedger(db);
  return { bonusXp: FIRST_TOOL_BONUS };
}

export async function addJournalEntry(db: Db, localDate: string, body: string, mood: number | null): Promise<void> {
  await db.runAsync(
    `INSERT INTO journal_entries (id, local_date, body, mood, created_at) VALUES (?, ?, ?, ?, ?)`,
    createId('jou'),
    localDate,
    body,
    mood,
    nowIso(),
  );
}

export async function listCoping(db: Db) {
  return db.getAllAsync<any>('SELECT * FROM coping_sessions ORDER BY created_at DESC LIMIT 50');
}
