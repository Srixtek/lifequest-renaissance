import type { Db } from '../../data/db/client';
import type { SqlRunner } from '../../data/db/sqlRunner';
import type { RenewableQuestTemplate } from '../../data/content/renewableQuestTemplates';
import * as kingdomRepo from '../../data/db/repositories/kingdomRepo';
import * as adaptiveChallengeRepo from '../../data/db/repositories/adaptiveChallengeRepo';
import * as challengeSessionRepo from '../../data/db/repositories/challengeSessionRepo';
import { evaluateQuestProof, type QuestProgress } from './questEvidence';
import { displayElapsedSec } from './challengeService';
import { QUESTS, type QuestDef } from '../../data/content/quests';

type Conn = Db | SqlRunner;

export interface InlineTimerProgress {
  kind: 'breathing' | 'challenge';
  startedUtc: string;
  targetSec: number;
  partialBestSec?: number;
  state: 'running' | 'stopped';
}

export function parseProgressJson(raw: string | null): {
  timer?: InlineTimerProgress;
  partialNote?: string;
  forgeLevelAtAccept?: number;
  proofChallengeSessionId?: string;
  proofCombatVictoryId?: string;
} {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

export function renewableProofSatisfied(
  template: RenewableQuestTemplate,
  progress: QuestProgress,
  status: 'offered' | 'active' | 'ready' | 'claimed' | 'failed',
): boolean {
  if (status === 'ready') return true;
  if (status !== 'active') return false;
  if (template.proof === 'breathing_timer' || template.proof === 'inline_challenge') {
    return progress.target === 1 && progress.current >= 1;
  }
  return progress.current >= progress.target && progress.target > 0;
}

async function consumedCombatVictoryIds(db: Conn, excludeInstanceId?: string): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ id: string; progress_json: string | null }>(
    `SELECT id, progress_json FROM renewable_quest_instances WHERE status IN ('active', 'ready', 'claimed')`,
  );
  const used = new Set<string>();
  for (const row of rows) {
    if (excludeInstanceId && row.id === excludeInstanceId) continue;
    const meta = parseProgressJson(row.progress_json);
    if (meta.proofCombatVictoryId) used.add(meta.proofCombatVictoryId);
  }
  return used;
}

function challengeSessionProofComplete(
  session: Awaited<ReturnType<typeof challengeSessionRepo.getById>>,
  template: RenewableQuestTemplate,
  acceptedAt: string,
): boolean {
  if (!session || session.state !== 'completed') return false;
  if (session.startedUtc < acceptedAt) return false;
  if (template.challengeType && session.type !== template.challengeType) return false;
  const target = template.targetDurationSec ?? 600;
  if (session.type === 'sport') {
    const confirmed = Number(session.userConfirmedDurationSec ?? session.durationSec);
    return confirmed >= target;
  }
  if (session.type === 'no_screen') {
    return session.durationSec >= target;
  }
  return false;
}

