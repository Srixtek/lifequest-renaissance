export type AdaptiveHabitCategory = 'A';

export type VapeChallengeFormat = 'delay_craving' | 'breathing' | 'interval' | 'record';

export type AdaptiveAttemptOutcome = 'running' | 'success' | 'failure' | 'unknown';

export type VapeTierTrack = 'delay' | 'interval';

export interface AdaptiveChallengeState {
  habitCategory: AdaptiveHabitCategory;
  /** Palier « Retarder une envie » */
  tierIndex: number;
  tierManual: boolean;
  /** Palier « Intervalle sans vapoter » */
  tierIndexInterval: number;
  tierManualInterval: boolean;
  updatedAt: string;
}

export interface AdaptiveChallengeAttempt {
  id: string;
  habitCategory: AdaptiveHabitCategory;
  format: VapeChallengeFormat;
  tierIndex: number;
  outcome: AdaptiveAttemptOutcome;
  challengeSessionId: string | null;
  copingSessionId: string | null;
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