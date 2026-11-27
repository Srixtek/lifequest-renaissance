import { parseScaledDecimal } from './alcohol';

/**
 * Journal Sport (V1-03A). Unités stockées, toujours ENTIÈRES :
 *  - répétitions : entier ; durées : secondes ; distances : mètres.
 * Aucune valeur arrondie à l'affichage n'est jamais réutilisée dans un calcul.
 */

export type SportActivityId = 'pushups' | 'walking' | 'running' | 'free';
export type SportMetric = 'reps' | 'duration_sec' | 'distance_m';
export type SportOutcome = 'free' | 'achieved' | 'failed';
export type SportActivityKind = 'reps' | 'distance_time' | 'free';

export interface SportActivityDef {
  id: SportActivityId;
  label: string;
  kind: SportActivityKind;
  /** Mesures sur lesquelles un objectif peut être fixé. */
  goalMetrics: readonly SportMetric[];
  /** Mesure principale (résumé, progression). `null` : séances hétérogènes. */
  primaryMetric: SportMetric | null;
}

export const SPORT_ACTIVITIES: readonly SportActivityDef[] = [
  { id: 'pushups', label: 'Pompes', kind: 'reps', goalMetrics: ['reps'], primaryMetric: 'reps' },
  { id: 'walking', label: 'Marche', kind: 'distance_time', goalMetrics: ['duration_sec', 'distance_m'], primaryMetric: 'duration_sec' },
  { id: 'running', label: 'Course', kind: 'distance_time', goalMetrics: ['duration_sec', 'distance_m'], primaryMetric: 'duration_sec' },
  { id: 'free', label: 'Séance libre', kind: 'free', goalMetrics: [], primaryMetric: null },
];

export const SPORT_ACTIVITY_BY_ID: Record<SportActivityId, SportActivityDef> = Object.fromEntries(
  SPORT_ACTIVITIES.map((a) => [a.id, a]),
) as Record<SportActivityId, SportActivityDef>;

export function isSportActivityId(v: unknown): v is SportActivityId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(SPORT_ACTIVITY_BY_ID, v);
}

export const SPORT_LIMITS = {
  reps: { min: 0, max: 10_000 },
  durationSec: { min: 0, max: 86_400 },
  distanceM: { min: 0, max: 1_000_000 },
  goal: {
    reps: { min: 1, max: 10_000 },
    duration_sec: { min: 1, max: 86_400 },
    distance_m: { min: 1, max: 1_000_000 },
  },
  noteLength: 200,
  nameLength: 40,
} as const;

/** Pas d'arrondi des cibles proposées, par mesure. */
export const SPORT_STEP: Record<SportMetric, number> = { reps: 1, duration_sec: 60, distance_m: 100 };

function isInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n);
}

// ───────────────────────── Saisie et validation ─────────────────────────

export function parseRepsInput(raw: string): { ok: true; value: number } | { ok: false; error: string } {
  const t = raw.trim();
  if (t === '') return { ok: false, error: 'Indique le nombre de répétitions (0 si tu en as fait aucune).' };
  if (!/^\d{1,5}$/.test(t)) return { ok: false, error: 'Nombre entier de répétitions, sans virgule ni signe.' };
  const n = Number(t);
  if (n > SPORT_LIMITS.reps.max) return { ok: false, error: `Maximum ${SPORT_LIMITS.reps.max} répétitions.` };
  return { ok: true, value: n };
}

/** Minutes (entier ou une décimale) → secondes entières, sans passer par un flottant. */
export function parseDurationMinutesInput(raw: string): { ok: true; value: number } | { ok: false; error: string } {
  const t = raw.trim();
  if (t === '') return { ok: false, error: 'Indique la durée en minutes.' };
  const m = /^(\d{1,4})(?:[.,](\d))?$/.exec(t);
  if (!m) return { ok: false, error: 'Durée en minutes (ex. 25 ou 12,5).' };
  const sec = Number(m[1]) * 60 + (m[2] ? Number(m[2]) * 6 : 0);
  if (sec > SPORT_LIMITS.durationSec.max) return { ok: false, error: 'Maximum 24 h.' };
  return { ok: true, value: sec };
}

