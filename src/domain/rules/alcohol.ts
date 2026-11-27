import { addDays } from './dates';
import { weekBoundsMondaySunday } from './weeklyTracking';

/**
 * Suivi alcool (V1-02B). Tout est calculé en ENTIERS :
 *  - volume en dixièmes de ml, degré en dixièmes de % vol, quantité en centièmes ;
 *  - alcool pur en milligrammes entiers (arrondi unique, à l'enregistrement).
 * Les totaux sont toujours la somme des milligrammes stockés, jamais de valeurs arrondies à l'affichage.
 */

export const ALCOHOL_DENSITY_MG_PER_ML_X1000 = 789; // 0,789 g/ml
export const STANDARD_DRINK_MG = 10_000; // France : 1 verre standard = 10 g d'alcool pur

export type AlcoholDrinkType = 'beer' | 'wine' | 'spirit' | 'other';

export const ALCOHOL_TYPE_LABEL: Record<AlcoholDrinkType, string> = {
  beer: 'Bière',
  wine: 'Vin',
  spirit: 'Spiritueux',
  other: 'Autre',
};

export interface AlcoholPreset {
  type: AlcoholDrinkType;
  label: string;
  /** Valeurs proposées (modifiables). `null` = à saisir : jamais de supposition pour « Autre ». */
  volumeMl: string | null;
  abvPct: string | null;
}

export const ALCOHOL_PRESETS: readonly AlcoholPreset[] = [
  { type: 'beer', label: 'Bière 25 cl · 5 %', volumeMl: '250', abvPct: '5' },
  { type: 'wine', label: 'Vin 10 cl · 12 %', volumeMl: '100', abvPct: '12' },
  { type: 'spirit', label: 'Spiritueux 3 cl · 40 %', volumeMl: '30', abvPct: '40' },
  { type: 'other', label: 'Autre', volumeMl: null, abvPct: null },
];

export const LIMITS = {
  volumeMlX10: { min: 10, max: 50_000 }, // 1 ml – 5 000 ml
  abvX10: { min: 1, max: 1000 }, // 0,1 % – 100 %
  quantityX100: { min: 1, max: 5000 }, // 0,01 – 50
  weeklyGoalMg: { min: 0, max: 200 * STANDARD_DRINK_MG },
} as const;

export interface DrinkParams {
  volumeMlX10: number;
  abvX10: number;
  quantityX100: number;
}

function isInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n);
}

export function isValidDrinkParams(p: DrinkParams): boolean {
  return (
    isInt(p.volumeMlX10) &&
    isInt(p.abvX10) &&
    isInt(p.quantityX100) &&
    p.volumeMlX10 >= LIMITS.volumeMlX10.min &&
    p.volumeMlX10 <= LIMITS.volumeMlX10.max &&
    p.abvX10 >= LIMITS.abvX10.min &&
    p.abvX10 <= LIMITS.abvX10.max &&
    p.quantityX100 >= LIMITS.quantityX100.min &&
    p.quantityX100 <= LIMITS.quantityX100.max
  );
}

/**
 * alcool_g = volume_ml × (degré/100) × 0,789 × quantité, en mg :
 *   mg = (vol_x10/10) × (abv_x10/1000) × 0,789 × (qty_x100/100) × 1000
 *      = vol_x10 × abv_x10 × qty_x100 × 789 / 1 000 000
 * Produit maximal ≈ 2·10¹⁴ < 2⁵³ : arithmétique entière exacte. Arrondi au mg, demi vers le haut.
 */
export function computeAlcoholMg(p: DrinkParams): number {
  if (!isValidDrinkParams(p)) throw new Error('Paramètres de boisson invalides');
  const numerator = p.volumeMlX10 * p.abvX10 * p.quantityX100 * ALCOHOL_DENSITY_MG_PER_ML_X1000;
  if (!Number.isSafeInteger(numerator)) throw new Error('Paramètres de boisson invalides');
  const withHalf = numerator + 500_000;
  return (withHalf - (withHalf % 1_000_000)) / 1_000_000;
}

export function mgToDrinks(mg: number): number {
  return mg / STANDARD_DRINK_MG;
}

/** 1 à 2 décimales, virgule française, sans zéros inutiles : 2 · 1,5 · 1,97. */
export function formatDrinks(mg: number): string {
  const hundredths = Math.round(mg / 100);
  const intPart = Math.floor(hundredths / 100);
  const dec = hundredths % 100;
  if (dec === 0) return String(intPart);
  const d = dec < 10 ? `0${dec}` : String(dec);
  return `${intPart},${d.endsWith('0') ? d[0] : d}`;
}

