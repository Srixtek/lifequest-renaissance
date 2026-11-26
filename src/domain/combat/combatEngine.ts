import type { ClassId } from '../models/types';
import {
  CONCENTRATION_MAX,
  CONCENTRATION_START,
  DEFEND_CONCENTRATION_GAIN,
  DEFEND_DAMAGE_FACTOR,
  ENEMY_BRACE_CHIP_DAMAGE,
  ENEMY_BRACE_DAMAGE_FACTOR,
  ENEMY_DEFS,
  GUARDIAN_DEFEND_FACTOR,
  HERO_BASE_DAMAGE,
  HERO_BASE_HP,
  SKILL_CONCENTRATION_COST,
  THORN_GUARDIAN_ID,
  type EnemyId,
} from '../../data/content/kingdom';

export type EnemyIntent = 'normal' | 'heavy' | 'brace';
export type CombatAction = 'attack' | 'defend' | 'skill';
export type CombatOutcome = 'victory' | 'defeat' | null;

export interface CombatSnapshot {
  heroHp: number;
  heroHpMax: number;
  enemyHp: number;
  enemyHpMax: number;
  turnNumber: number;
  enemyIntent: EnemyIntent;
  enemyIntentIndex: number;
  enemyId: EnemyId;
  concentration: number;
  heroGuarding: boolean;
  outcome: CombatOutcome;
  log: string[];
}

export interface CombatDerivedStats {
  baseDamage: number;
  forgeLevel: number;
  classId: ClassId;
}

function enemyDef(id: EnemyId) {
  return ENEMY_DEFS[id] ?? ENEMY_DEFS[THORN_GUARDIAN_ID];
}

function skillLabel(classId: ClassId): string {
  switch (classId) {
    case 'rodeur':
      return 'Tir précis';
    case 'gardien':
      return 'Rempart';
    case 'sage':
      return 'Soin des branches';
    case 'artisan':
      return 'Coup de forge';
    default:
      return 'Compétence';
  }
}

function intentLabel(intent: EnemyIntent): string {
  switch (intent) {
    case 'heavy':
      return 'frappe lourde annoncée';
    case 'brace':
      return 'se met en défense';
    default:
      return 'attaque normale';
  }
}

export function createInitialCombat(forgeLevel: number, enemyId: EnemyId = THORN_GUARDIAN_ID): CombatSnapshot {
  const def = enemyDef(enemyId);
  const firstIntent = def.intentPattern[0] ?? 'normal';
  return {
    heroHp: HERO_BASE_HP,
    heroHpMax: HERO_BASE_HP,
    enemyHp: def.baseHp,
    enemyHpMax: def.baseHp,
    turnNumber: 1,
    enemyIntent: firstIntent,
    enemyIntentIndex: 0,
    enemyId,
    concentration: CONCENTRATION_START,
    heroGuarding: false,
    outcome: null,
    log: [`${def.name} bloque l'entrée du bastion. Intention : ${intentLabel(firstIntent)}.`],
  };
}

function heroDamage(stats: CombatDerivedStats, skill: boolean): number {
  let dmg = stats.baseDamage + stats.forgeLevel;
  if (skill) {
    switch (stats.classId) {
      case 'rodeur':
        dmg += 4;
        break;
      case 'gardien':
        dmg += 2;
        break;
      case 'sage':
        dmg += 1;
        break;
      case 'artisan':
        dmg += 2 + stats.forgeLevel;
        break;
      default:
        break;
    }
  }
  return Math.max(1, dmg);
}

function applyDamageToEnemy(
  hp: number,
  rawDamage: number,
  enemyIntent: EnemyIntent,
): { hp: number; dealt: number } {
  let factor = 1;
  if (enemyIntent === 'brace') factor = ENEMY_BRACE_DAMAGE_FACTOR;
  const dealt = Math.max(1, Math.floor(rawDamage * factor));
  return { hp: Math.max(0, hp - dealt), dealt };
}

function enemyDamage(
  def: (typeof ENEMY_DEFS)[EnemyId],
  intent: EnemyIntent,
  heroGuarding: boolean,
  guardianSkill: boolean,
): number {
  if (intent === 'brace') return ENEMY_BRACE_CHIP_DAMAGE;
  const raw = intent === 'heavy' ? def.heavyDamage : def.normalDamage;
  if (guardianSkill) return Math.max(1, Math.floor(raw * GUARDIAN_DEFEND_FACTOR));
  if (heroGuarding) return Math.max(1, Math.floor(raw * DEFEND_DAMAGE_FACTOR));
  return raw;
}

function advanceIntent(def: (typeof ENEMY_DEFS)[EnemyId], index: number): { intent: EnemyIntent; index: number } {
  const pattern = def.intentPattern;
  if (!pattern.length) return { intent: 'normal', index: 0 };
  const nextIndex = (index + 1) % pattern.length;
  return { intent: pattern[nextIndex] ?? 'normal', index: nextIndex };
}

