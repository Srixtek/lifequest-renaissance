import type { Db } from '../../data/db/client';
import * as adaptiveRepo from '../../data/db/repositories/adaptiveChallengeRepo';
import * as goalRepo from '../../data/db/repositories/goalRepo';
import * as rpgRepo from '../../data/db/repositories/rpgRepo';
import {
  VAPE_BREATHING_SECONDS,
  VAPE_TIER_COUNT,
  VAPE_TIER_GOLD_REWARD,
  delayMinutesForTier,
  intervalMinutesForTier,
  nextTierObjectiveMinutes,
  vapeChallengeDef,
} from '../content/vapeChallengeDefs';
import type {
  AdaptiveChallengeAttempt,
  AdaptiveChallengeRecord,
  AdaptiveChallengeState,
  VapeChallengeFormat,
} from '../models/adaptiveChallenge';
import { VAPE_HABIT_CATEGORY } from '../models/adaptiveChallenge';
import { informedOutcomesFromAttempts, suggestTierIndex } from '../rules/adaptiveTier';
import {
  closeChallengeSessionOnConn,
  completeVapeChallengeOnConn,
  interruptVapeChallengeOnConn,
  startChallengeSessionOnConn,
} from './challengeService';
import { nowIso } from '../rules/dates';
import { createId } from '../../utils/id';

export type StartAdaptiveResult =
  | { ok: true; attempt: AdaptiveChallengeAttempt }
  | { ok: false; code: 'category_inactive' | 'already_running' | 'session_busy' };

export type CloseAdaptiveResult =
  | { ok: true; attempt: AdaptiveChallengeAttempt; tierMessage: string | null; goldGranted: boolean }
  | { ok: false; code: 'not_running' | 'not_found' | 'already_closed' | 'session_error' };

export interface VapeAdaptiveDashboard {
  vapeActive: boolean;
  state: AdaptiveChallengeState;
  running: AdaptiveChallengeAttempt | null;
  recommended: VapeChallengeFormat[];
  nextTierMinutes: number | null;
  record: AdaptiveChallengeRecord | null;
  history: AdaptiveChallengeAttempt[];
}

function targetSecForFormat(format: VapeChallengeFormat, tierIndex: number): number | null {
  if (format === 'delay_craving') return delayMinutesForTier(tierIndex) * 60;
  if (format === 'breathing') return VAPE_BREATHING_SECONDS;
  if (format === 'interval') return intervalMinutesForTier(tierIndex) * 60;
  return null;
}

async function vapeGoalActive(db: Db): Promise<boolean> {
  const g = await goalRepo.findActiveByTemplateId(db, 'vape_sessions');
  return g != null && g.status !== 'archived' && g.status !== 'paused';
}

export async function getVapeAdaptiveDashboard(db: Db): Promise<VapeAdaptiveDashboard> {
  const vapeActive = await vapeGoalActive(db);
  const state = await adaptiveRepo.getOrInitState(db, VAPE_HABIT_CATEGORY);
  const running = await adaptiveRepo.getRunningAttempt(db, VAPE_HABIT_CATEGORY);
  const record = await adaptiveRepo.getRecord(db, VAPE_HABIT_CATEGORY, 'record');
  const history = await adaptiveRepo.listRecentAttempts(db, VAPE_HABIT_CATEGORY, 10);
  const recommended: VapeChallengeFormat[] = vapeActive
    ? ['delay_craving', 'breathing', 'interval', 'record']
    : [];
  return {
    vapeActive,
    state,
    running,
    recommended,
    nextTierMinutes: nextTierObjectiveMinutes(state.tierIndex),
    record,
    history,
  };
}

export async function setManualVapeTier(db: Db, tierIndex: number): Promise<AdaptiveChallengeState> {
  const clamped = Math.max(0, Math.min(tierIndex, VAPE_TIER_COUNT - 1));
  const now = nowIso();
  await db.withExclusiveTransactionAsync(async (tx) => {
    await adaptiveRepo.getOrInitState(tx, VAPE_HABIT_CATEGORY);
    await adaptiveRepo.updateStateTier(tx, VAPE_HABIT_CATEGORY, clamped, true, now);
  });
  return (await adaptiveRepo.getOrInitState(db, VAPE_HABIT_CATEGORY));
}