export function formatDrinksLabel(mg: number): string {
  return `${formatDrinks(mg)} verre${Math.round(mg / 100) >= 200 ? 's' : ''} standard`;
}

export function formatGrams(mg: number): string {
  return `${(Math.round(mg / 100) / 10).toFixed(1).replace('.', ',')} g`;
}

type ParsedScaled = { ok: true; scaled: number } | { ok: false; error: string };

/**
 * Nombre décimal strict (point ou virgule), `maxDecimals` chiffres au plus, converti en entier mis à l'échelle
 * 10^maxDecimals sans passer par un flottant. Rejette vide, texte, signe, notation scientifique.
 */
export function parseScaledDecimal(raw: string, maxDecimals: number): ParsedScaled {
  const t = raw.trim();
  if (t === '') return { ok: false, error: 'Vide' };
  const m = /^(\d{1,6})(?:[.,](\d+))?$/.exec(t);
  if (!m) return { ok: false, error: 'Nombre invalide' };
  const frac = m[2] ?? '';
  if (frac.length > maxDecimals) return { ok: false, error: 'Trop de décimales' };
  const padded = frac.padEnd(maxDecimals, '0');
  return { ok: true, scaled: Number(m[1]) * 10 ** maxDecimals + (padded ? Number(padded) : 0) };
}

export interface DrinkFormInput {
  type: AlcoholDrinkType;
  name: string;
  volumeMl: string;
  abvPct: string;
  quantity: string;
  note?: string;
}

export interface ValidatedDrink extends DrinkParams {
  drinkType: AlcoholDrinkType;
  name: string | null;
  note: string | null;
}

export type DrinkValidation =
  | { ok: true; value: ValidatedDrink }
  | { ok: false; errors: Partial<Record<'volumeMl' | 'abvPct' | 'quantity' | 'type', string>> };

const MAX_TEXT = 80;
const MAX_NOTE = 280;

export function validateDrinkForm(input: DrinkFormInput): DrinkValidation {
  const errors: Partial<Record<'volumeMl' | 'abvPct' | 'quantity' | 'type', string>> = {};
  if (!(input.type in ALCOHOL_TYPE_LABEL)) errors.type = 'Type de boisson inconnu';

  const vol = parseScaledDecimal(input.volumeMl, 1);
  if (!vol.ok) errors.volumeMl = vol.error === 'Vide' ? 'Indique le volume en ml' : 'Volume invalide (ex. 250)';
  else if (vol.scaled < LIMITS.volumeMlX10.min || vol.scaled > LIMITS.volumeMlX10.max) {
    errors.volumeMl = 'Volume entre 1 et 5000 ml';
  }

  const abv = parseScaledDecimal(input.abvPct, 1);
  if (!abv.ok) errors.abvPct = abv.error === 'Vide' ? 'Indique le degré (% vol)' : 'Degré invalide (ex. 5 ou 12,5)';
  else if (abv.scaled < LIMITS.abvX10.min || abv.scaled > LIMITS.abvX10.max) {
    errors.abvPct = 'Degré entre 0,1 et 100 % vol';
  }

  const qty = parseScaledDecimal(input.quantity, 2);
  if (!qty.ok) errors.quantity = qty.error === 'Vide' ? 'Indique le nombre de verres' : 'Nombre invalide (ex. 2 ou 0,5)';
  else if (qty.scaled < LIMITS.quantityX100.min || qty.scaled > LIMITS.quantityX100.max) {
    errors.quantity = 'Quantité entre 0,01 et 50';
  }

  if (Object.keys(errors).length > 0 || !vol.ok || !abv.ok || !qty.ok) return { ok: false, errors };
  const name = input.name.trim().slice(0, MAX_TEXT);
  const note = (input.note ?? '').trim().slice(0, MAX_NOTE);
  return {
    ok: true,
    value: {
      drinkType: input.type,
      name: name === '' ? null : name,
      note: note === '' ? null : note,
      volumeMlX10: vol.scaled,
      abvX10: abv.scaled,
      quantityX100: qty.scaled,
    },
  };
}

