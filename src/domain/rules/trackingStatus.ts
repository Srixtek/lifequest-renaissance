import type { GoalDefinition, GoalKind, GoalVersion, TrackingStatus } from '../models/types';

export type ParseLogResult =
  | { ok: true; value: number }
  | { ok: false; error: string };

/** Parse daily numeric input. Empty string is not zero. */
export function parseLogValue(raw: string): ParseLogResult {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: false, error: 'Vide' };
  const normalized = trimmed.replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    return { ok: false, error: 'Nombre invalide' };
  }
  const value = Number(normalized);
  if (!Number.isFinite(value)) return { ok: false, error: 'Nombre invalide' };
  if (value < 0) return { ok: false, error: 'Les valeurs négatives sont refusées' };
  return { ok: true, value };
}

function targetOrNull(version: GoalVersion | null): number | null {
  if (!version) return null;
  return version.targetValue;
}

/**
 * Derive tracking status from kind + declared value + plan target.
 * Binary kinds return null → caller must use explicit confirmation.
 */
export function deriveTrackingStatus(
  kind: GoalKind,
  value: number,
  target: number | null,
): TrackingStatus {
  if (kind === 'abstinence') {
    if (value === 0) return 'success';
    return 'miss';
  }

  if (kind === 'limit' || kind === 'reduce') {
    if (target == null) {
      return value === 0 ? 'success' : 'partial';
    }
    if (value <= target) return 'success';
    return 'partial';
  }

  if (kind === 'duration' || kind === 'quantity') {
    if (target == null || target <= 0) {
      return value > 0 ? 'success' : 'miss';
    }
    if (value >= target) return 'success';
    if (value > 0) return 'partial';
    return 'miss';
  }

  // habit without numeric target: numeric value unsupported
  if (value > 0) return 'success';
  return 'miss';
}

export function isBinaryGoal(kind: GoalKind): boolean {
  return kind === 'habit' || kind === 'abstinence';
}

export function usesNumericLog(kind: GoalKind): boolean {
  return !isBinaryGoal(kind);
}

export function statusFromLog(
  goal: Pick<GoalDefinition, 'kind'>,
  version: GoalVersion | null,
  value: number,
): TrackingStatus {
  const target = targetOrNull(version);
  return deriveTrackingStatus(goal.kind, value, target);
}