export function skillAffordable(state: CombatSnapshot): boolean {
  return state.concentration >= SKILL_CONCENTRATION_COST;
}

export function applyPlayerAction(
  state: CombatSnapshot,
  action: CombatAction,
  stats: CombatDerivedStats,
): CombatSnapshot {
  if (state.outcome) return state;

  const def = enemyDef(state.enemyId);
  const next: CombatSnapshot = {
    ...state,
    log: [...state.log],
    heroGuarding: false,
  };

  let guardianSkillGuard = false;
  let lastFx: 'hit' | 'defend' | null = null;

  if (action === 'attack') {
    const dmg = heroDamage(stats, false);
    const res = applyDamageToEnemy(next.enemyHp, dmg, next.enemyIntent);
    next.enemyHp = res.hp;
    next.log.push(`Tu frappes pour ${res.dealt} dégâts.`);
    lastFx = 'hit';
  } else if (action === 'defend') {
    next.heroGuarding = true;
    next.concentration = Math.min(CONCENTRATION_MAX, next.concentration + DEFEND_CONCENTRATION_GAIN);
    next.log.push(`Tu te mets en défense (+${DEFEND_CONCENTRATION_GAIN} concentration).`);
    lastFx = 'defend';
  } else if (action === 'skill') {
    if (next.concentration < SKILL_CONCENTRATION_COST) {
      return { ...state, log: [...state.log, `Pas assez de concentration (${SKILL_CONCENTRATION_COST} requise).`] };
    }
    next.concentration -= SKILL_CONCENTRATION_COST;
    const label = skillLabel(stats.classId);
    switch (stats.classId) {
      case 'rodeur': {
        const dmg = heroDamage(stats, true);
        const res = applyDamageToEnemy(next.enemyHp, dmg, next.enemyIntent);
        next.enemyHp = res.hp;
        next.log.push(`${label} : ${res.dealt} dégâts précis.`);
        lastFx = 'hit';
        break;
      }
      case 'gardien':
        next.heroGuarding = true;
        guardianSkillGuard = true;
        next.log.push(`${label} : tu encaisses bien moins ce tour.`);
        lastFx = 'defend';
        break;
      case 'sage': {
        const heal = 6;
        const before = next.heroHp;
        next.heroHp = Math.min(next.heroHpMax, next.heroHp + heal);
        next.log.push(`${label} : +${next.heroHp - before} PV.`);
        break;
      }
      case 'artisan': {
        const dmg = heroDamage(stats, true);
        const res = applyDamageToEnemy(next.enemyHp, dmg, next.enemyIntent);
        next.enemyHp = res.hp;
        next.log.push(`${label} : ${res.dealt} dégâts (bonus forge).`);
        lastFx = 'hit';
        break;
      }
      default:
        break;
    }
  }

  if (next.enemyHp <= 0) {
    next.outcome = 'victory';
    next.log.push(`${def.name} cède. Victoire !`);
    return next;
  }

  const resolvingIntent = next.enemyIntent;
  const enemyDmg = enemyDamage(def, resolvingIntent, next.heroGuarding, guardianSkillGuard);
  if (resolvingIntent === 'brace') {
    next.log.push(`${def.name} se prépare et observe ton prochain coup.`);
  }

  if (enemyDmg > 0) {
    const intentWord =
      resolvingIntent === 'heavy' ? 'frappe lourde' : resolvingIntent === 'brace' ? 'morsure' : 'attaque';
    next.heroHp = Math.max(0, next.heroHp - enemyDmg);
    next.log.push(`${def.name} — ${intentWord} : ${enemyDmg} dégâts.`);
    if (lastFx === 'defend' && enemyDmg < def.heavyDamage) {
      next.log.push('La défense a absorbé une partie des dégâts.');
    }
  }

  if (next.heroHp <= 0) {
    next.outcome = 'defeat';
    next.log.push('Tu tombes. Le bastion résiste encore…');
    return next;
  }

  const advanced = advanceIntent(def, next.enemyIntentIndex);
  next.enemyIntent = advanced.intent;
  next.enemyIntentIndex = advanced.index;
  next.turnNumber += 1;
  next.log.push(`Prochaine intention : ${intentLabel(next.enemyIntent)}.`);

  return next;
}

export function maxCombatTurnsEstimate(enemyId: EnemyId = THORN_GUARDIAN_ID): number {
  const def = enemyDef(enemyId);
  const dps = HERO_BASE_DAMAGE;
  return Math.ceil(def.baseHp / dps) + def.intentPattern.length + 2;
}

export function previewForgeDamageBonus(forgeLevel: number): number {
  return HERO_BASE_DAMAGE + forgeLevel;
}

export function enemyDisplayName(enemyId: EnemyId): string {
  return enemyDef(enemyId).name;
}