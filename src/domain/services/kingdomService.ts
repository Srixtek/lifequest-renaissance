import type { Db } from '../../data/db/client';
import type { SqlRunner } from '../../data/db/sqlRunner';
import {
  ARENA_ENEMY_DEFS,
  FIRST_WIN_ITEM_ID,
  FORGE_BUILDING_ID,
  FORGE_DAMAGE_PER_LEVEL,
  FORGE_LEVEL_LABELS,
  FORGE_MAX_LEVEL,
  FORGE_UPGRADE_COST,
  HERO_BASE_DAMAGE,
  THORN_GUARDIAN_ID,
  type ArenaEnemyId,
  type EnemyId,
} from '../../data/content/kingdom';
import {
  CAMPAIGN_TROPHY_ITEM_ID,
  ELORIA_CAMPAIGN_ZONE,
  campaignFirstWinKey,
  stageById,
} from '../../data/content/eloriaCampaign';
import * as campaignRepo from '../../data/db/repositories/campaignRepo';
import * as kingdomRepo from '../../data/db/repositories/kingdomRepo';
import * as combatVictoryRepo from '../../data/db/repositories/combatVictoryRepo';
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
  await campaignRepo.ensureCampaignDefaults(db);
  const forge = await kingdomRepo.getForgeLevel(db);
  const combat = await kingdomRepo.getCombatState(db);
  const gold = await rpgRepo.getGoldBalance(db);
  const profile = await profileRepo.getProfile(db);
  const classId = (profile?.classId ?? 'rodeur') as ClassId;
  const nextLevel = forge.level < FORGE_MAX_LEVEL ? ((forge.level + 1) as 1 | 2) : null;
  const upgradeCost = nextLevel ? FORGE_UPGRADE_COST[nextLevel] : null;
  const campaignProgress = await campaignRepo.getCampaignProgress(db);
  const campaignStages = campaignRepo.buildStageBoard(campaignProgress);
  const inv = await db.getFirstAsync<{ quantity: number }>(
    'SELECT quantity FROM inventory_items WHERE item_id = ?',
    CAMPAIGN_TROPHY_ITEM_ID,
  );
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
    enemies: Object.values(ARENA_ENEMY_DEFS).map((e) => ({ id: e.id, name: e.name, baseHp: e.baseHp })),
    campaign: {
      zoneName: ELORIA_CAMPAIGN_ZONE,
      stages: campaignStages,
      highestUnlocked: campaignProgress.highestUnlocked,
      hasCampaignTrophy: !!inv,
      activeStageId:
        combat.combatMode === 'campaign' && combat.active && !combat.outcome ? combat.campaignStageId : null,
      canResumeCampaign:
        combat.combatMode === 'campaign' && (combat.active || !!combat.outcome) && !!combat.campaignStageId,
    },
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

function resolveArenaEnemyId(id?: string): ArenaEnemyId {
  return id === 'mist_wolf' ? 'mist_wolf' : THORN_GUARDIAN_ID;
}

function activeCombatBlocksNew(stored: Awaited<ReturnType<typeof kingdomRepo.getCombatState>>): boolean {
  return stored.active && !stored.outcome;
}

export async function startCombat(db: Db, enemyId?: ArenaEnemyId): Promise<{ ok: boolean; code?: string; message: string }> {
  const target = resolveArenaEnemyId(enemyId);
  let result: { ok: boolean; code?: string; message: string } = { ok: false, message: 'Combat indisponible.' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const stored = await kingdomRepo.getCombatState(tx);
    if (activeCombatBlocksNew(stored)) {
      if (stored.combatMode === 'campaign') {
        result = {
          ok: false,
          code: 'campaign_active',
          message: 'Une étape de campagne est en cours — reprends-la ou termine le combat.',
        };
        return;
      }
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
      combatMode: 'arena',
      campaignStageId: null,
      updatedAt: now,
    });
    result = { ok: true, message: `${enemyDisplayName(target)} t'attend à l'arène.` };
  });
  return result;
}

export async function startCampaignCombat(
  db: Db,
  stageId: string,
): Promise<{ ok: boolean; code?: string; message: string }> {
  const stage = stageById(stageId);
  if (!stage) return { ok: false, code: 'unknown_stage', message: 'Étape inconnue.' };

  let result: { ok: boolean; code?: string; message: string } = { ok: false, message: 'Combat indisponible.' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const progress = await campaignRepo.getCampaignProgress(tx);
    const cleared = progress.clearedStageIds.includes(stage.id);
    const status = campaignRepo.stageStatus(progress, stage.number, cleared);
    if (status === 'locked') {
      result = { ok: false, code: 'locked', message: 'Cette étape est encore verrouillée.' };
      return;
    }

    const stored = await kingdomRepo.getCombatState(tx);
    if (activeCombatBlocksNew(stored)) {
      if (stored.combatMode === 'campaign' && stored.campaignStageId === stageId) {
        result = {
          ok: true,
          message: `Reprise — ${stage.name} (${enemyDisplayName(stored.enemyId)}).`,
        };
        return;
      }
      if (stored.combatMode === 'arena') {
        result = {
          ok: false,
          code: 'arena_active',
          message: 'Un combat d\'arène est en cours — termine-le avant la campagne.',
        };
        return;
      }
      result = {
        ok: false,
        code: 'other_campaign',
        message: 'Un autre combat de campagne est actif.',
      };
      return;
    }

    if (
      stored.combatMode === 'campaign' &&
      stored.campaignStageId === stageId &&
      stored.active &&
      !stored.outcome
    ) {
      result = { ok: true, message: `Reprise — ${stage.name}.` };
      return;
    }

    const forge = await kingdomRepo.getForgeLevel(tx);
    const snap = createInitialCombat(
      forge.level,
      stage.enemyId as EnemyId,
      `${stage.name} — ${enemyDisplayName(stage.enemyId as EnemyId)}.`,
    );
    const now = new Date().toISOString();
    await kingdomRepo.saveCombatState(tx, {
      ...snap,
      active: true,
      firstWinRewarded: stored.firstWinRewarded,
      combatMode: 'campaign',
      campaignStageId: stageId,
      updatedAt: now,
    });
    result = { ok: true, message: `Campagne : ${stage.name} — ${snap.log[0] ?? 'Combat engagé.'}` };
  });
  return result;
}

