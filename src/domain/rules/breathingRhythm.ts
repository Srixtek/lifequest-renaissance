export const BREATH_INSPIRE_MS = 4000;
export const BREATH_EXPIRE_MS = 6000;
export const BREATH_CYCLE_MS = BREATH_INSPIRE_MS + BREATH_EXPIRE_MS;

export type BreathPhase = 'inspire' | 'expire';

/** Phase du rythme 4s inspire / 6s expire à partir d'une durée écoulée (ms). */
export function breathPhaseAtElapsedMs(elapsedMs: number): BreathPhase {
  const t = Math.max(0, elapsedMs) % BREATH_CYCLE_MS;
  return t < BREATH_INSPIRE_MS ? 'inspire' : 'expire';
}