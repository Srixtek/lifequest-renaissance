import type { ClassId } from '../models/types';
import {
  DEFEND_DAMAGE_FACTOR,
  ENEMY_BASE_HP,
  ENEMY_NORMAL_DAMAGE,
  ENEMY_POWER_DAMAGE,
  GUARDIAN_DEFEND_FACTOR,
  HERO_BASE_DAMAGE,
  HERO_BASE_HP,
  SKILL_COOLDOWN_TURNS,
  THORN_GUARDIAN_NAME,
} from '../../data/content/kingdom';

export type EnemyIntent = 'normal' | 'power';
export type CombatAction = 'attack' | 'defend' | 'skill';
export type CombatOutcome = 'victory' | 'defeat' | null;

export interface CombatSnapshot {
  heroHp: number;
  heroHpMax: number;
  enemyHp: number;
  enemyHpMax: number;
  turnNumber: number;
  enemyIntent: EnemyIntent;
  heroGuarding: boolean;
  skillCooldown: number;
  outcome: CombatOutcome;
  log: string[];
}

export interface CombatDerivedStats {
  baseDamage: number;
  forgeLevel: number;
  classId: ClassId;
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

export function createInitialCombat(forgeLevel: number): CombatSnapshot {
  return {
    heroHp: HERO_BASE_HP,
    heroHpMax: HERO_BASE_HP,
    enemyHp: ENEMY_BASE_HP,
    enemyHpMax: ENEMY_BASE_HP,
    turnNumber: 1,
    enemyIntent: 'normal',
    heroGuarding: false,
    skillCooldown: 0,
    outcome: null,
    log: [`${THORN_GUARDIAN_NAME} bloque l'entrée du bastion.`],
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

function enemyDamage(intent: EnemyIntent, heroGuarding: boolean, guardianSkill: boolean): number {
  const raw = intent === 'power' ? ENEMY_POWER_DAMAGE : ENEMY_NORMAL_DAMAGE;
  if (guardianSkill) return Math.max(1, Math.floor(raw * GUARDIAN_DEFEND_FACTOR));
  if (heroGuarding) return Math.max(1, Math.floor(raw * DEFEND_DAMAGE_FACTOR));
  return raw;
}

export function applyPlayerAction(
  state: CombatSnapshot,
  action: CombatAction,
  stats: CombatDerivedStats,
): CombatSnapshot {
  if (state.outcome) return state;

  const next: CombatSnapshot = {
    ...state,
    log: [...state.log],
    heroGuarding: false,
  };

  let guardianSkillGuard = false;

  if (action === 'attack') {
    const dmg = heroDamage(stats, false);
    next.enemyHp = Math.max(0, next.enemyHp - dmg);
    next.log.push(`Tu frappes pour ${dmg} dégâts.`);
  } else if (action === 'defend') {
    next.heroGuarding = true;
    next.log.push('Tu te mets en défense.');
  } else if (action === 'skill') {
    if (next.skillCooldown > 0) {
      return { ...state, log: [...state.log, 'Compétence en recharge.'] };
    }
    next.skillCooldown = SKILL_COOLDOWN_TURNS;
    const label = skillLabel(stats.classId);
    switch (stats.classId) {
      case 'rodeur': {
        const dmg = heroDamage(stats, true);
        next.enemyHp = Math.max(0, next.enemyHp - dmg);
        next.log.push(`${label} : ${dmg} dégâts précis.`);
        break;
      }
      case 'gardien':
        next.heroGuarding = true;
        guardianSkillGuard = true;
        next.log.push(`${label} : tu encaisses bien moins ce tour.`);
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
        next.enemyHp = Math.max(0, next.enemyHp - dmg);
        next.log.push(`${label} : ${dmg} dégâts (bonus forge).`);
        break;
      }
      default:
        break;
    }
  }

  if (next.enemyHp <= 0) {
    next.outcome = 'victory';
    next.log.push(`${THORN_GUARDIAN_NAME} cède. Victoire !`);
    return next;
  }

  const enemyDmg = enemyDamage(next.enemyIntent, next.heroGuarding, guardianSkillGuard);
  const intentLabel = next.enemyIntent === 'power' ? 'frappe lourde' : 'attaque';
  next.heroHp = Math.max(0, next.heroHp - enemyDmg);
  next.log.push(`${THORN_GUARDIAN_NAME} ${intentLabel} : ${enemyDmg} dégâts.`);

  if (next.heroHp <= 0) {
    next.outcome = 'defeat';
    next.log.push('Tu tombes. Le bastion résiste encore…');
    return next;
  }

  next.enemyIntent = next.enemyIntent === 'normal' ? 'power' : 'normal';
  next.turnNumber += 1;
  if (next.skillCooldown > 0) next.skillCooldown -= 1;
  const nextIntent = next.enemyIntent === 'power' ? 'frappe lourde annoncée' : 'attaque normale';
  next.log.push(`Prochaine intention : ${nextIntent}.`);

  return next;
}

export function maxCombatTurnsEstimate(): number {
  return 8;
}

export function previewForgeDamageBonus(forgeLevel: number): number {
  return HERO_BASE_DAMAGE + forgeLevel;
}