/** Kilomètres (3 décimales au plus) → mètres entiers. */
export function parseDistanceKmInput(raw: string): { ok: true; value: number } | { ok: false; error: string } {
  const p = parseScaledDecimal(raw, 3);
  if (!p.ok) {
    return { ok: false, error: p.error === 'Trop de décimales' ? 'Distance en km, 3 décimales au plus.' : 'Distance en km (ex. 5 ou 3,2).' };
  }
  if (p.scaled > SPORT_LIMITS.distanceM.max) return { ok: false, error: 'Maximum 1 000 km.' };
  return { ok: true, value: p.scaled };
}

export interface SessionFormInput {
  activityId: SportActivityId;
  reps: string;
  durationMin: string;
  distanceKm: string;
  /** Séance libre : mesure choisie. */
  freeMetric: 'reps' | 'duration';
  disciplineName: string;
  note: string;
}

export interface ValidatedSession {
  activityId: SportActivityId;
  reps: number | null;
  durationSec: number | null;
  distanceM: number | null;
  disciplineName: string | null;
  note: string | null;
}

export type SessionFormErrors = Partial<Record<'reps' | 'duration' | 'distance' | 'discipline' | 'note' | 'activity', string>>;

export type SessionValidation = { ok: true; value: ValidatedSession } | { ok: false; errors: SessionFormErrors };

function cleanText(raw: string | null | undefined, max: number): string | null | 'too_long' {
  const t = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (t === '') return null;
  return t.length > max ? 'too_long' : t;
}

/** Validation stricte du formulaire : vide ≠ zéro, aucune valeur implicite. */
export function validateSessionForm(input: SessionFormInput): SessionValidation {
  const errors: SessionFormErrors = {};
  const def = isSportActivityId(input.activityId) ? SPORT_ACTIVITY_BY_ID[input.activityId] : null;
  if (!def) return { ok: false, errors: { activity: 'Activité inconnue.' } };

  let reps: number | null = null;
  let durationSec: number | null = null;
  let distanceM: number | null = null;

  const readReps = () => {
    const p = parseRepsInput(input.reps);
    if (p.ok) reps = p.value;
    else errors.reps = p.error;
  };
  const readDuration = (required: boolean) => {
    if (!required && input.durationMin.trim() === '') return;
    const p = parseDurationMinutesInput(input.durationMin);
    if (p.ok) durationSec = p.value;
    else errors.duration = p.error;
  };
  const readDistance = (required: boolean) => {
    if (!required && input.distanceKm.trim() === '') return;
    const p = parseDistanceKmInput(input.distanceKm);
    if (p.ok) distanceM = p.value;
    else errors.distance = p.error;
  };

  if (def.kind === 'reps') {
    readReps();
  } else if (def.kind === 'distance_time') {
    const hasDuration = input.durationMin.trim() !== '';
    const hasDistance = input.distanceKm.trim() !== '';
    if (!hasDuration && !hasDistance) errors.duration = 'Indique au moins la durée (min) ou la distance (km).';
    else {
      readDuration(false);
      readDistance(false);
    }
  } else if (input.freeMetric === 'reps') {
    readReps();
  } else {
    readDuration(true);
  }

  const note = cleanText(input.note, SPORT_LIMITS.noteLength);
  if (note === 'too_long') errors.note = `Note limitée à ${SPORT_LIMITS.noteLength} caractères.`;
  const name = def.kind === 'free' ? cleanText(input.disciplineName, SPORT_LIMITS.nameLength) : null;
  if (name === 'too_long') errors.discipline = `Nom limité à ${SPORT_LIMITS.nameLength} caractères.`;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      activityId: def.id,
      reps,
      durationSec,
      distanceM,
      disciplineName: name as string | null,
      note: note as string | null,
    },
  };
}

