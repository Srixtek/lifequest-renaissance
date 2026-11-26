import type { VapeChallengeFormat } from '../models/adaptiveChallenge';

export const VAPE_DELAY_TIER_MINUTES = [5, 10, 15, 30, 60] as const;
export const VAPE_INTERVAL_TIER_MINUTES = [30, 60, 120, 240, 480] as const;
export const VAPE_BREATHING_SECONDS = 3 * 60;
export const VAPE_TIER_COUNT = VAPE_DELAY_TIER_MINUTES.length;

export const VAPE_TIER_GOLD_REWARD = 3;

/** Paliers record (minutes) — or idempotent par palier atteint. */
export const VAPE_RECORD_MILESTONE_MINUTES = [15, 30, 60, 120, 240] as const;

export interface VapeChallengeDef {
  format: VapeChallengeFormat;
  title: string;
  subtitle: string;
  kind: 'short' | 'progressive' | 'record';
  usesTimer: boolean;
  multiDay: boolean;
}

export const VAPE_CHALLENGE_DEFS: VapeChallengeDef[] = [
  {
    format: 'delay_craving',
    title: 'Retarder une envie',
    subtitle: 'Tiens la durée choisie avant de vapoter.',
    kind: 'short',
    usesTimer: true,
    multiDay: false,
  },
  {
    format: 'breathing',
    title: 'Respiration 3 minutes',
    subtitle: 'Une séance courte en réponse à une envie.',
    kind: 'short',
    usesTimer: true,
    multiDay: false,
  },
  {
    format: 'interval',
    title: 'Intervalle sans vapoter',
    subtitle: 'Garde un créneau sans vape, à ton rythme.',
    kind: 'progressive',
    usesTimer: true,
    multiDay: false,
  },
  {
    format: 'record',
    title: 'Record personnel',
    subtitle: 'Chronomètre multi-jours — déclare « J\'ai vapoté » pour arrêter.',
    kind: 'record',
    usesTimer: true,
    multiDay: true,
  },
];

export function delayMinutesForTier(tierIndex: number): number {
  const i = Math.max(0, Math.min(tierIndex, VAPE_DELAY_TIER_MINUTES.length - 1));
  return VAPE_DELAY_TIER_MINUTES[i];
}

export function intervalMinutesForTier(tierIndex: number): number {
  const i = Math.max(0, Math.min(tierIndex, VAPE_INTERVAL_TIER_MINUTES.length - 1));
  return VAPE_INTERVAL_TIER_MINUTES[i];
}

export function nextTierObjectiveMinutes(tierIndex: number): number | null {
  const next = tierIndex + 1;
  if (next >= VAPE_DELAY_TIER_MINUTES.length) return null;
  return VAPE_DELAY_TIER_MINUTES[next];
}

export function vapeChallengeDef(format: VapeChallengeFormat): VapeChallengeDef {
  const d = VAPE_CHALLENGE_DEFS.find((x) => x.format === format);
  if (!d) throw new Error('Défi vape inconnu');
  return d;
}

export function highestRecordMilestoneMinutes(durationSec: number): number | null {
  if (durationSec < 1) return null;
  const mins = durationSec / 60;
  let best: number | null = null;
  for (const m of VAPE_RECORD_MILESTONE_MINUTES) {
    if (mins >= m) best = m;
  }
  return best;
}