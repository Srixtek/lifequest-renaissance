import type { Db } from '../client';
import type { SqlRunner } from '../sqlRunner';
import { ELORIA_CAMPAIGN_STAGES } from '../../../data/content/eloriaCampaign';

type Conn = Db | SqlRunner;

export type CampaignStageStatus = 'locked' | 'unlocked' | 'cleared';

export interface StageStats {
  wins: number;
  defeats: number;
}

export interface CampaignProgress {
  highestUnlocked: number;
  clearedStageIds: string[];
  stageStats: Record<string, StageStats>;
  updatedAt: string;
}

function parseProgress(r: Record<string, unknown>): CampaignProgress {
  let cleared: string[] = [];
  let stats: Record<string, StageStats> = {};
  try {
    cleared = JSON.parse(String(r.cleared_stages_json || '[]'));
  } catch {
    cleared = [];
  }
  try {
    stats = JSON.parse(String(r.stage_stats_json || '{}'));
  } catch {
    stats = {};
  }
  return {
    highestUnlocked: Number(r.highest_unlocked ?? 1),
    clearedStageIds: cleared,
    stageStats: stats,
    updatedAt: String(r.updated_at),
  };
}

export async function ensureCampaignDefaults(db: Conn): Promise<void> {
  const row = await db.getFirstAsync('SELECT 1 AS ok FROM kingdom_campaign WHERE id = 1');
  if (!row) {
    await db.runAsync(
      `INSERT INTO kingdom_campaign (id, highest_unlocked, cleared_stages_json, stage_stats_json, updated_at)
       VALUES (1, 1, '[]', '{}', ?)`,
      new Date().toISOString(),
    );
  }
}

export async function getCampaignProgress(db: Conn): Promise<CampaignProgress> {
  await ensureCampaignDefaults(db);
  const r = await db.getFirstAsync<Record<string, unknown>>(`SELECT * FROM kingdom_campaign WHERE id = 1`);
  if (!r) throw new Error('kingdom_campaign manquant');
  return parseProgress(r);
}

export async function saveCampaignProgress(db: Conn, progress: CampaignProgress): Promise<void> {
  await db.runAsync(
    `UPDATE kingdom_campaign SET highest_unlocked = ?, cleared_stages_json = ?, stage_stats_json = ?, updated_at = ?
     WHERE id = 1`,
    progress.highestUnlocked,
    JSON.stringify(progress.clearedStageIds),
    JSON.stringify(progress.stageStats),
    progress.updatedAt,
  );
}

export function stageStatus(progress: CampaignProgress, stageNumber: number, cleared: boolean): CampaignStageStatus {
  if (cleared) return 'cleared';
  if (stageNumber <= progress.highestUnlocked) return 'unlocked';
  return 'locked';
}

export function buildStageBoard(progress: CampaignProgress): Array<{
  stageId: string;
  number: number;
  name: string;
  description: string;
  enemyId: string;
  difficulty: string;
  status: CampaignStageStatus;
  stats: StageStats;
  firstWinGold: number;
  isBoss: boolean;
}> {
  return ELORIA_CAMPAIGN_STAGES.map((s) => {
    const cleared = progress.clearedStageIds.includes(s.id);
    const stats = progress.stageStats[s.id] ?? { wins: 0, defeats: 0 };
    return {
      stageId: s.id,
      number: s.number,
      name: s.name,
      description: s.description,
      enemyId: s.enemyId,
      difficulty: s.difficulty,
      status: stageStatus(progress, s.number, cleared),
      stats,
      firstWinGold: s.firstWinGold,
      isBoss: s.number === 10,
    };
  });
}

export function recordStageOutcome(
  progress: CampaignProgress,
  stageId: string,
  outcome: 'victory' | 'defeat',
  now: string,
): CampaignProgress {
  const stats = { ...(progress.stageStats[stageId] ?? { wins: 0, defeats: 0 }) };
  if (outcome === 'victory') stats.wins += 1;
  else stats.defeats += 1;

  let highest = progress.highestUnlocked;
  let cleared = [...progress.clearedStageIds];
  if (outcome === 'victory') {
    if (!cleared.includes(stageId)) cleared.push(stageId);
    const stage = ELORIA_CAMPAIGN_STAGES.find((s) => s.id === stageId);
    if (stage && stage.number < 10) {
      highest = Math.max(highest, stage.number + 1);
    }
  }

  return {
    highestUnlocked: highest,
    clearedStageIds: cleared,
    stageStats: { ...progress.stageStats, [stageId]: stats },
    updatedAt: now,
  };
}