/** Contrôle de cohérence côté service (les écrans ne sont jamais la seule barrière). */
export function isValidSessionValues(v: ValidatedSession): boolean {
  if (!isSportActivityId(v.activityId)) return false;
  const def = SPORT_ACTIVITY_BY_ID[v.activityId];
  const okReps = v.reps == null || (isInt(v.reps) && v.reps >= SPORT_LIMITS.reps.min && v.reps <= SPORT_LIMITS.reps.max);
  const okDur =
    v.durationSec == null ||
    (isInt(v.durationSec) && v.durationSec >= SPORT_LIMITS.durationSec.min && v.durationSec <= SPORT_LIMITS.durationSec.max);
  const okDist =
    v.distanceM == null ||
    (isInt(v.distanceM) && v.distanceM >= SPORT_LIMITS.distanceM.min && v.distanceM <= SPORT_LIMITS.distanceM.max);
  if (!okReps || !okDur || !okDist) return false;
  if (v.note != null && (typeof v.note !== 'string' || v.note.length > SPORT_LIMITS.noteLength)) return false;
  if (v.disciplineName != null && (typeof v.disciplineName !== 'string' || v.disciplineName.length > SPORT_LIMITS.nameLength)) {
    return false;
  }
  if (def.kind === 'reps') return v.reps != null && v.durationSec == null && v.distanceM == null && v.disciplineName == null;
  if (def.kind === 'distance_time') {
    return v.reps == null && (v.durationSec != null || v.distanceM != null) && v.disciplineName == null;
  }
  return (v.reps != null) !== (v.durationSec != null) && v.distanceM == null;
}

export function valueForMetric(
  metric: SportMetric,
  v: { reps: number | null; durationSec: number | null; distanceM: number | null },
): number | null {
  return metric === 'reps' ? v.reps : metric === 'duration_sec' ? v.durationSec : v.distanceM;
}

export function isValidGoalTarget(metric: SportMetric, target: number): boolean {
  const lim = SPORT_LIMITS.goal[metric];
  return isInt(target) && target >= lim.min && target <= lim.max;
}

export function isGoalMetricAllowed(activityId: SportActivityId, metric: SportMetric): boolean {
  return SPORT_ACTIVITY_BY_ID[activityId]?.goalMetrics.includes(metric) ?? false;
}

export type OutcomeCheck = 'ok' | 'missing_performance' | 'below_target';

/**
 * Classement d'une tentative contre un objectif. « Atteint » exige une performance réelle ≥ cible ; « Échoué » est
 * toujours accepté (la performance saisie est conservée telle quelle). Une tentative échouée n'est jamais convertie.
 */
export function checkOutcome(
  outcome: 'achieved' | 'failed',
  metric: SportMetric,
  target: number,
  v: { reps: number | null; durationSec: number | null; distanceM: number | null },
): OutcomeCheck {
  const value = valueForMetric(metric, v);
  if (value == null) return 'missing_performance';
  if (outcome === 'achieved' && value < target) return 'below_target';
  return 'ok';
}

// ───────────────────────── Affichage ─────────────────────────

export const SPORT_METRIC_LABEL: Record<SportMetric, string> = {
  reps: 'répétitions',
  duration_sec: 'durée',
  distance_m: 'distance',
};

export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h} h ${m < 10 ? `0${m}` : m}`;
  if (m > 0) return r > 0 ? `${m} min ${r} s` : `${m} min`;
  return `${r} s`;
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${m} m`;
  const km = m / 1000;
  const txt = Number.isInteger(km) ? String(km) : km.toFixed(3).replace(/0+$/, '').replace('.', ',');
  return `${txt} km`;
}

export function formatReps(n: number): string {
  return `${n} ${n > 1 ? 'répétitions' : 'répétition'}`;
}

export function formatMetricValue(metric: SportMetric, value: number): string {
  return metric === 'reps' ? formatReps(value) : metric === 'duration_sec' ? formatDuration(value) : formatDistance(value);
}

