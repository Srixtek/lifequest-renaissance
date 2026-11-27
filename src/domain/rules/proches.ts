import { weekBoundsMondaySunday } from './weeklyTracking';

export const DEFAULT_WEEKLY_CALL_TARGET = 2;

export const WEEKLY_CALL_LIMITS = { min: 1, max: 7 } as const;

export type ProchesRelation = 'family' | 'friend' | 'other';

export const PROCHES_RELATION_LABEL: Record<ProchesRelation, string> = {
  family: 'Famille',
  friend: 'Ami',
  other: 'Autre',
};

const MAX_NAME = 80;
const MAX_NOTE = 280;

export function isProchesRelation(value: unknown): value is ProchesRelation {
  return value === 'family' || value === 'friend' || value === 'other';
}

export function parseContactName(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const v = raw.trim().slice(0, MAX_NAME);
  if (!v) return { ok: false, error: 'Indique un nom ou un surnom.' };
  return { ok: true, value: v };
}

export function parseContactNote(raw: string | undefined | null): string | null {
  const v = (raw ?? '').trim().slice(0, MAX_NOTE);
  return v || null;
}

export function parseWeeklyCallTarget(raw: string): { ok: true; value: number } | { ok: false; error: string } {
  const t = raw.trim();
  if (!t) return { ok: false, error: 'Indique un nombre d\'appels (1 à 7).' };
  if (!/^[1-7]$/.test(t)) return { ok: false, error: 'Choisis un entier entre 1 et 7.' };
  return { ok: true, value: Number(t) };
}

export function weekBounds(logicalDate: string): { start: string; end: string } {
  return weekBoundsMondaySunday(logicalDate);
}