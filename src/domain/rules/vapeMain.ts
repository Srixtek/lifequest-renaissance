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

/** Paliers traités par confirmation : borne le travail SQLite pour un intervalle de plusieurs mois. Le reste reste à valider. */
export const MAX_STEPS_PER_CLAIM = 2000;

export interface ClaimAllocation {
  /** Bonus de record réellement payés (or > 0) : un bonus à 0 or n'est jamais consommé. */
  records: Array<{ minutes: number; gold: number }>;
  /** Paliers payés (or > 0). */
  paidSteps: Array<{ step: number; gold: number }>;
  /** Paliers validés à 0 or (plafond atteint) : consommés, jamais payés plus tard. */
  zeroGoldSteps: number[];
  granted: number;
}

/**
 * Répartition d'un plafond d'or restant : bonus de record d'abord, puis paliers dans l'ordre.
 * Unique source de vérité pour l'aperçu (UI) et la réclamation (même résultat, même ordre).
 */
export function allocateClaim(
  records: ReadonlyArray<{ minutes: number; gold: number }>,
  stepNumbers: ReadonlyArray<number>,
  remainingGold: number,
): ClaimAllocation {
  let left = Math.max(0, Math.floor(remainingGold));
  const out: ClaimAllocation = { records: [], paidSteps: [], zeroGoldSteps: [], granted: 0 };
  for (const r of records) {
    const gold = Math.min(r.gold, left);
    if (gold <= 0) continue;
    out.records.push({ minutes: r.minutes, gold });
    out.granted += gold;
    left -= gold;
  }
  for (const step of stepNumbers) {
    const gold = Math.min(VAPE_STEP_GOLD, left);
    if (gold > 0) {
      out.paidSteps.push({ step, gold });
      out.granted += gold;
      left -= gold;
    } else {
      out.zeroGoldSteps.push(step);
    }
  }
  return out;
}

export interface ClaimOfferTexts {
  summary: string;
  confirmLabel: string;
  zeroGold: boolean;
}

/** Textes de l'offre de validation : jamais de promesse d'or ou de bonus que le plafond du jour interdit. */
export function claimOfferTexts(o: {
  stepsPending: number;
  recordBonusCount: number;
  creditableGold: number;
  dailyGoldRemaining: number;
  dailyGoldCap: number;
}): ClaimOfferTexts {
  const steps = `${o.stepsPending} palier${o.stepsPending > 1 ? 's' : ''} de 30 min`;
  if (o.creditableGold <= 0) {
    return {
      zeroGold: true,
      summary:
        `${steps} atteint${o.stepsPending > 1 ? 's' : ''}. Plafond d'or du jour atteint (${o.dailyGoldCap} or) : ` +
        'tu peux valider, 0 or (plafond atteint). Une fois validé, un palier ne rapporte plus jamais d\'or.',
      confirmLabel: 'Oui, valider (0 or)',
    };
  }
  const bonus = o.recordBonusCount > 0 ? ' + bonus de record' : '';
  const base = o.stepsPending > 0 ? `${steps} à confirmer${bonus}` : `Bonus de record à confirmer`;
  return {
    zeroGold: false,
    summary: `${base} : +${o.creditableGold} or (plafond du jour : ${o.dailyGoldRemaining} or restants).`,
    confirmLabel: `Oui, je confirme (+${o.creditableGold} or)`,
  };
}
