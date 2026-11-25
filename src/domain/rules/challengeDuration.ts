/** Elapsed seconds from UTC timestamps — display only; DB is updated on start/close. */
export function elapsedSecondsFromUtc(
  startedUtc: string,
  endedUtc?: string | null,
  nowMs: number = Date.now(),
): number {
  const start = Date.parse(startedUtc);
  const end = endedUtc ? Date.parse(endedUtc) : nowMs;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  if (end < start) return 0;
  return Math.floor((end - start) / 1000);
}

export function formatChallengeHms(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function progressTowardTarget(elapsedSec: number, targetSec: number | null | undefined): number | null {
  if (targetSec == null || targetSec <= 0) return null;
  return Math.min(1, elapsedSec / targetSec);
}

export const MAX_CHALLENGE_MINUTES = 24 * 60;

export type ParseMinutesResult = { ok: true; minutes: number } | { ok: false; error: string };

/** Custom challenge target: strictly positive, finite, capped. */
export function parsePositiveTargetMinutes(raw: string, maxMinutes = MAX_CHALLENGE_MINUTES): ParseMinutesResult {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: 'Vide' };
  const n = Number(trimmed.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return { ok: false, error: 'Durée invalide' };
  if (n > maxMinutes) return { ok: false, error: `Durée max ${maxMinutes} min` };
  const targetSec = Math.round(n * 60);
  if (targetSec < 1) return { ok: false, error: 'Durée invalide' };
  return { ok: true, minutes: targetSec / 60 };
}

/** Sport confirmation: 0 allowed, finite, capped. */
export function parseSportConfirmMinutes(raw: string, maxMinutes = MAX_CHALLENGE_MINUTES): ParseMinutesResult {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: 'Vide' };
  const n = Number(trimmed.replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: 'Minutes invalides' };
  if (n > maxMinutes) return { ok: false, error: `Durée max ${maxMinutes} min` };
  return { ok: true, minutes: Math.floor(n) };
}