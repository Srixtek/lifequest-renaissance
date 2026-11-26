export type AdaptiveHabitCategory = 'A';

export type VapeChallengeFormat = 'delay_craving' | 'breathing' | 'interval' | 'record';

export type AdaptiveAttemptOutcome = 'running' | 'success' | 'failure' | 'unknown';

export interface AdaptiveChallengeState {
  habitCategory: AdaptiveHabitCategory;
  tierIndex: number;
  tierManual: boolean;
  updatedAt: string;
}

export interface AdaptiveChallengeAttempt {
  id: string;
  habitCategory: AdaptiveHabitCategory;
  format: VapeChallengeFormat;
  tierIndex: number;
  outcome: AdaptiveAttemptOutcome;
  challengeSessionId: string | null;
  targetDurationSec: number | null;
  declaredDurationSec: number | null;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdaptiveChallengeRecord {
  habitCategory: AdaptiveHabitCategory;
  format: VapeChallengeFormat;
  bestDurationSec: number;
  attemptId: string | null;
  achievedAt: string;
}

export const VAPE_HABIT_CATEGORY: AdaptiveHabitCategory = 'A';