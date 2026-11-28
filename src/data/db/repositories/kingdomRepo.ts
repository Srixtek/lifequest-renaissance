import type { Db } from '../client';
import type { SqlRunner } from '../sqlRunner';
import {
  CONCENTRATION_START,
  normalizeEnemyId,
  normalizeEnemyIntent,
  type EnemyId,
} from '../../../data/content/kingdom';
import type { CombatOutcome, CombatSnapshot, EnemyIntent } from '../../../domain/combat/combatEngine';

type Conn = Db | SqlRunner;

export type CombatMode = 'arena' | 'campaign';

export interface ForgeState {
  level: number;
  updatedAt: string;
}

export interface StoredCombat extends CombatSnapshot {
  active: boolean;
  firstWinRewarded: boolean;
  combatMode: CombatMode;
  campaignStageId: string | null;
  updatedAt: string;
}

function rowToCombat(r: Record<string, unknown>): StoredCombat {
  return {
    active: !!r.active,
    heroHp: Number(r.hero_hp),
    heroHpMax: Number(r.hero_hp_max),
    enemyHp: Number(r.enemy_hp),
    enemyHpMax: Number(r.enemy_hp_max),
    turnNumber: Number(r.turn_number),
    enemyIntent: normalizeEnemyIntent(String(r.enemy_intent)) as EnemyIntent,
    enemyIntentIndex: Number(r.enemy_intent_index ?? 0),
    enemyId: normalizeEnemyId(r.enemy_id),
    enemyPhase: Number(r.enemy_phase ?? 0),
    concentration: Number(r.concentration ?? CONCENTRATION_START),
    heroGuarding: !!r.hero_guarding,
    outcome: (r.outcome as CombatOutcome) ?? null,
    log: JSON.parse(String(r.log_json || '[]')),
    firstWinRewarded: !!r.first_win_rewarded,
    combatMode: r.combat_mode === 'campaign' ? 'campaign' : 'arena',
    campaignStageId: r.campaign_stage_id ? String(r.campaign_stage_id) : null,
    updatedAt: String(r.updated_at),
  };
}

export async function ensureKingdomDefaults(db: Conn): Promise<void> {
  const forge = await db.getFirstAsync('SELECT 1 AS ok FROM kingdom_buildings WHERE building_id = ?', 'forge');
  if (!forge) {
    await db.runAsync(
      `INSERT INTO kingdom_buildings (building_id, level, updated_at) VALUES ('forge', 0, ?)`,
      new Date().toISOString(),
    );
  }
  const combat = await db.getFirstAsync('SELECT 1 AS ok FROM kingdom_combat WHERE id = 1');
  if (!combat) {
    await db.runAsync(
      `INSERT INTO kingdom_combat (
        id, active, hero_hp, hero_hp_max, enemy_hp, enemy_hp_max,
        turn_number, enemy_intent, enemy_intent_index, enemy_id, enemy_phase, concentration,
        hero_guarding, skill_cooldown, outcome, log_json, first_win_rewarded,
        combat_mode, campaign_stage_id, updated_at
      ) VALUES (1, 0, 0, 0, 0, 0, 0, 'normal', 0, 'thorn_guardian', 0, 1, 0, 0, NULL, '[]', 0, 'arena', NULL, ?)`,
      new Date().toISOString(),
    );
  }
}

export async function getForgeLevel(db: Conn): Promise<ForgeState> {
  const r = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT level, updated_at FROM kingdom_buildings WHERE building_id = 'forge'`,
  );
  if (!r) return { level: 0, updatedAt: new Date().toISOString() };
  return { level: Number(r.level ?? 0), updatedAt: String(r.updated_at) };
}

export async function setForgeLevel(db: Conn, level: number, updatedAt: string): Promise<void> {
  await db.runAsync(
    `UPDATE kingdom_buildings SET level = ?, updated_at = ? WHERE building_id = 'forge'`,
    level,
    updatedAt,
  );
}

export async function getCombatState(db: Conn): Promise<StoredCombat> {
  const r = await db.getFirstAsync<Record<string, unknown>>(`SELECT * FROM kingdom_combat WHERE id = 1`);
  if (!r) throw new Error('kingdom_combat manquant');
  return rowToCombat(r);
}

export async function saveCombatState(db: Conn, state: StoredCombat): Promise<void> {
  await db.runAsync(
    `UPDATE kingdom_combat SET
      active = ?, hero_hp = ?, hero_hp_max = ?, enemy_hp = ?, enemy_hp_max = ?,
      turn_number = ?, enemy_intent = ?, enemy_intent_index = ?, enemy_id = ?, enemy_phase = ?, concentration = ?,
      hero_guarding = ?, outcome = ?, log_json = ?, first_win_rewarded = ?,
      combat_mode = ?, campaign_stage_id = ?, updated_at = ?
     WHERE id = 1`,
    state.active ? 1 : 0,
    state.heroHp,
    state.heroHpMax,
    state.enemyHp,
    state.enemyHpMax,
    state.turnNumber,
    state.enemyIntent,
    state.enemyIntentIndex,
    state.enemyId,
    state.enemyPhase,
    state.concentration,
    state.heroGuarding ? 1 : 0,
    state.outcome,
    JSON.stringify(state.log),
    state.firstWinRewarded ? 1 : 0,
    state.combatMode,
    state.campaignStageId,
    state.updatedAt,
  );
}