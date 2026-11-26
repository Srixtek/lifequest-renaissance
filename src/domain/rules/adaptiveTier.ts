export type InformedOutcome = 'success' | 'failure';

export interface TierSuggestion {
  tierIndex: number;
  adjusted: boolean;
  message: string | null;
}

/**
 * Règle adaptative : parmi les 3 dernières tentatives renseignées (succès/échec),
 * 2 succès → palier suivant ; 2 échecs → palier inférieur ; sinon inchangé.
 * Les « unknown » et tentatives en cours sont ignorées.
 */
export function suggestTierIndex(
  currentTier: number,
  recentInformed: InformedOutcome[],
  maxTier: number,
): TierSuggestion {
  const tier = Math.max(0, Math.min(currentTier, maxTier));
  const last3 = recentInformed.slice(0, 3);
  if (last3.length < 3) {
    return { tierIndex: tier, adjusted: false, message: null };
  }
  const successes = last3.filter((o) => o === 'success').length;
  const failures = last3.filter((o) => o === 'failure').length;
  if (successes >= 2) {
    const up = Math.min(tier + 1, maxTier);
    if (up === tier) return { tierIndex: tier, adjusted: false, message: null };
    return {
      tierIndex: up,
      adjusted: true,
      message: 'Défi ajusté à ton rythme — palier un peu plus exigeant proposé.',
    };
  }
  if (failures >= 2) {
    const down = Math.max(tier - 1, 0);
    if (down === tier) return { tierIndex: tier, adjusted: false, message: null };
    return {
      tierIndex: down,
      adjusted: true,
      message: 'Défi ajusté à ton rythme — palier un peu plus doux proposé.',
    };
  }
  return { tierIndex: tier, adjusted: false, message: null };
}

export function informedOutcomesFromAttempts(
  outcomes: Array<'success' | 'failure' | 'unknown' | 'running'>,
): InformedOutcome[] {
  const list: InformedOutcome[] = [];
  for (const o of outcomes) {
    if (o === 'success' || o === 'failure') list.push(o);
  }
  return list;
}