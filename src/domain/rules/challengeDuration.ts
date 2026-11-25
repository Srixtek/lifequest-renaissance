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