/** Texte éditable pour préremplir un formulaire à partir de valeurs stockées. */
export function scaledToText(scaled: number, decimals: number): string {
  const f = 10 ** decimals;
  const whole = Math.floor(scaled / f);
  const frac = scaled % f;
  if (frac === 0) return String(whole);
  const fs = String(frac).padStart(decimals, '0').replace(/0+$/, '');
  return `${whole},${fs}`;
}

/** Valide un objectif hebdomadaire saisi en verres standard (jusqu'à 2 décimales) et le convertit en mg. */
export function parseWeeklyGoalDrinks(raw: string): { ok: true; mg: number } | { ok: false; error: string } {
  const p = parseScaledDecimal(raw, 2);
  if (!p.ok) return { ok: false, error: p.error === 'Vide' ? 'Indique un nombre de verres' : 'Nombre invalide (ex. 10 ou 7,5)' };
  const mg = p.scaled * 100; // centièmes de verre × 100 mg
  if (mg > LIMITS.weeklyGoalMg.max) return { ok: false, error: 'Objectif trop élevé (200 verres maximum)' };
  return { ok: true, mg };
}

// ───────────────────────── Journées, semaines, fuseaux ─────────────────────────

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = partsFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFormatters.set(timeZone, f);
  }
  return f;
}

