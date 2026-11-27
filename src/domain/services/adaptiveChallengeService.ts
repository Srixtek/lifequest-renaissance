import type { Db } from '../../data/db/client';
import * as adaptiveRepo from '../../data/db/repositories/adaptiveChallengeRepo';
import * as goalRepo from '../../data/db/repositories/goalRepo';
import * as rpgRepo from '../../data/db/repositories/rpgRepo';
import {
  VAPE_BREATHING_SECONDS,
  VAPE_TIER_COUNT,
  VAPE_TIER_GOLD_REWARD,
  delayMinutesForTier,
  highestRecordMilestoneMinutes,
  intervalMinutesForTier,
  nextTierObjectiveMinutes,
  vapeChallengeDef,
} from '../content/vapeChallengeDefs';
import type {
  AdaptiveChallengeAttempt,
  AdaptiveChallengeRecord,
  AdaptiveChallengeState,
  VapeChallengeFormat,
  VapeTierTrack,
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
import { recordBreathingSessionOnConn } from './vapeBreathingSession';
import * as vapeMainRepo from '../../data/db/repositories/vapeMainRepo';
import { sharedGoldRemainingToday } from './goldDailyCap';

export type StartAdaptiveResult =
  | { ok: true; attempt: AdaptiveChallengeAttempt }
  | { ok: false; code: 'category_inactive' | 'already_running' | 'session_busy' | 'main_chrono_active' };

export type CloseAdaptiveResult =
  | { ok: true; attempt: AdaptiveChallengeAttempt; tierMessage: string | null; goldGranted: boolean }
  | { ok: false; code: 'not_running' | 'not_found' | 'already_closed' | 'session_error' };

export interface VapeAdaptiveDashboard {
  vapeActive: boolean;
  state: AdaptiveChallengeState;
  running: AdaptiveChallengeAttempt | null;
  recommended: VapeChallengeFormat[];
  nextTierMinutes: number | null;
  nextIntervalTierMinutes: number | null;
  record: AdaptiveChallengeRecord | null;
  history: AdaptiveChallengeAttempt[];
}

function tierIndexForFormat(state: AdaptiveChallengeState, format: VapeChallengeFormat): number {
  if (format === 'interval') return state.tierIndexInterval;
  if (format === 'delay_craving') return state.tierIndex;
  return 0;
}

function targetSecForFormat(format: VapeChallengeFormat, tierIndex: number): number | null {
  if (format === 'delay_craving') return delayMinutesForTier(tierIndex) * 60;
  if (format === 'breathing') return VAPE_BREATHING_SECONDS;
  if (format === 'interval') return intervalMinutesForTier(tierIndex) * 60;
  return null;
}

function tierTrackForFormat(format: VapeChallengeFormat): VapeTierTrack | null {
  if (format === 'delay_craving') return 'delay';
  if (format === 'interval') return 'interval';
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
  const nextInterval = state.tierIndexInterval + 1;
  return {
    vapeActive,
    state,
    running,
    recommended,
    nextTierMinutes: nextTierObjectiveMinutes(state.tierIndex),
    nextIntervalTierMinutes:
      nextInterval < VAPE_TIER_COUNT ? intervalMinutesForTier(nextInterval) : null,
    record,
    history,
  };
}

export async function setManualVapeTier(
  db: Db,
  track: VapeTierTrack,
  tierIndex: number,
): Promise<AdaptiveChallengeState> {
  const clamped = Math.max(0, Math.min(tierIndex, VAPE_TIER_COUNT - 1));
  const now = nowIso();
  await db.withExclusiveTransactionAsync(async (tx) => {
    await adaptiveRepo.getOrInitState(tx, VAPE_HABIT_CATEGORY);
    if (track === 'delay') {
      await adaptiveRepo.updateStateTier(tx, VAPE_HABIT_CATEGORY, clamped, true, now);
    } else {
      await adaptiveRepo.updateStateIntervalTier(tx, VAPE_HABIT_CATEGORY, clamped, true, now);
    }
  });
  return adaptiveRepo.getOrInitState(db, VAPE_HABIT_CATEGORY);
}

export async function resumeAutoVapeTier(db: Db, track: VapeTierTrack): Promise<AdaptiveChallengeState> {
  const now = nowIso();
  await db.withExclusiveTransactionAsync(async (tx) => {
    await adaptiveRepo.getOrInitState(tx, VAPE_HABIT_CATEGORY);
    await adaptiveRepo.resumeAutoTier(tx, VAPE_HABIT_CATEGORY, track, now);
  });
  return adaptiveRepo.getOrInitState(db, VAPE_HABIT_CATEGORY);
}

export interface StartAdaptiveOptions {
  /** Appelé dans la même transaction que l'insertion de la tentative. */
  onStarted?: (tx: Db, attempt: AdaptiveChallengeAttempt) => Promise<void>;
  /** Par défaut l'habitude Vape doit être active ; le tracker vape fonctionne aussi sans objectif. */
  requireActiveGoal?: boolean;
}

export async function startVapeAdaptiveChallenge(
  db: Db,
  format: VapeChallengeFormat,
  opts?: StartAdaptiveOptions,
): Promise<StartAdaptiveResult> {
  let result: StartAdaptiveResult = { ok: false, code: 'category_inactive' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    if (opts?.requireActiveGoal !== false && !(await vapeGoalActive(tx))) {
      result = { ok: false, code: 'category_inactive' };
      return;
    }
    const running = await adaptiveRepo.getRunningAttempt(tx, VAPE_HABIT_CATEGORY);
    if (running) {
      result = { ok: false, code: 'already_running' };
      return;
    }
    if (format === 'record' || format === 'interval') {
      if (await vapeMainRepo.getActiveSession(tx)) {
        result = { ok: false, code: 'main_chrono_active' };
        return;
      }
    }
    const state = await adaptiveRepo.getOrInitState(tx, VAPE_HABIT_CATEGORY);
    const tierSnap = tierIndexForFormat(state, format);
    const now = nowIso();
    const targetSec = targetSecForFormat(format, tierSnap);
    const sessionRes = await startChallengeSessionOnConn(tx, 'no_vape', targetSec);
    if (!sessionRes.ok) {
      result = { ok: false, code: 'session_busy' };
      return;
    }
    const attempt: AdaptiveChallengeAttempt = {
      id: createId('avad'),
      habitCategory: VAPE_HABIT_CATEGORY,
      format,
      tierIndex: tierSnap,
      outcome: 'running',
      challengeSessionId: sessionRes.session.id,
      copingSessionId: null,
      targetDurationSec: targetSec,
      declaredDurationSec: null,
      startedAt: now,
      endedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await adaptiveRepo.insertAttempt(tx, attempt);
    if (opts?.onStarted) await opts.onStarted(tx, attempt);
    result = { ok: true, attempt };
  });
  return result;
}

async function applyTierAfterClose(
  tx: Db,
  attempt: AdaptiveChallengeAttempt,
): Promise<string | null> {
  const track = tierTrackForFormat(attempt.format);
  if (!track || attempt.format === 'breathing' || attempt.format === 'record') return null;
  const state = await adaptiveRepo.getOrInitState(tx, VAPE_HABIT_CATEGORY);
  const manual = track === 'delay' ? state.tierManual : state.tierManualInterval;
  if (manual) return null;
  const currentTier = track === 'delay' ? state.tierIndex : state.tierIndexInterval;
  const raw = await adaptiveRepo.listInformedOutcomesForFormat(
    tx,
    VAPE_HABIT_CATEGORY,
    attempt.format,
    12,
  );
  const informed = informedOutcomesFromAttempts(raw);
  const suggestion = suggestTierIndex(currentTier, informed, VAPE_TIER_COUNT - 1);
  const now = nowIso();
  if (suggestion.tierIndex !== currentTier) {
    if (track === 'delay') {
      await adaptiveRepo.updateStateTier(tx, VAPE_HABIT_CATEGORY, suggestion.tierIndex, false, now);
    } else {
      await adaptiveRepo.updateStateIntervalTier(tx, VAPE_HABIT_CATEGORY, suggestion.tierIndex, false, now);
    }
  }
  return suggestion.adjusted ? suggestion.message : null;
}

async function maybeGrantTierGold(
  tx: Db,
  attempt: AdaptiveChallengeAttempt,
  success: boolean,
): Promise<boolean> {
  if (!success) return false;
  const track = tierTrackForFormat(attempt.format);
  if (!track) return false;
  const key = `adaptive:vape:${attempt.format}:tier:${attempt.tierIndex}:gold`;
  const amount = Math.min(VAPE_TIER_GOLD_REWARD, await sharedGoldRemainingToday(tx));
  if (amount <= 0) return false;
  const r = await rpgRepo.addGold(
    tx,
    amount,
    `Palier vape (${attempt.format}) ${attempt.tierIndex + 1} confirmé`,
    key,
  );
  return r === 'inserted';
}

async function maybeGrantRecordMilestoneGold(tx: Db, durationSec: number): Promise<boolean> {
  const milestone = highestRecordMilestoneMinutes(durationSec);
  if (milestone == null) return false;
  const key = `adaptive:vape:record:milestone:${milestone}:gold`;
  const amount = Math.min(VAPE_TIER_GOLD_REWARD, await sharedGoldRemainingToday(tx));
  if (amount <= 0) return false;
  const r = await rpgRepo.addGold(
    tx,
    amount,
    `Record vape — palier ${milestone} min`,
    key,
  );
  return r === 'inserted';
}

function successFromSession(
  format: VapeChallengeFormat,
  durationSec: number,
  targetSec: number | null,
  completed: boolean,
  mode: 'completed' | 'vaped' | 'unknown',
  breathingCompleted: boolean,
): boolean {
  if (mode !== 'completed') return false;
  if (!completed) return false;
  if (format === 'breathing') {
    return breathingCompleted && durationSec >= VAPE_BREATHING_SECONDS;
  }
  if (format === 'record') {
    return highestRecordMilestoneMinutes(durationSec) != null;
  }
  if (targetSec == null || targetSec < 1) return false;
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
    let breathingCompleted = false;
    let copingSessionId: string | null = null;

    if (attempt.format === 'breathing') {
      const breathDone = mode === 'completed' && completed && durationSec >= VAPE_BREATHING_SECONDS;
      const cope = await recordBreathingSessionOnConn(
        tx,
        breathDone ? VAPE_BREATHING_SECONDS : durationSec,
        breathDone,
        { vapeAttemptId: attemptId },
      );
      copingSessionId = cope.copingSessionId;
      breathingCompleted = breathDone;
      await adaptiveRepo.setAttemptCopingSessionId(tx, attemptId, copingSessionId);
    }

    const success =
      mode === 'unknown'
        ? false
        : successFromSession(
            attempt.format,
            durationSec,
            attempt.targetDurationSec,
            completed,
            mode,
            breathingCompleted,
          );
    const outcome =
      mode === 'unknown' ? 'unknown' : attempt.format === 'record' && mode === 'vaped' ? 'failure' : success
        ? 'success'
        : 'failure';
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

    const mayUpdateRecord =
      durationSec > 0 &&
      mode !== 'unknown' &&
      (attempt.format === 'record'
        ? mode === 'completed' || mode === 'vaped'
        : success && attempt.format === 'interval');
    if (mayUpdateRecord) {
      await adaptiveRepo.upsertRecordIfBetter(tx, {
        habitCategory: VAPE_HABIT_CATEGORY,
        format: attempt.format === 'record' ? 'record' : 'interval',
        bestDurationSec: durationSec,
        attemptId,
        achievedAt: ended,
      });
    }

    const updated = (await adaptiveRepo.getAttemptById(tx, attemptId))!;
    const tierMessage = await applyTierAfterClose(tx, updated);
    let goldGranted = false;
    if (attempt.format === 'record' && mode !== 'unknown') {
      goldGranted = await maybeGrantRecordMilestoneGold(tx, durationSec);
    } else if (attempt.format !== 'record') {
      goldGranted = await maybeGrantTierGold(tx, updated, success);
    }
    result = { ok: true, attempt: updated, tierMessage, goldGranted };
  });
  return result;
}

export function formatDefLabel(format: VapeChallengeFormat): string {
  return vapeChallengeDef(format).title;
}