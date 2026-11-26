import type { Db } from '../../data/db/client';
import type { SqlRunner } from '../../data/db/sqlRunner';
import type { RenewableQuestTemplate } from '../../data/content/renewableQuestTemplates';
import * as combatVictoryRepo from '../../data/db/repositories/combatVictoryRepo';
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
} {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
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
      if (challengeSessionId) {
        const session = await challengeSessionRepo.getById(db, challengeSessionId);
        if (session && session.state === 'running') {
          const elapsed = displayElapsedSec(session);
          return {
            current: Math.min(target, elapsed),
            target,
            label: `${Math.min(target, elapsed)} / ${target} s`,
          };
        }
        if (session?.state === 'completed' && session.startedUtc >= acceptedAt) {
          const confirmed =
            session.type === 'sport'
              ? Number(session.userConfirmedDurationSec ?? session.durationSec)
              : session.durationSec;
          if (session.type === 'no_screen' || (session.type === 'sport' && confirmed > 0)) {
            if (confirmed >= target) {
              return { current: 1, target: 1, label: `1 / 1 défi (${target}s)` };
            }
          }
        }
      }
      const pseudo: QuestDef = {
        id: template.id,
        title: template.title,
        description: '',
        objective: template.objective,
        rewardGold: template.rewardGold,
        proof: 'time_challenge',
      };
      const base = await evaluateQuestProof(db, pseudo, acceptedAt);
      if (base.current >= 1) return { current: 1, target: 1, label: '1 / 1 défi validé' };
      const partial = progressMeta.timer?.partialBestSec ?? 0;
      return {
        current: 0,
        target: 1,
        label: partial > 0 ? `${partial} / ${target} s (partiel)` : '0 / 1 défi',
      };
    }
    case 'combat_victory': {
      const enemy = template.targetEnemyId ?? 'thorn_guardian';
      const n = await combatVictoryRepo.countVictoriesAfter(db, enemy, acceptedAt);
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