import type { Db } from '../../data/db/client';
import type { SqlRunner } from '../../data/db/sqlRunner';
import {
  ENEMY_DEFS,
  FIRST_WIN_ITEM_ID,
  FORGE_BUILDING_ID,
  FORGE_DAMAGE_PER_LEVEL,
  FORGE_LEVEL_LABELS,
  FORGE_MAX_LEVEL,
  FORGE_UPGRADE_COST,
  HERO_BASE_DAMAGE,
  THORN_GUARDIAN_ID,
  type EnemyId,
} from '../../data/content/kingdom';
import * as kingdomRepo from '../../data/db/repositories/kingdomRepo';
import * as profileRepo from '../../data/db/repositories/profileRepo';
import * as rpgRepo from '../../data/db/repositories/rpgRepo';
import {
  applyPlayerAction,
  createInitialCombat,
  enemyDisplayName,
  skillAffordable,
  type CombatAction,
  previewForgeDamageBonus,
} from '../combat/combatEngine';
import type { ClassId } from '../models/types';

type Conn = Db | SqlRunner;

export function forgeUpgradeKey(level: number): string {
  return `building:${FORGE_BUILDING_ID}:level:${level}`;
}

export async function getKingdomView(db: Conn) {
  await kingdomRepo.ensureKingdomDefaults(db);
  const forge = await kingdomRepo.getForgeLevel(db);
  const combat = await kingdomRepo.getCombatState(db);
  const gold = await rpgRepo.getGoldBalance(db);
  const profile = await profileRepo.getProfile(db);
  const classId = (profile?.classId ?? 'rodeur') as ClassId;
  const nextLevel = forge.level < FORGE_MAX_LEVEL ? ((forge.level + 1) as 1 | 2) : null;
  const upgradeCost = nextLevel ? FORGE_UPGRADE_COST[nextLevel] : null;
  return {
    forge: {
      level: forge.level,
      label: FORGE_LEVEL_LABELS[forge.level] ?? FORGE_LEVEL_LABELS[0],
      nextLevel,
      upgradeCost,
      damageBonus: forge.level * FORGE_DAMAGE_PER_LEVEL,
      baseDamagePreview: previewForgeDamageBonus(forge.level),
    },
    gold,
    combat,
    classId,
    canUpgrade: !!(nextLevel && upgradeCost !== null && gold >= upgradeCost),
    hasTrophy: combat.firstWinRewarded,
    enemies: Object.values(ENEMY_DEFS).map((e) => ({ id: e.id, name: e.name, baseHp: e.baseHp })),
  };
}

export type ForgeUpgradeResult = {
  ok: boolean;
  code?: string;
  message: string;
  status?: 'spent' | 'duplicate' | 'inconsistent';
};

export async function confirmForgeUpgrade(
  db: Db,
  expectedCurrentLevel: number,
): Promise<ForgeUpgradeResult> {
  if (!Number.isInteger(expectedCurrentLevel) || expectedCurrentLevel < 0 || expectedCurrentLevel > FORGE_MAX_LEVEL) {
    return { ok: false, code: 'invalid_level', message: 'Niveau de forge invalide.', status: 'inconsistent' };
  }
  let result: ForgeUpgradeResult = { ok: false, message: 'Impossible.' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const forge = await kingdomRepo.getForgeLevel(tx);
    if (forge.level !== expectedCurrentLevel) {
      result = {
        ok: false,
        code: 'level_mismatch',
        message: `La forge est au niveau ${forge.level} (attendu ${expectedCurrentLevel}). Rafraîchis et réessaie.`,
        status: 'inconsistent',
      };
      return;
    }
    if (forge.level >= FORGE_MAX_LEVEL) {
      result = { ok: false, code: 'max_level', message: 'La forge est déjà au maximum.' };
      return;
    }
    const next = (forge.level + 1) as 1 | 2;
    const cost = FORGE_UPGRADE_COST[next];
    const key = forgeUpgradeKey(next);
    const spent = await rpgRepo.spendGold(tx, cost, `forge upgrade ${next}`, key);
    if (spent === 'insufficient') {
      result = { ok: false, code: 'insufficient', message: `Il manque de l'or (${cost} requis).` };
      return;
    }
    if (spent === 'duplicate') {
      const current = await kingdomRepo.getForgeLevel(tx);
      if (current.level >= next) {
        result = {
          ok: true,
          code: 'duplicate',
          message: `Forge déjà au niveau ${current.level}.`,
          status: 'duplicate',
        };
        return;
      }
      result = {
        ok: false,
        code: 'inconsistent',
        message: 'Dépense déjà enregistrée mais le niveau de forge est incohérent.',
        status: 'inconsistent',
      };
      return;
    }
    const now = new Date().toISOString();
    await kingdomRepo.setForgeLevel(tx, next, now);
    result = {
      ok: true,
      message: `${FORGE_LEVEL_LABELS[next]} — +${FORGE_DAMAGE_PER_LEVEL} dégât de base au combat.`,
      status: 'spent',
    };
  });
  return result;
}