/** Texte d'entrée (champ du formulaire) depuis une valeur stockée. */
export function durationToMinutesText(sec: number): string {
  const whole = Math.floor(sec / 60);
  const tenth = Math.round((sec % 60) / 6);
  return tenth > 0 && sec % 6 === 0 && sec % 60 !== 0 ? `${whole},${tenth}` : String(whole);
}

export function distanceToKmText(m: number): string {
  if (m % 1000 === 0) return String(m / 1000);
  return (m / 1000).toFixed(3).replace(/0+$/, '').replace('.', ',');
}

// ───────────────────────── Suggestion d'objectif (jamais automatique) ─────────────────────────

export interface GoalAttempt {
  value: number;
  outcome: 'achieved' | 'failed';
  localDate: string;
}

export interface SportGoalSuggestion {
  direction: 'lower' | 'raise';
  metric: SportMetric;
  currentTarget: number;
  proposedTarget: number;
  attemptsUsed: number;
  message: string;
  reason: string;
}

export const SUGGESTION_MIN_ATTEMPTS = 3;
export const SUGGESTION_WINDOW = 5;
export const SUGGESTION_RAISE_STREAK = 4;
export const SUGGESTION_RAISE_MIN_DAYS = 3;
export const SUGGESTION_ATTEMPTS_AFTER_DISMISS = 2;

function floorToStep(x: number, step: number): number {
  return Math.floor(x / step) * step;
}

function roundToStep(x: number, step: number): number {
  return Math.round(x / step) * step;
}

function median(values: number[]): number {
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : Math.floor((s[mid - 1] + s[mid]) / 2);
}

/**
 * Suggestion simple et transparente :
 *  - baisse : au moins 3 tentatives récentes pour CET objectif, dont ≥ 2/3 échouées ; cible proposée = milieu entre la
 *    cible et la médiane des tentatives échouées (ex. cible 20, tentatives 16 → 18) ;
 *  - hausse : seulement après 4 tentatives consécutives réussies sur ≥ 3 jours différents (jamais après une seule
 *    réussite) ; pas de +10 % ;
 *  - après un refus : silence jusqu'à 2 nouvelles tentatives.
 * Aucun jour de repos imposé, aucune pénalité pour un jour sans sport : seules les tentatives comptent.
 */
export function computeSportSuggestion(args: {
  metric: SportMetric;
  target: number;
  attemptsNewestFirst: GoalAttempt[];
  /** Tentatives enregistrées depuis le dernier refus ; `null` si jamais refusée. */
  attemptsSinceDismissal: number | null;
}): SportGoalSuggestion | null {
  const { metric, target } = args;
  if (args.attemptsSinceDismissal != null && args.attemptsSinceDismissal < SUGGESTION_ATTEMPTS_AFTER_DISMISS) return null;
  const step = SPORT_STEP[metric];
  const window = args.attemptsNewestFirst.slice(0, SUGGESTION_WINDOW);
  const fmt = (n: number) => formatMetricValue(metric, n);

  if (window.length >= SUGGESTION_MIN_ATTEMPTS) {
    const failed = window.filter((a) => a.outcome === 'failed');
    if (failed.length >= SUGGESTION_MIN_ATTEMPTS && failed.length * 3 >= window.length * 2) {
      const m = median(failed.map((a) => a.value));
      const proposed = floorToStep((target + m) / 2, step);
      if (m < target && proposed > 0 && proposed < target && isValidGoalTarget(metric, proposed)) {
        return {
          direction: 'lower',
          metric,
          currentTarget: target,
          proposedTarget: proposed,
          attemptsUsed: window.length,
          message:
            `Sur tes ${window.length} dernières tentatives (objectif ${fmt(target)}), ${failed.length} n'ont pas atteint la cible ; ` +
            `médiane des tentatives non atteintes : ${fmt(m)}. Cible adaptée proposée : ${fmt(proposed)}. ` +
            `Les tentatives restent enregistrées telles quelles ; rien ne change sans ton accord.`,
          reason: `lower:${window.length}:failed=${failed.length}:median=${m}`,
        };
      }
    }
  }

  const streak = args.attemptsNewestFirst.slice(0, SUGGESTION_RAISE_STREAK);
  if (
    streak.length === SUGGESTION_RAISE_STREAK &&
    streak.every((a) => a.outcome === 'achieved' && a.value >= target) &&
    new Set(streak.map((a) => a.localDate)).size >= SUGGESTION_RAISE_MIN_DAYS
  ) {
    const raise = Math.max(step, roundToStep(target * 0.1, step));
    const proposed = target + raise;
    if (isValidGoalTarget(metric, proposed)) {
      return {
        direction: 'raise',
        metric,
        currentTarget: target,
        proposedTarget: proposed,
        attemptsUsed: streak.length,
        message:
          `Tu as atteint ton objectif de ${fmt(target)} lors de tes ${streak.length} dernières tentatives, sur ` +
          `${new Set(streak.map((a) => a.localDate)).size} jours différents. Cible proposée : ${fmt(proposed)}. ` +
          `Tu peux la garder telle quelle : rien ne change sans ton accord.`,
        reason: `raise:${streak.length}:days=${new Set(streak.map((a) => a.localDate)).size}`,
      };
    }
  }
  return null;
}