export async function startVapeAdaptiveChallenge(
  db: Db,
  format: VapeChallengeFormat,
): Promise<StartAdaptiveResult> {
  let result: StartAdaptiveResult = { ok: false, code: 'category_inactive' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    if (!(await vapeGoalActive(tx))) {
      result = { ok: false, code: 'category_inactive' };
      return;
    }
    const running = await adaptiveRepo.getRunningAttempt(tx, VAPE_HABIT_CATEGORY);
    if (running) {
      result = { ok: false, code: 'already_running' };
      return;
    }
    const state = await adaptiveRepo.getOrInitState(tx, VAPE_HABIT_CATEGORY);
    const now = nowIso();
    const targetSec = targetSecForFormat(format, state.tierIndex);
    const sessionRes = await startChallengeSessionOnConn(tx, 'no_vape', targetSec);
    if (!sessionRes.ok) {
      result = { ok: false, code: 'session_busy' };
      return;
    }
    const attempt: AdaptiveChallengeAttempt = {
      id: createId('avad'),
      habitCategory: VAPE_HABIT_CATEGORY,
      format,
      tierIndex: state.tierIndex,
      outcome: 'running',
      challengeSessionId: sessionRes.session.id,
      targetDurationSec: targetSec,
      declaredDurationSec: null,
      startedAt: now,
      endedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await adaptiveRepo.insertAttempt(tx, attempt);
    result = { ok: true, attempt };
  });
  return result;
}

async function applyTierAfterClose(
  tx: Db,
  attempt: AdaptiveChallengeAttempt,
): Promise<string | null> {
  const state = await adaptiveRepo.getOrInitState(tx, VAPE_HABIT_CATEGORY);
  if (state.tierManual) return null;
  const raw = await adaptiveRepo.listInformedOutcomes(tx, VAPE_HABIT_CATEGORY, 12);
  const informed = informedOutcomesFromAttempts(raw);
  const suggestion = suggestTierIndex(state.tierIndex, informed, VAPE_TIER_COUNT - 1);
  if (suggestion.tierIndex !== state.tierIndex) {
    await adaptiveRepo.updateStateTier(
      tx,
      VAPE_HABIT_CATEGORY,
      suggestion.tierIndex,
      false,
      nowIso(),
    );
  }
  return suggestion.adjusted ? suggestion.message : null;
}

async function maybeGrantTierGold(
  tx: Db,
  attempt: AdaptiveChallengeAttempt,
  success: boolean,
): Promise<boolean> {
  if (!success) return false;
  const key = `adaptive:vape:tier:${attempt.tierIndex}:gold`;
  const r = await rpgRepo.addGold(
    tx,
    VAPE_TIER_GOLD_REWARD,
    `Palier vape ${attempt.tierIndex + 1} confirmé`,
    key,
  );
  return r === 'inserted';
}

function successFromSession(
  format: VapeChallengeFormat,
  durationSec: number,
  targetSec: number | null,
  completed: boolean,
): boolean {
  if (!completed) return false;
  if (format === 'record') return true;
  if (targetSec == null) return false;
  return durationSec >= targetSec;
}

export async function closeVapeAdaptiveChallenge(
  db: Db,
  attemptId: string,
  mode: 'completed' | 'vaped' | 'unknown',
): Promise<CloseAdaptiveResult> {
  let result: CloseAdaptiveResult = { ok: false, code: 'not_found' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const attempt = await adaptiveRepo.getAttemptById(tx, attemptId);
    if (!attempt || attempt.outcome !== 'running') {
      result = { ok: false, code: attempt ? 'already_closed' : 'not_found' };
      return;
    }
    if (!attempt.challengeSessionId) {
      result = { ok: false, code: 'session_error' };
      return;
    }
    const sessionClose =
      mode === 'vaped'
        ? await interruptVapeChallengeOnConn(tx, attempt.challengeSessionId)
        : mode === 'completed'
          ? await completeVapeChallengeOnConn(tx, attempt.challengeSessionId)
          : await closeChallengeSessionOnConn(tx, attempt.challengeSessionId, 'interrupted');

    if (!sessionClose.ok) {
      result = { ok: false, code: 'session_error' };
      return;
    }
    const durationSec = Math.max(0, sessionClose.session.durationSec);
    const completed = sessionClose.session.state === 'completed';
    const success =
      mode === 'unknown'
        ? false
        : successFromSession(attempt.format, durationSec, attempt.targetDurationSec, completed);
    const outcome = mode === 'unknown' ? 'unknown' : success ? 'success' : 'failure';
    const ended = nowIso();
    const closed = await adaptiveRepo.closeAttempt(tx, attemptId, {
      outcome,
      declaredDurationSec: durationSec,
      endedAt: ended,
      updatedAt: ended,
    });
    if (!closed) {
      result = { ok: false, code: 'already_closed' };
      return;
    }
    if (success && (attempt.format === 'record' || attempt.format === 'interval')) {
      await adaptiveRepo.upsertRecordIfBetter(tx, {
        habitCategory: VAPE_HABIT_CATEGORY,
        format: attempt.format === 'record' ? 'record' : attempt.format,
        bestDurationSec: durationSec,
        attemptId,
        achievedAt: ended,
      });
    }
    const updated = (await adaptiveRepo.getAttemptById(tx, attemptId))!;
    const tierMessage = await applyTierAfterClose(tx, updated);
    const goldGranted = await maybeGrantTierGold(tx, updated, success);
    result = { ok: true, attempt: updated, tierMessage, goldGranted };
  });
  return result;
}

export function formatDefLabel(format: VapeChallengeFormat): string {
  return vapeChallengeDef(format).title;
}