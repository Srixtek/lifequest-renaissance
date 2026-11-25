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

export type ValidateTargetResult =
  | { ok: true; value: number | null }
  | { ok: false; error: string };

export function kindRequiresNumericTarget(kind: GoalKind): boolean {
  return kind === 'limit' || kind === 'reduce' || kind === 'duration' || kind === 'quantity';
}

/** Target rules when creating a goal (custom or from template). */
export function validateCreationTarget(kind: GoalKind, raw: string): ValidateTargetResult {
  if (isBinaryGoal(kind)) {
    if (raw.trim() !== '') {
      return { ok: false, error: 'Les objectifs oui/non n\'ont pas de cible numérique.' };
    }
    return { ok: true, value: null };
  }
  if (!kindRequiresNumericTarget(kind)) {
    return { ok: true, value: null };
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { ok: false, error: 'Une cible numérique est requise pour ce type d\'objectif.' };
  }
  const parsed = parseLogValue(trimmed);
  if (!parsed.ok) {
    return {
      ok: false,
      error:
        parsed.error === 'Vide'
          ? 'Une cible numérique est requise pour ce type d\'objectif.'
          : parsed.error,
    };
  }
  if ((kind === 'duration' || kind === 'quantity') && parsed.value <= 0) {
    return { ok: false, error: 'La cible doit être supérieure à 0 pour ce type.' };
  }
  return { ok: true, value: parsed.value };
}

export function statusFromLog(
  goal: Pick<GoalDefinition, 'kind' | 'followWithoutXp'>,
  version: GoalVersion | null,
  value: number,
): TrackingStatus {
  if (goal.followWithoutXp) {
    // Explicit qty (0 included): logged day, neutral — not unknown, not success/fail for bilan XP.
    return 'partial';
  }
  const target = targetOrNull(version);
  return deriveTrackingStatus(goal.kind, value, target);
}