// ───────────────────────── Habitudes Sport personnalisées → activité ─────────────────────────

export interface HabitGoalForMatch {
  title: string;
  unit: string | null;
  /** Cible courante de l'habitude (dans son unité). */
  target: number | null;
}

export interface HabitActivityMatch {
  activityId: SportActivityId;
  metric: SportMetric;
  target: number;
}

function norm(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

const PUSHUP_RE = /pompes?\b|push[- ]?ups?\b/;
const WALK_RE = /\bmarche\b|\bmarcher\b|\brandonnee?s?\b|\bwalk(ing)?\b/;
const RUN_RE = /\bcourse\b|\bcourir\b|\bjogging\b|\bfooting\b|\brun(ning)?\b/;

/**
 * Rattache une habitude Sport personnalisée à UNE activité seulement si c'est sans ambiguïté : titre évoquant
 * exactement une activité ET unité compatible. Sinon `null` (l'habitude reste dans le suivi historique).
 */
export function matchHabitGoalToActivity(g: HabitGoalForMatch): HabitActivityMatch | null {
  const title = norm(g.title);
  const hits: SportActivityId[] = [];
  if (PUSHUP_RE.test(title)) hits.push('pushups');
  if (WALK_RE.test(title)) hits.push('walking');
  if (RUN_RE.test(title)) hits.push('running');
  if (hits.length !== 1 || g.target == null || !Number.isFinite(g.target) || g.target <= 0) return null;
  const activityId = hits[0];
  const unit = g.unit == null ? '' : norm(g.unit).trim();

  if (activityId === 'pushups') {
    if (!['', 'pompe', 'pompes', 'rep', 'reps', 'repetition', 'repetitions', 'fois', 'x'].includes(unit)) return null;
    const target = Math.round(g.target);
    return isValidGoalTarget('reps', target) ? { activityId, metric: 'reps', target } : null;
  }
  let metric: SportMetric;
  let target: number;
  if (['min', 'mn', 'minute', 'minutes'].includes(unit)) {
    metric = 'duration_sec';
    target = Math.round(g.target * 60);
  } else if (['h', 'heure', 'heures'].includes(unit)) {
    metric = 'duration_sec';
    target = Math.round(g.target * 3600);
  } else if (['km', 'kilometre', 'kilometres'].includes(unit)) {
    metric = 'distance_m';
    target = Math.round(g.target * 1000);
  } else if (['m', 'metre', 'metres'].includes(unit)) {
    metric = 'distance_m';
    target = Math.round(g.target);
  } else {
    return null;
  }
  return isValidGoalTarget(metric, target) ? { activityId, metric, target } : null;
}
