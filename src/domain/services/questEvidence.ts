import type { Db } from '../../data/db/client';
import type { SqlRunner } from '../../data/db/sqlRunner';
import * as rpgRepo from '../../data/db/repositories/rpgRepo';
import type { QuestDef } from '../../data/content/quests';
import { MAP_NODES } from '../../data/content/map';

type Conn = Db | SqlRunner;

export interface QuestProgress {
  current: number;
  target: number;
  /** Texte court d'avancement, ex. « 0 / 1 séance terminée ». */
  label: string;
}

/**
 * Règle uniforme (non rétroactive) : seule une action COMMENCÉE à l'instant d'acceptation ou après compte.
 * - déclaration d'habitude : `tracking_events.updated_at >= acceptedAt`, statut success|partial|miss
 *   (unknown et paused ne sont jamais une preuve) ;
 * - respiration : `coping_sessions` kind=breathing, completed=1, hors raccourci de test,
 *   début estimé (created_at − duration_sec) >= acceptedAt ;
 * - défi : `challenge_sessions` state=completed, user_confirmed=1, `started_utc >= acceptedAt`,
 *   sport avec durée confirmée > 0, ou sans écran déclaré respecté. Séances interrompues exclues ;
 * - aventure : entrée du `choice_log` datée >= acceptedAt dont la destination est le nœud cible.
 * Les horodatages sont tous des ISO UTC `toISOString()` (comparaison lexicographique valide).
 */
export async function evaluateQuestProof(db: Conn, def: QuestDef, acceptedAt: string): Promise<QuestProgress> {
  switch (def.proof) {
    case 'habit_declaration': {
      const r = await db.getFirstAsync<{ c: number }>(
        `SELECT COUNT(*) AS c FROM tracking_events
         WHERE status IN ('success', 'partial', 'miss') AND updated_at >= ?`,
        acceptedAt,
      );
      return progress(Number(r?.c ?? 0), 'déclaration honnête');
    }
    case 'breathing_session': {
      const rows = await db.getAllAsync<{ created_at: string; duration_sec: number; meta_json: string | null }>(
        `SELECT created_at, duration_sec, meta_json FROM coping_sessions
         WHERE kind = 'breathing' AND completed = 1 AND created_at >= ?`,
        acceptedAt,
      );
      const acceptedMs = Date.parse(acceptedAt);
      const n = rows.filter((r) => {
        if (parseMeta(r.meta_json).shortcut) return false;
        const startMs = Date.parse(r.created_at) - Math.max(0, Number(r.duration_sec) || 0) * 1000;
        return Number.isFinite(startMs) && startMs >= acceptedMs;
      }).length;
      return progress(n, 'séance terminée');
    }
    case 'time_challenge': {
      const r = await db.getFirstAsync<{ c: number }>(
        `SELECT COUNT(*) AS c FROM challenge_sessions
         WHERE state = 'completed' AND user_confirmed = 1 AND started_utc >= ?
           AND ((type = 'sport' AND COALESCE(user_confirmed_duration_sec, 0) > 0) OR type = 'no_screen')`,
        acceptedAt,
      );
      return progress(Number(r?.c ?? 0), 'défi validé');
    }
    case 'reach_node': {
      const adv = await rpgRepo.getAdventure(db);
      const target = def.targetNode;
      const n = adv.choiceLog.filter((e: { at?: string; from?: string; choiceId?: string }) => {
        if (!target || !e?.at || !e.from || !e.choiceId) return false;
        if (e.at < acceptedAt || e.from === target) return false;
        return MAP_NODES[e.from]?.choices.find((c) => c.id === e.choiceId)?.to === target;
      }).length;
      return progress(n, 'arrivée');
    }
    default:
      return { current: 0, target: 1, label: '0 / 1' };
  }
}

function progress(count: number, noun: string): QuestProgress {
  const current = Math.min(1, count);
  return { current, target: 1, label: `${current} / 1 ${noun}` };
}

function parseMeta(json: string | null): { shortcut?: boolean } {
  if (!json) return {};
  try {
    const v = JSON.parse(json);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}
