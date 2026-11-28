import type { Db } from '../../data/db/client';
import type { SqlRunner } from '../../data/db/sqlRunner';
import type { WeeklyQuestTemplate } from '../../data/content/renewableQuestTemplates';
import * as diversRepo from '../../data/db/repositories/diversRepo';
import { alcoholLogicalDate } from '../rules/alcohol';
import { isEvidenceGroupPaid, isEvidencePaid } from './questEvidenceClaims';

type Conn = Db | SqlRunner;

export interface WeeklyWindow {
  acceptedAt: string;
  weekStart: string;
  weekEnd: string;
  timeZone: string | undefined;
  dayStartHour: number;
}

export interface WeeklyEvidenceItem {
  evidenceKey: string;
  evidenceGroup: string;
  source: 'sport' | 'proches' | 'divers';
  label: string;
}

/** Les formulaires saisissent l'heure à la minute : tolérance « minute d'acceptation » (comme les missions du jour). */
function minuteFloor(iso: string): string {
  return `${iso.slice(0, 16)}:00.000Z`;
}

/**
 * Une action compte seulement si elle a été réalisée (`local_date`) ET enregistrée (`created_at`) dans la semaine de
 * la mission : une saisie tardive (même antidatée) ne complète jamais rétroactivement la mission précédente.
 */
function inWeek(w: WeeklyWindow, localDate: string, createdAt: string): boolean {
  if (localDate < w.weekStart || localDate > w.weekEnd) return false;
  const recordedOn = alcoholLogicalDate(new Date(createdAt), w.timeZone, w.dayStartHour);
  return recordedOn >= w.weekStart && recordedOn <= w.weekEnd;
}

/**
 * Preuves éligibles, relues à chaque évaluation (affichage ET réclamation) : actives (non annulées), après
 * acceptation, dans la semaine, distinctes, jamais consommées (mission du jour ou hebdomadaire).
 * Retourne au plus `template.steps` preuves, dans l'ordre chronologique.
 */
export async function findWeeklyEvidence(
  db: Conn,
  template: WeeklyQuestTemplate,
  w: WeeklyWindow,
): Promise<WeeklyEvidenceItem[]> {
  const out: WeeklyEvidenceItem[] = [];
  switch (template.proof) {
    case 'weekly_walks': {
      const rows = await db.getAllAsync<Record<string, unknown>>(
        `SELECT id, duration_sec, local_date, created_at FROM sport_sessions
         WHERE activity_id = 'walking' AND status = 'active' AND duration_sec IS NOT NULL AND duration_sec >= ?
           AND performed_at >= ? AND created_at >= ?
         ORDER BY performed_at ASC, rowid ASC`,
        template.minDurationSec ?? 600,
        minuteFloor(w.acceptedAt),
        w.acceptedAt,
      );
      for (const r of rows) {
        if (out.length >= template.steps) break;
        if (!inWeek(w, String(r.local_date), String(r.created_at))) continue;
        const evidenceKey = `sport_session:${String(r.id)}`;
        if (await isEvidencePaid(db, evidenceKey)) continue;
        out.push({
          evidenceKey,
          evidenceGroup: evidenceKey,
          source: 'sport',
          label: `Marche du ${String(r.local_date)} (${Math.round(Number(r.duration_sec) / 60)} min)`,
        });
      }
      return out;
    }
    case 'weekly_calls': {
      const rows = await db.getAllAsync<Record<string, unknown>>(
        `SELECT id, local_date, created_at FROM proches_calls
         WHERE status = 'active' AND called_at >= ? AND created_at >= ?
         ORDER BY called_at ASC, rowid ASC`,
        minuteFloor(w.acceptedAt),
        w.acceptedAt,
      );
      for (const r of rows) {
        if (out.length >= template.steps) break;
        if (!inWeek(w, String(r.local_date), String(r.created_at))) continue;
        const evidenceKey = `proches_call:${String(r.id)}`;
        if (await isEvidencePaid(db, evidenceKey)) continue;
        out.push({
          evidenceKey,
          evidenceGroup: evidenceKey,
          source: 'proches',
          label: `Appel du ${String(r.local_date)}`,
        });
      }
      return out;
    }
    case 'weekly_divers': {
      const rows = await db.getAllAsync<Record<string, unknown>>(
        `SELECT id, activity_id, local_date, created_at FROM divers_completions
         WHERE status = 'active' AND confirmed_at >= ? AND created_at >= ?
         ORDER BY confirmed_at ASC, rowid ASC`,
        w.acceptedAt,
        w.acceptedAt,
      );
      const activities = new Set<string>();
      for (const r of rows) {
        if (out.length >= template.steps) break;
        const activityId = String(r.activity_id);
        if (activities.has(activityId)) continue;
        if (!inWeek(w, String(r.local_date), String(r.created_at))) continue;
        const first = await diversRepo.getFirstCompletionForActivity(db, String(r.local_date), activityId);
        if (!first || first.id !== String(r.id)) continue;
        const evidenceKey = `divers_activity:${String(r.id)}`;
        const evidenceGroup = `divers:${String(r.local_date)}:${activityId}`;
        if (await isEvidencePaid(db, evidenceKey)) continue;
        if (await isEvidenceGroupPaid(db, evidenceGroup)) continue;
        activities.add(activityId);
        out.push({
          evidenceKey,
          evidenceGroup,
          source: 'divers',
          label: `Activité Divers du ${String(r.local_date)}`,
        });
      }
      return out;
    }
    default:
      return out;
  }
}

/** Explication courte quand il manque des étapes. */
export function explainWeeklyMissing(template: WeeklyQuestTemplate): string {
  switch (template.proof) {
    case 'weekly_walks':
      return 'Il faut 3 marches distinctes, durée renseignée d\'au moins 10 min, faites et enregistrées après l\'acceptation et dans la semaine.';
    case 'weekly_calls':
      return 'Il faut 2 appels distincts déclarés après l\'acceptation et dans la semaine (un contact sans appel ne compte pas).';
    case 'weekly_divers':
      return 'Il faut 2 activités Divers différentes confirmées après l\'acceptation et dans la semaine (une activité répétée ne compte qu\'une fois).';
    default:
      return 'Objectif pas encore atteint.';
  }
}
