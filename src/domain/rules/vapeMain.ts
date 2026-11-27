/** Règles pures du chrono principal vape (aucune I/O). */

export const VAPE_STEP_SEC = 30 * 60;
/** Or par palier de 30 min confirmé (petit : le plafond journalier partagé borne le total). */
export const VAPE_STEP_GOLD = 2;

/** Seuils de record (minutes) qui déclenchent un bonus unique et définitif. */
export const VAPE_RECORD_BONUS: ReadonlyArray<{ minutes: number; gold: number }> = [
  { minutes: 60, gold: 4 },
  { minutes: 120, gold: 5 },
  { minutes: 240, gold: 6 },
  { minutes: 480, gold: 8 },
  { minutes: 720, gold: 10 },
  { minutes: 1440, gold: 12 },
  { minutes: 2880, gold: 15 },
  { minutes: 4320, gold: 15 },
  { minutes: 10080, gold: 20 },
];

export interface SafeElapsed {
  sec: number;
  /** Horodatage illisible ou horloge antérieure au départ : aucune durée inventée. */
  anomaly: boolean;
}

export function safeElapsedSec(startedAtIso: string, endMs: number): SafeElapsed {
  const start = Date.parse(startedAtIso);
  if (!Number.isFinite(start) || !Number.isFinite(endMs)) return { sec: 0, anomaly: true };
  if (endMs < start) return { sec: 0, anomaly: true };
  return { sec: Math.floor((endMs - start) / 1000), anomaly: false };
}

export function stepsReached(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec < VAPE_STEP_SEC) return 0;
  return Math.floor(durationSec / VAPE_STEP_SEC);
}

export function stepLabel(step: number): string {
  const totalMin = step * 30;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${String(m).padStart(2, '0')}`;
}

export interface NextStep {
  step: number;
  label: string;
  remainingSec: number;
  progress: number;
}

export function nextStepInfo(durationSec: number): NextStep {
  const safe = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0;
  const reached = stepsReached(safe);
  const step = reached + 1;
  const into = safe - reached * VAPE_STEP_SEC;
  return {
    step,
    label: stepLabel(step),
    remainingSec: Math.max(0, VAPE_STEP_SEC - into),
    progress: Math.min(1, into / VAPE_STEP_SEC),
  };
}

/**
 * Seuils franchis qui constituent un vrai nouveau record : durée atteinte ET supérieure
 * au meilleur intervalle précédent. Chaque seuil n'est récompensé qu'une fois (voir claims).
 */
export function recordThresholdsCrossed(
  durationSec: number,
  priorBestSec: number,
): Array<{ minutes: number; gold: number }> {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return [];
  return VAPE_RECORD_BONUS.filter((t) => durationSec >= t.minutes * 60 && t.minutes * 60 > priorBestSec);
}

export function stepLedgerKey(sessionId: string, step: number): string {
  return `vape:main:${sessionId}:step:${step}`;
}

export function recordLedgerKey(thresholdMinutes: number): string {
  return `vape:record:${thresholdMinutes}`;
}

export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} j ${h} h`;
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
  if (m > 0) return `${m} min`;
  return `${s} s`;
}
