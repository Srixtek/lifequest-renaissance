import type { Db } from '../../data/db/client';
import type { SqlRunner } from '../../data/db/sqlRunner';
import type { RenewableQuestTemplate } from '../../data/content/renewableQuestTemplates';
import * as diversRepo from '../../data/db/repositories/diversRepo';
import { isEvidenceGroupPaid, isEvidencePaid } from './questEvidenceClaims';

type Conn = Db | SqlRunner;

export interface DailyParams {
  activityId?: string;
  goalId?: string;
  goalMetric?: string;
  goalTarget?: number;
}

export interface DailyEvidence {
  evidenceKey: string;
  /** Unité de consommation : une preuve (ou une même activité Divers le même jour) ne finance qu'une récompense. */
  evidenceGroup: string;
  source: 'sport' | 'proches' | 'divers';
}

/** Les formulaires Sport / Proches saisissent l'heure à la minute : tolérance « minute d'acceptation ». */
function minuteFloor(iso: string): string {
  return `${iso.slice(0, 16)}:00.000Z`;
}

const SPORT_COLUMN: Record<string, string> = { reps: 'reps', duration_sec: 'duration_sec', distance_m: 'distance_m' };

/**
 * Preuve éligible pour une mission du jour, relue à chaque évaluation (affichage ET réclamation).
 * Règles communes : preuve ACTIVE (non annulée), enregistrée ET réalisée à/après l'acceptation, jamais déjà consommée.
 */
export async function findDailyEvidence(
  db: Conn,
  template: RenewableQuestTemplate,
  acceptedAt: string,
  params: DailyParams | undefined,
): Promise<DailyEvidence | null> {
  switch (template.proof) {
    case 'sport_session': {
      const activityId = params?.activityId ?? template.activityId;
      if (!activityId) return null;
      const rows = await db.getAllAsync<Record<string, unknown>>(
        `SELECT id, reps, duration_sec, distance_m, goal_metric, goal_target
         FROM sport_sessions
         WHERE activity_id = ? AND status = 'active' AND outcome = 'achieved'
           AND performed_at >= ? AND created_at >= ?
         ORDER BY performed_at ASC, rowid ASC`,
        activityId,
        minuteFloor(acceptedAt),
        acceptedAt,
      );
      for (const r of rows) {
        const metric = String(r.goal_metric ?? '');
        const target = Number(r.goal_target ?? 0);
        const col = SPORT_COLUMN[metric];
        if (!col || !(target > 0)) continue;
        const value = Number(r[col] ?? 0);
        if (value < target) continue;
        if (params?.goalMetric === metric && params.goalTarget != null && target < params.goalTarget) continue;
        const evidenceKey = `sport_session:${String(r.id)}`;
        if (await isEvidencePaid(db, evidenceKey)) continue;
        return { evidenceKey, evidenceGroup: evidenceKey, source: 'sport' };
      }
      return null;
    }
    case 'proches_call': {
      const rows = await db.getAllAsync<{ id: string }>(
        `SELECT id FROM proches_calls
         WHERE status = 'active' AND called_at >= ? AND created_at >= ?
         ORDER BY called_at ASC, rowid ASC`,
        minuteFloor(acceptedAt),
        acceptedAt,
      );
      for (const r of rows) {
        const evidenceKey = `proches_call:${r.id}`;
        if (await isEvidencePaid(db, evidenceKey)) continue;
        return { evidenceKey, evidenceGroup: evidenceKey, source: 'proches' };
      }
      return null;
    }
    case 'divers_activity': {
      const rows = await db.getAllAsync<{ id: string; activity_id: string; local_date: string }>(
        `SELECT id, activity_id, local_date FROM divers_completions
         WHERE status = 'active' AND confirmed_at >= ? AND created_at >= ?
         ORDER BY confirmed_at ASC, rowid ASC`,
        acceptedAt,
        acceptedAt,
      );
      for (const r of rows) {
        const first = await diversRepo.getFirstCompletionForActivity(db, r.local_date, r.activity_id);
        if (!first || first.id !== r.id) continue;
        const evidenceKey = `divers_activity:${r.id}`;
        const evidenceGroup = `divers:${r.local_date}:${r.activity_id}`;
        if (await isEvidencePaid(db, evidenceKey)) continue;
        if (await isEvidenceGroupPaid(db, evidenceGroup)) continue;
        return { evidenceKey, evidenceGroup, source: 'divers' };
      }
      return null;
    }
    default:
      return null;
  }
}

/** Explication courte quand rien de valable n'a été trouvé (action insuffisante / non renseignée). */
export async function explainMissingEvidence(
  db: Conn,
  template: RenewableQuestTemplate,
  acceptedAt: string,
  params: DailyParams | undefined,
): Promise<string> {
  switch (template.proof) {
    case 'sport_session': {
      const activityId = params?.activityId ?? template.activityId;
      const rows = await db.getAllAsync<Record<string, unknown>>(
        `SELECT outcome, reps, duration_sec, distance_m, goal_metric, goal_target FROM sport_sessions
         WHERE activity_id = ? AND status = 'active' AND performed_at >= ? AND created_at >= ?
         ORDER BY performed_at DESC, rowid DESC LIMIT 5`,
        activityId ?? '',
        minuteFloor(acceptedAt),
        acceptedAt,
      );
      if (rows.length === 0) return 'Aucune séance enregistrée depuis l\'acceptation.';
      if (rows.some((r) => r.outcome === 'failed')) {
        return 'Séance enregistrée mais objectif non atteint : elle reste dans tes stats, la mission n\'est pas validée.';
      }
      if (rows.every((r) => r.outcome === 'free')) {
        return 'Séance sans objectif : elle ne valide pas la mission (choisis « Atteint » avec ton objectif).';
      }
      return 'Aucune séance « objectif atteint » valide depuis l\'acceptation.';
    }
    case 'proches_call':
      return 'Aucun appel déclaré depuis l\'acceptation (un contact dans le répertoire ne compte pas).';
    case 'divers_activity':
      return 'Aucune confirmation Divers valable depuis l\'acceptation (« Passer » et « Remplacer » ne valident pas).';
    default:
      return 'Objectif pas encore atteint.';
  }
}
