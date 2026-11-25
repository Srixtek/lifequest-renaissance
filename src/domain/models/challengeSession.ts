export type ChallengeType = 'no_vape' | 'no_screen' | 'sport';

export type ChallengeState = 'running' | 'completed' | 'interrupted';

export interface ChallengeSession {
  id: string;
  type: ChallengeType;
  startedUtc: string;
  endedUtc: string | null;
  targetDurationSec: number | null;
  state: ChallengeState;
  durationSec: number;
  userConfirmed: boolean;
  userConfirmedDurationSec: number | null;
  createdAt: string;
  updatedAt: string;
}

export const CHALLENGE_TYPE_LABELS: Record<ChallengeType, string> = {
  no_vape: 'Sans vapoter',
  no_screen: 'Sans écran',
  sport: 'Activité physique',
};

export const SCREEN_TARGET_MINUTES = [10, 20, 30, 60] as const;
export const SPORT_TARGET_MINUTES = [5, 15, 30, 45, 60] as const;

export function challengeTypeForTemplate(templateId: string | null | undefined): ChallengeType | null {
  if (templateId === 'vape_sessions') return 'no_vape';
  if (templateId === 'screen_free') return 'no_screen';
  if (templateId === 'sport_minutes') return 'sport';
  return null;
}