async function resolveProfileClass(db: Conn): Promise<ClassId> {
  const p = await profileRepo.getProfile(db);
  return (p?.classId ?? 'rodeur') as ClassId;
}

function resolveEnemyId(id?: string): EnemyId {
  return id === 'mist_wolf' ? 'mist_wolf' : THORN_GUARDIAN_ID;
}

export async function startCombat(db: Db, enemyId?: EnemyId): Promise<{ ok: boolean; message: string }> {
  const target = resolveEnemyId(enemyId);
  let result = { ok: false, message: 'Combat indisponible.' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const stored = await kingdomRepo.getCombatState(tx);
    if (stored.active && !stored.outcome) {
      result = {
        ok: true,
        message: `Reprise du combat contre ${enemyDisplayName(stored.enemyId)}.`,
      };
      return;
    }
    const forge = await kingdomRepo.getForgeLevel(tx);
    const snap = createInitialCombat(forge.level, target);
    const now = new Date().toISOString();
    await kingdomRepo.saveCombatState(tx, {
      ...snap,
      active: true,
      firstWinRewarded: stored.firstWinRewarded,
      updatedAt: now,
    });
    result = { ok: true, message: `${enemyDisplayName(target)} t'attend à l'arène.` };
  });
  return result;
}

export async function performCombatAction(
  db: Db,
  action: CombatAction,
  clientTurn: number,
  clientRevision: string,
): Promise<{ ok: boolean; code?: string; message: string }> {
  let result: { ok: boolean; code?: string; message: string } = { ok: false, message: 'Action impossible.' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const stored = await kingdomRepo.getCombatState(tx);
    if (!stored.active || stored.outcome) {
      result = { ok: false, message: 'Aucun combat actif.' };
      return;
    }
    if (stored.turnNumber !== clientTurn || stored.updatedAt !== clientRevision) {
      result = {
        ok: false,
        code: 'stale',
        message: 'Tour déjà résolu — le combat a avancé, réessaie.',
      };
      return;
    }
    if (action === 'skill' && !skillAffordable(stored)) {
      result = { ok: false, code: 'no_concentration', message: 'Concentration insuffisante pour la compétence.' };
      return;
    }
    const forge = await kingdomRepo.getForgeLevel(tx);
    const classId = await resolveProfileClass(tx);
    const updated = applyPlayerAction(stored, action, {
      baseDamage: HERO_BASE_DAMAGE,
      forgeLevel: forge.level,
      classId,
    });
    const now = new Date().toISOString();
    const next = {
      ...updated,
      active: !updated.outcome,
      firstWinRewarded: stored.firstWinRewarded,
      updatedAt: now,
    };

    if (updated.outcome === 'victory' && !stored.firstWinRewarded) {
      const banner = await rpgRepo.grantItemOnce(tx, FIRST_WIN_ITEM_ID);
      if (banner === 'granted') next.firstWinRewarded = true;
    } else if (stored.firstWinRewarded) {
      next.firstWinRewarded = true;
    }

    await kingdomRepo.saveCombatState(tx, next);
    const last = updated.log[updated.log.length - 1] ?? '';
    if (updated.outcome === 'victory' && !stored.firstWinRewarded) {
      result = { ok: true, message: `${last} Bannière du bastion ajoutée à l'inventaire.` };
    } else if (updated.outcome === 'defeat') {
      result = { ok: true, message: `${last} Tu peux réessayer.` };
    } else {
      result = { ok: true, message: last };
    }
  });
  return result;
}

export async function dismissCombat(db: Db): Promise<void> {
  await db.withExclusiveTransactionAsync(async (tx) => {
    const stored = await kingdomRepo.getCombatState(tx);
    if (!stored.outcome) return;
    const now = new Date().toISOString();
    await kingdomRepo.saveCombatState(tx, {
      ...createInitialCombat((await kingdomRepo.getForgeLevel(tx)).level, stored.enemyId),
      active: false,
      firstWinRewarded: stored.firstWinRewarded,
      updatedAt: now,
    });
  });
}

export function skillNameForClass(classId: ClassId): string {
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