import type { Db } from '../../data/db/client';
import * as goalRepo from '../../data/db/repositories/goalRepo';
import * as xpRepo from '../../data/db/repositories/xpRepo';
import * as rpgRepo from '../../data/db/repositories/rpgRepo';
import type { TrackingStatus } from '../models/types';
import {
  XP_RULE_VERSION,
  completionRatio,
  earnedXp,
  idempotencyKeyDailyGoal,
  potentialXpForGoals,
  shardsFromXpGrant,
} from '../rules/xp';
import { nowIso } from '../rules/dates';
import { createId } from '../../utils/id';

export interface ConfirmResult {
  xpGranted: number;
  shardsGranted: number;
  duplicate: boolean;
  status: TrackingStatus;
}

/**
 * Honest confirmation for a goal on a localDate.
 * Never invents success. Unknown days grant 0 XP.
 */
export async function confirmGoalDay(
  db: Db,
  goalId: string,
  localDate: string,
  status: TrackingStatus,
  value: number | null = null,
  note: string | null = null,
): Promise<ConfirmResult> {
  const goals = (await goalRepo.listGoals(db)).filter((g) => g.status === 'active');
  const goal = goals.find((g) => g.id === goalId);
  if (!goal) throw new Error('Objectif introuvable');

  const version = await goalRepo.getCurrentVersion(db, goalId);
  const eventId = createId('trk');
  const ts = nowIso();
  await goalRepo.upsertTracking(db, {
    id: eventId,
    goalId,
    localDate,
    status,
    value,
    note,
    createdAt: ts,
    updatedAt: ts,
  });

  if (status === 'unknown' || status === 'paused' || goal.followWithoutXp) {
    return { xpGranted: 0, shardsGranted: 0, duplicate: false, status };
  }

  const potentials = potentialXpForGoals(goals);
  const ratio = completionRatio(status, goal.kind, value, version?.targetValue ?? null);
  const xp = earnedXp(potentials[goalId] ?? 0, ratio);
  if (xp <= 0) {
    return { xpGranted: 0, shardsGranted: 0, duplicate: false, status };
  }

  const key = idempotencyKeyDailyGoal(goalId, localDate);
  let duplicate = false;
  let shards = 0;
  await db.withTransactionAsync(async () => {
    const result = await xpRepo.insertXp(db, {
      id: createId('xp'),
      sourceEventId: eventId,
      sourceRuleVersion: XP_RULE_VERSION,
      xpAmount: xp,
      reason: `Objectif « ${goal.title} » (${status})`,
      idempotencyKey: key,
      localDate,
      createdAt: nowIso(),
    });
    if (result === 'duplicate') {
      duplicate = true;
      return;
    }
    await xpRepo.refreshCharacterFromLedger(db);
    shards = shardsFromXpGrant(xp);
    await rpgRepo.addShards(db, shards, `shards from ${goalId} ${localDate}`, `shards:${key}`);
  });

  return { xpGranted: duplicate ? 0 : xp, shardsGranted: duplicate ? 0 : shards, duplicate, status };
}