async function applyCampaignVictory(
  tx: SqlRunner,
  stageId: string,
  now: string,
): Promise<{ goldLine: string; trophyLine: string }> {
  const stage = stageById(stageId);
  if (!stage) return { goldLine: '', trophyLine: '' };

  const progress = await campaignRepo.getCampaignProgress(tx);
  const nextProgress = campaignRepo.recordStageOutcome(progress, stageId, 'victory', now);
  await campaignRepo.saveCampaignProgress(tx, nextProgress);

  const key = campaignFirstWinKey(stageId);
  const goldResult = await rpgRepo.addGold(tx, stage.firstWinGold, `campagne ${stage.name}`, key);
  const goldLine =
    goldResult === 'inserted' ? `+${stage.firstWinGold} or (première victoire).` : 'Or déjà réclamé pour cette étape.';

  let trophyLine = '';
  if (stage.number === 10) {
    const tr = await rpgRepo.grantItemOnce(tx, CAMPAIGN_TROPHY_ITEM_ID);
    if (tr === 'granted') trophyLine = ' Emblème de la Forêt des Brumes obtenu !';
  }
  return { goldLine, trophyLine };
}

async function applyCampaignDefeat(tx: SqlRunner, stageId: string, now: string): Promise<void> {
  const progress = await campaignRepo.getCampaignProgress(tx);
  const nextProgress = campaignRepo.recordStageOutcome(progress, stageId, 'defeat', now);
  await campaignRepo.saveCampaignProgress(tx, nextProgress);
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
      combatMode: stored.combatMode,
      campaignStageId: stored.campaignStageId,
      updatedAt: now,
    };

    let rewardExtra = '';
    if (updated.outcome === 'victory' && stored.combatMode === 'arena' && !stored.firstWinRewarded) {
      const banner = await rpgRepo.grantItemOnce(tx, FIRST_WIN_ITEM_ID);
      if (banner === 'granted') next.firstWinRewarded = true;
    } else if (stored.firstWinRewarded) {
      next.firstWinRewarded = true;
    }

    if (updated.outcome === 'victory' && stored.combatMode === 'campaign' && stored.campaignStageId) {
      const { goldLine, trophyLine } = await applyCampaignVictory(tx, stored.campaignStageId, now);
      rewardExtra = ` ${goldLine}${trophyLine}`;
    } else if (updated.outcome === 'defeat' && stored.combatMode === 'campaign' && stored.campaignStageId) {
      await applyCampaignDefeat(tx, stored.campaignStageId, now);
    }

    await kingdomRepo.saveCombatState(tx, next);
    if (updated.outcome === 'victory' || updated.outcome === 'defeat') {
      if (stored.combatMode === 'arena') {
        await combatVictoryRepo.logCombatOutcome(tx, stored.enemyId, updated.outcome, now);
      }
    }
    const last = updated.log[updated.log.length - 1] ?? '';
    if (updated.outcome === 'victory' && stored.combatMode === 'arena' && !stored.firstWinRewarded) {
      result = { ok: true, message: `${last} Bannière du bastion ajoutée à l'inventaire.` };
    } else if (updated.outcome === 'victory' && stored.combatMode === 'campaign') {
      result = { ok: true, message: `${last}${rewardExtra}` };
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
    const forge = await kingdomRepo.getForgeLevel(tx);
    if (stored.combatMode === 'campaign' && stored.campaignStageId) {
      await kingdomRepo.saveCombatState(tx, {
        ...createInitialCombat(forge.level, stored.enemyId),
        active: false,
        firstWinRewarded: stored.firstWinRewarded,
        combatMode: 'campaign',
        campaignStageId: stored.campaignStageId,
        updatedAt: now,
      });
    } else {
      await kingdomRepo.saveCombatState(tx, {
        ...createInitialCombat(forge.level, stored.enemyId as ArenaEnemyId),
        active: false,
        firstWinRewarded: stored.firstWinRewarded,
        combatMode: 'arena',
        campaignStageId: null,
        updatedAt: now,
      });
    }
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