export async function evaluateRenewableProof(
  db: Conn,
  template: RenewableQuestTemplate,
  acceptedAt: string,
  progressJson: string | null,
  challengeSessionId: string | null,
): Promise<QuestProgress> {
  const progressMeta = parseProgressJson(progressJson);
  switch (template.proof) {
    case 'habit_declaration': {
      const pseudo: QuestDef = {
        id: template.id,
        title: template.title,
        description: '',
        objective: template.objective,
        rewardGold: template.rewardGold,
        proof: 'habit_declaration',
      };
      return evaluateQuestProof(db, pseudo, acceptedAt);
    }
    case 'breathing_timer': {
      const target = template.targetDurationSec ?? 180;
      const timer = progressMeta.timer;
      if (timer?.state === 'running') {
        const elapsed = displayElapsedSec({
          id: '',
          type: 'sport',
          startedUtc: timer.startedUtc,
          endedUtc: null,
          targetDurationSec: target,
          state: 'running',
          durationSec: 0,
          userConfirmed: false,
          userConfirmedDurationSec: null,
          createdAt: timer.startedUtc,
          updatedAt: timer.startedUtc,
        });
        return {
          current: Math.min(target, elapsed),
          target,
          label: `${Math.min(target, elapsed)} / ${target} s`,
        };
      }
      const rows = await db.getAllAsync<{ created_at: string; duration_sec: number; meta_json: string | null }>(
        `SELECT created_at, duration_sec, meta_json FROM coping_sessions
         WHERE kind = 'breathing' AND completed = 1 AND created_at >= ?`,
        acceptedAt,
      );
      const acceptedMs = Date.parse(acceptedAt);
      let best = progressMeta.timer?.partialBestSec ?? 0;
      for (const r of rows) {
        const meta = r.meta_json ? JSON.parse(r.meta_json) : {};
        if (meta.shortcut) continue;
        const startMs = Date.parse(r.created_at) - Math.max(0, Number(r.duration_sec) || 0) * 1000;
        if (Number.isFinite(startMs) && startMs >= acceptedMs) {
          best = Math.max(best, Number(r.duration_sec) || 0);
        }
      }
      const done = best >= target ? 1 : 0;
      return {
        current: done ? 1 : 0,
        target: 1,
        label: done ? `1 / 1 souffle (${target}s)` : `${best} / ${target} s`,
      };
    }
    case 'inline_challenge': {
      const target = template.targetDurationSec ?? 600;
      const boundId = challengeSessionId ?? progressMeta.proofChallengeSessionId ?? null;
      if (!boundId) {
        const partial = progressMeta.timer?.partialBestSec ?? 0;
        return {
          current: 0,
          target: 1,
          label: partial > 0 ? `${partial} / ${target} s (partiel)` : '0 / 1 défi',
        };
      }
      const session = await challengeSessionRepo.getById(db, boundId);
      if (!session) {
        return { current: 0, target: 1, label: '0 / 1 défi' };
      }
      if (session.state === 'running') {
        if (session.startedUtc < acceptedAt) {
          return { current: 0, target: 1, label: '0 / 1 défi' };
        }
        if (template.challengeType && session.type !== template.challengeType) {
          return { current: 0, target: 1, label: '0 / 1 défi' };
        }
        const elapsed = displayElapsedSec(session);
        return {
          current: Math.min(target, elapsed),
          target,
          label: `${Math.min(target, elapsed)} / ${target} s`,
        };
      }
      if (challengeSessionProofComplete(session, template, acceptedAt)) {
        return { current: 1, target: 1, label: `1 / 1 défi (${target}s)` };
      }
      const partial = progressMeta.timer?.partialBestSec ?? 0;
      return {
        current: 0,
        target: 1,
        label:
          session.state === 'interrupted'
            ? '0 / 1 défi (interrompu)'
            : partial > 0
              ? `${partial} / ${target} s (partiel)`
              : '0 / 1 défi',
      };
    }
    case 'combat_victory': {
      const enemy = template.targetEnemyId ?? 'thorn_guardian';
      const boundVictory = progressMeta.proofCombatVictoryId;
      if (boundVictory) {
        const row = await db.getFirstAsync<{ outcome: string }>(
          `SELECT outcome FROM combat_victory_log WHERE id = ? AND enemy_id = ? AND fought_at >= ?`,
          boundVictory,
          enemy,
          acceptedAt,
        );
        if (row?.outcome === 'victory') {
          return { current: 1, target: 1, label: '1 / 1 victoire' };
        }
      }
      const consumed = await consumedCombatVictoryIds(db);
      const victories = await db.getAllAsync<{ id: string; fought_at: string }>(
        `SELECT id, fought_at FROM combat_victory_log WHERE enemy_id = ? AND outcome = 'victory' AND fought_at >= ? ORDER BY fought_at ASC`,
        enemy,
        acceptedAt,
      );
      const free = victories.filter((v) => !consumed.has(v.id));
      const n = free.length;
      return { current: Math.min(1, n), target: 1, label: n ? '1 / 1 victoire' : '0 / 1 victoire' };
    }
    case 'forge_upgrade': {
      const atAccept = progressMeta.forgeLevelAtAccept ?? 0;
      const forge = await kingdomRepo.getForgeLevel(db);
      const up = forge.level > atAccept ? 1 : 0;
      return { current: up, target: 1, label: up ? '1 / 1 amélioration' : '0 / 1 amélioration' };
    }
    case 'adaptive_vape_complete': {
      const attempts = await adaptiveChallengeRepo.listAttemptsSince(db, acceptedAt);
      const ok = attempts.some((a) => a.outcome === 'success');
      return { current: ok ? 1 : 0, target: 1, label: ok ? '1 / 1 défi vape' : '0 / 1 défi vape' };
    }
    default:
      return { current: 0, target: 1, label: '0 / 1' };
  }
}

/** Légendes : les 4 quêtes historiques inchangées. */
export const LEGEND_QUESTS = QUESTS;