export function resolveTimeZone(timeZone?: string | null): string {
  return timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function wallClockIn(instant: Date, timeZone?: string | null): WallClock {
  const out: Record<string, number> = {};
  for (const p of formatterFor(resolveTimeZone(timeZone)).formatToParts(instant)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour === 24 ? 0 : out.hour,
    minute: out.minute,
    second: out.second,
  };
}

function two(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function wallDateString(w: Pick<WallClock, 'year' | 'month' | 'day'>): string {
  return `${w.year}-${two(w.month)}-${two(w.day)}`;
}

/**
 * Date logique d'un instant : date locale (fuseau du profil) sur l'HEURE MURALE, décalée d'un jour si l'heure est
 * avant le début de journée. Fondée sur l'heure murale (et non sur un décalage fixe en UTC) : correcte aussi les
 * jours de changement d'heure. Volontairement indépendante de `localDateWithDayStart` (règle globale inchangée).
 */
export function alcoholLogicalDate(instant: Date, timeZone: string | null | undefined, dayStartHour: number): string {
  const w = wallClockIn(instant, timeZone);
  const date = wallDateString(w);
  return w.hour < dayStartHour ? addDays(date, -1) : date;
}

/** Offset (ms) du fuseau à un instant : heure murale − UTC. */
function zoneOffsetMs(instantMs: number, timeZone: string | null | undefined): number {
  const w = wallClockIn(new Date(instantMs), timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/**
 * Heure murale saisie (AAAA-MM-JJ + HH:MM) → instant. Heure inexistante (saut de printemps) : décalée vers l'avant ;
 * heure ambiguë (retour d'automne) : première occurrence (heure d'été).
 */
export function wallClockToInstant(
  date: string,
  time: string,
  timeZone: string | null | undefined,
): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const tm = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!dm || !tm) return null;
  const [y, mo, d, h, mi] = [Number(dm[1]), Number(dm[2]), Number(dm[3]), Number(tm[1]), Number(tm[2])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const before = zoneOffsetMs(guess - 12 * 3_600_000, timeZone);
  const after = zoneOffsetMs(guess + 12 * 3_600_000, timeZone);
  const candidates = [...new Set([before, after])]
    .map((off) => guess - off)
    .filter((t) => {
      const w = wallClockIn(new Date(t), timeZone);
      return w.year === y && w.month === mo && w.day === d && w.hour === h && w.minute === mi;
    })
    .sort((x, z) => x - z);
  return new Date(candidates.length > 0 ? candidates[0] : guess - before);
}

export function formatClockInput(instant: Date, timeZone: string | null | undefined): { date: string; time: string } {
  const w = wallClockIn(instant, timeZone);
  return { date: wallDateString(w), time: `${two(w.hour)}:${two(w.minute)}` };
}

export function weekBounds(logicalDate: string): { start: string; end: string } {
  return weekBoundsMondaySunday(logicalDate);
}

// ───────────────────────── Chrono, objectifs, suggestion ─────────────────────────

export type SinceKind = 'last_drink' | 'confirmed_start';

export interface SinceInfo {
  kind: SinceKind;
  sinceIso: string;
  elapsedSec: number;
  clockAnomaly: boolean;
}

/**
 * Référence du chrono : la plus récente entre la dernière boisson enregistrée et un départ explicitement confirmé.
 * Aucune des deux : `null` (on ne suppose rien). Calculé depuis des horodatages, jamais d'un compteur stocké.
 */
export function computeSince(
  lastDrinkIso: string | null,
  startMarkerIso: string | null,
  nowMs: number,
): SinceInfo | null {
  const drink = lastDrinkIso ? Date.parse(lastDrinkIso) : NaN;
  const start = startMarkerIso ? Date.parse(startMarkerIso) : NaN;
  let kind: SinceKind;
  let ms: number;
  if (Number.isFinite(drink) && (!Number.isFinite(start) || drink >= start)) {
    kind = 'last_drink';
    ms = drink;
  } else if (Number.isFinite(start)) {
    kind = 'confirmed_start';
    ms = start;
  } else {
    return null;
  }
  const diff = nowMs - ms;
  return {
    kind,
    sinceIso: new Date(ms).toISOString(),
    elapsedSec: diff > 0 ? Math.floor(diff / 1000) : 0,
    clockAnomaly: diff < 0,
  };
}

export function formatElapsedSince(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const days = Math.floor(s / 86_400);
  const hours = Math.floor((s % 86_400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (days > 0) return `${days} j ${hours} h`;
  if (hours > 0) return `${hours} h ${two(minutes)} min`;
  return `${minutes} min`;
}

export interface WeekFacts {
  weekStart: string;
  totalMg: number;
  documentedDays: number;
  complete: boolean;
}

export const SUGGESTION_MIN_DOCUMENTED_DAYS = 5;
export const SUGGESTION_MIN_WEEKS = 2;
export const SUGGESTION_MIN_AVG_MG = 2 * STANDARD_DRINK_MG;
export const SUGGESTION_COOLDOWN_DAYS = 28;
export const SUGGESTION_STEP_MG = STANDARD_DRINK_MG / 2;

export interface GoalSuggestion {
  weeksUsed: number;
  averageMg: number;
  proposedMg: number;
  message: string;
}

/**
 * Suggestion de réduction progressive, jamais automatique :
 *  - uniquement semaines COMPLÈTES avec au moins 5 jours renseignés (boissons ou « aucune boisson » déclaré) ;
 *    une semaine sans saisie n'est jamais traitée comme zéro ;
 *  - au moins 2 semaines renseignées parmi les plus récentes ;
 *  - proposition = moyenne − 10 %, arrondie à 0,5 verre vers le bas, et strictement sous l'objectif actuel s'il existe ;
 *  - pas de proposition si la moyenne est déjà ≤ 2 verres/semaine ;
 *  - silence de 4 semaines après tout changement d'objectif ou refus (pas d'escalade après chaque réussite).
 */
export function computeGoalSuggestion(args: {
  completedWeeksNewestFirst: WeekFacts[];
  currentGoalMg: number | null;
  lastGoalChangeMs: number | null;
  lastDismissMs: number | null;
  nowMs: number;
}): GoalSuggestion | null {
  const cooldownMs = SUGGESTION_COOLDOWN_DAYS * 86_400_000;
  if (args.lastGoalChangeMs != null && args.nowMs - args.lastGoalChangeMs < cooldownMs) return null;
  if (args.lastDismissMs != null && args.nowMs - args.lastDismissMs < cooldownMs) return null;

  const usable = args.completedWeeksNewestFirst
    .filter((w) => w.complete && w.documentedDays >= SUGGESTION_MIN_DOCUMENTED_DAYS)
    .slice(0, 4);
  if (usable.length < SUGGESTION_MIN_WEEKS) return null;

  const averageMg = Math.round(usable.reduce((s, w) => s + w.totalMg, 0) / usable.length);
  if (averageMg <= SUGGESTION_MIN_AVG_MG) return null;
  const reduced = Math.floor((averageMg * 0.9) / SUGGESTION_STEP_MG) * SUGGESTION_STEP_MG;
  if (reduced >= averageMg) return null;
  if (args.currentGoalMg != null && reduced >= args.currentGoalMg) return null;

  return {
    weeksUsed: usable.length,
    averageMg,
    proposedMg: reduced,
    message:
      `Tu as enregistré ${formatDrinks(averageMg)} unités par semaine sur les ${usable.length} dernières semaines ` +
      `renseignées (jours non renseignés non comptés) ; objectif proposé : ${formatDrinks(reduced)} par semaine.`,
  };
}
