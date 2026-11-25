import type { Db } from '../../data/db/client';
import type { SqlRunner } from '../../data/db/sqlRunner';
import * as goalRepo from '../../data/db/repositories/goalRepo';
import * as xpRepo from '../../data/db/repositories/xpRepo';
import * as rpgRepo from '../../data/db/repositories/rpgRepo';
import * as dailyRewardRepo from '../../data/db/repositories/dailyRewardRepo';
import type { GoalDefinition, TrackingStatus } from '../models/types';
import {
  XP_RULE_VERSION,
  centiToXp,
  completionRatio,
  earnedXpCenti,
  idempotencyKeyDailyCheckin,
  idempotencyKeyDailyGoalRevision,
  isExplicitTrackingStatus,
} from '../rules/xp';
import { nowIso } from '../rules/dates';
import { createId } from '../../utils/id';
import { statusFromLog } from '../rules/trackingStatus';

export interface ConfirmResult {
  xpGranted: number;
  xpDeltaCenti: number;
  shardsGranted: number;
  rewardUnchanged: boolean;
  duplicate: boolean;
  status: TrackingStatus;
  value: number | null;
  addedAfterSnapshot: boolean;
  legacyDay: boolean;
}

/** Save a numeric daily log and derive status. Empty input must not call this. */
export async function logGoalNumeric(
  db: Db,
  goalId: string,
  localDate: string,
  value: number,
  note: string | null = null,
): Promise<ConfirmResult> {
  const goals = (await goalRepo.listGoals(db)).filter((g) => g.status === 'active');
  const goal = goals.find((g) => g.id === goalId);
  if (!goal) throw new Error('Objectif introuvable');
  const version = await goalRepo.getCurrentVersion(db, goalId);
  const status = statusFromLog(goal, version, value);
  return confirmGoalDay(db, goalId, localDate, status, value, note);
}

/**
 * Honest confirmation for a goal on a localDate.
 * Unknown / paused never create a snapshot; they may reverse prior credited XP.
 */
export async function confirmGoalDay(
  db: Db,
  goalId: string,
  localDate: string,
  status: TrackingStatus,
  value: number | null = null,
  note: string | null = null,
): Promise<ConfirmResult> {
  const base: ConfirmResult = {
    xpGranted: 0,
    xpDeltaCenti: 0,
    shardsGranted: 0,
    rewardUnchanged: false,
    duplicate: false,
    status,
    value,
    addedAfterSnapshot: false,
    legacyDay: false,
  };

  const out = { ...base };

  await db.withExclusiveTransactionAsync(async (tx) => {
    const goals = (await goalRepo.listGoals(tx)).filter((g) => g.status === 'active');
    const goal = goals.find((g) => g.id === goalId);
    if (!goal) throw new Error('Objectif introuvable');

    const version = await goalRepo.getCurrentVersion(tx, goalId);
    const prior = await goalRepo.getTracking(tx, goalId, localDate);
    const eventId = prior?.id ?? createId('trk');
    const ts = nowIso();

    await goalRepo.upsertTracking(tx, {
      id: eventId,
      goalId,
      localDate,
      status,
      value,
      note,
      createdAt: prior?.createdAt ?? ts,
      updatedAt: ts,
    });

    const legacy = await dailyRewardRepo.detectAndMarkLegacyDay(tx, localDate);
    if (legacy) {
      out.legacyDay = true;
      return;
    }

    const explicit = isExplicitTrackingStatus(status);

    if (!explicit) {
      if (goal.followWithoutXp) return;
      const goalRow = await dailyRewardRepo.getGoalRow(tx, localDate, goalId);
      if (!goalRow) return;
      const deltaCenti = 0 - goalRow.creditedCenti;
      if (deltaCenti === 0) {
        out.rewardUnchanged = true;
        return;
      }
      await applyGoalXpDelta(tx, {
        goal,
        status,
        eventId,
        localDate,
        goalRow,
        expectedCenti: 0,
        deltaCenti,
        out,
      });
      return;
    }

    const hadSnapshotBefore = !!(await dailyRewardRepo.getDay(tx, localDate));
    if (!hadSnapshotBefore) {
      await dailyRewardRepo.createSnapshot(tx, localDate, goals);
    }

    const checkinKey = idempotencyKeyDailyCheckin(localDate);
    const shardOk = await rpgRepo.addShards(tx, 1, `Participation ${localDate}`, checkinKey);
    if (shardOk) out.shardsGranted = 1;

    if (goal.followWithoutXp) return;

    const goalRow = await dailyRewardRepo.getGoalRow(tx, localDate, goalId);
    if (!goalRow) {
      out.addedAfterSnapshot = hadSnapshotBefore;
      return;
    }

    const ratio = completionRatio(status, goal.kind, value, version?.targetValue ?? null);
    const expectedCenti = earnedXpCenti(goalRow.potentialCenti, ratio);
    const deltaCenti = expectedCenti - goalRow.creditedCenti;

    if (deltaCenti === 0) {
      out.rewardUnchanged = true;
      return;
    }

    await applyGoalXpDelta(tx, {
      goal,
      status,
      eventId,
      localDate,
      goalRow,
      expectedCenti,
      deltaCenti,
      out,
    });
  });

  return out;
}

async function applyGoalXpDelta(
  tx: SqlRunner,
  ctx: {
    goal: GoalDefinition;
    status: TrackingStatus;
    eventId: string;
    localDate: string;
    goalRow: dailyRewardRepo.DailyRewardGoalRow;
    expectedCenti: number;
    deltaCenti: number;
    out: ConfirmResult;
  },
): Promise<void> {
  const { goal, status, eventId, localDate, goalRow, expectedCenti, deltaCenti, out } = ctx;
  const newRevision = goalRow.revision + 1;
  const idemKey = idempotencyKeyDailyGoalRevision(goal.id, localDate, newRevision);
  const insertResult = await xpRepo.insertXp(tx, {
    id: createId('xp'),
    sourceEventId: eventId,
    sourceRuleVersion: XP_RULE_VERSION,
    xpAmount: centiToXp(deltaCenti),
    reason:
      deltaCenti > 0
        ? `Objectif « ${goal.title} » (${status})`
        : `Ajustement XP « ${goal.title} » (${status})`,
    idempotencyKey: idemKey,
    localDate,
    createdAt: nowIso(),
  });

  if (insertResult === 'duplicate') {
    out.duplicate = true;
    return;
  }

  await dailyRewardRepo.applyCreditedCenti(tx, localDate, goal.id, expectedCenti, newRevision);
  await xpRepo.refreshCharacterFromLedger(tx);
  out.xpDeltaCenti = deltaCenti;
  out.xpGranted = centiToXp(deltaCenti);
}