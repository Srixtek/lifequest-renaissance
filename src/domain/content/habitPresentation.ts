import type { GoalDefinition, GoalKind, TrackingStatus } from '../models/types';
import { GOAL_TEMPLATES } from '../../data/content/goalTemplates';
import type { HabitCategory, HabitIntentionChoice } from './habitIntentions';
import { formatWeeklyProgress } from '../rules/weeklyTracking';
import { publicGoalTitle } from './goalDisplay';
import { usesNumericLog } from '../rules/trackingStatus';

export interface ActiveHabitVersion {
  unit: string | null;
  target: number | null;
  scheduleKind: 'daily' | 'weekly';
  weeklyTarget: number | null;
}

export interface HabitCardPresentation {
  title: string;
  objectiveLine: string;
  dailyQuestion: string;
  todayValueLabel: string;
  inputPlaceholder: string;
  inputAccessibilityLabel: string;
  primaryLogLabel: string;
  binaryPrompt: string | null;
  binarySuccessLabel: string;
  binaryMissLabel: string;
  weeklyHint: string | null;
  breathingManualNote: string | null;
  editTargetTitle: string;
  editTargetPlaceholder: string;
  editTargetSaveLabel: string;
  settingsToggleOpen: string;
  settingsToggleClosed: string;
  pauseHint: string;
  archiveHint: string;
}

export interface HabitSetupTargetCopy {
  prompt: string;
  placeholder: string;
  accessibilityLabel: string;
}

function templateFor(goal: GoalDefinition) {
  return goal.templateId ? GOAL_TEMPLATES.find((t) => t.id === goal.templateId) : undefined;
}

function unitSuffix(unit: string | null | undefined): string {
  return unit ? ` ${unit}` : '';
}

function formatObjectiveLimit(target: number, unit: string | null, kind: GoalKind): string {
  const u = unitSuffix(unit);
  if (kind === 'limit' || kind === 'reduce') {
    return `Plafond du jour : ${target}${u} maximum`;
  }
  if (kind === 'duration') {
    return `Objectif du jour : au moins ${target}${u}`;
  }
  if (kind === 'quantity') {
    return 'Suivi neutre — pas de plafond ni de minimum imposé';
  }
  return `Repère : ${target}${u}`;
}

function todayNumericValue(
  goal: GoalDefinition,
  status: TrackingStatus,
  value: number | null | undefined,
): string {
  if (value == null) {
    if (status === 'unknown' && goal.status !== 'paused') {
      return 'Pas encore renseigné';
    }
    return 'Pas encore renseigné';
  }
  return `${value}${unitSuffix(goal.unit)}`;
}

function binaryLabels(goal: GoalDefinition, ver: ActiveHabitVersion | undefined): {
  prompt: string;
  success: string;
  miss: string;
} {
  if (goal.kind === 'abstinence') {
    const substance =
      goal.templateId === 'alcohol_limit'
        ? 'alcool'
        : goal.templateId === 'vape_sessions'
          ? 'vape'
          : 'consommation';
    return {
      prompt: `Aujourd'hui, as-tu consommé (${substance}) ?`,
      success: 'Journée sans consommation',
      miss: 'Consommation déclarée',
    };
  }
  if (ver?.scheduleKind === 'weekly') {
    return {
      prompt: "As-tu appelé un proche aujourd'hui ?",
      success: 'Appel fait',
      miss: "Pas d'appel aujourd'hui",
    };
  }
  return {
    prompt: "As-tu réalisé cette habitude aujourd'hui ?",
    success: 'Fait',
    miss: 'Pas fait',
  };
}

function dailyQuestionFor(goal: GoalDefinition, ver: ActiveHabitVersion | undefined): string {
  const tpl = templateFor(goal);

  if (goal.templateId === 'vape_sessions') {
    if (goal.kind === 'abstinence') return 'Objectif : une journée sans séance de vape déclarée.';
    if (goal.followWithoutXp || goal.kind === 'quantity') {
      return "Combien de séances de vape aujourd'hui ? (suivi informatif, sans XP auto)";
    }
    return "Combien de séances de vape as-tu eu aujourd'hui ?";
  }

  if (goal.templateId === 'alcohol_limit') {
    if (goal.kind === 'abstinence') return "Objectif : une journée sans verre d'alcool déclaré.";
    if (goal.followWithoutXp || goal.kind === 'quantity') {
      return "Combien de verres standard aujourd'hui ? (suivi informatif, sans XP auto)";
    }
    return "Combien de verres standard as-tu bu aujourd'hui ? (0 = aucun verre)";
  }

  if (goal.templateId === 'freq_regulation') {
    if (goal.kind === 'abstinence') return 'Objectif : journée sans acte déclaré (choix personnel).';
    if (goal.followWithoutXp || goal.kind === 'quantity') {
      return "Combien de fois aujourd'hui ? (suivi neutre, sans jugement)";
    }
    return "Combien de fois aujourd'hui ? (plafond personnel)";
  }

  if (goal.templateId === 'sport_minutes') {
    return "Combien de minutes d'activité ou de mouvement aujourd'hui ?";
  }

  if (goal.templateId === 'screen_free') {
    return "Combien de minutes sans écran as-tu passées aujourd'hui (déclarées) ?";
  }

  if (goal.templateId === 'breathing5') {
    return "Combien de minutes de respiration lente as-tu pratiquées aujourd'hui ?";
  }

  if (goal.templateId === 'call_family' || ver?.scheduleKind === 'weekly') {
    return "As-tu appelé un proche aujourd'hui ?";
  }

  if (goal.kind === 'abstinence') {
    return 'Objectif : journée sans consommation déclarée.';
  }

  if (goal.kind === 'limit' || goal.kind === 'reduce') {
    return `Combien${unitSuffix(goal.unit)} aujourd'hui ? (respect du plafond)`;
  }

  if (goal.kind === 'duration') {
    return `Combien de minutes aujourd'hui ?${ver?.target != null ? ' (minimum visé)' : ''}`;
  }

  if (goal.kind === 'quantity' || goal.followWithoutXp) {
    return `Valeur du jour${unitSuffix(goal.unit)} — suivi neutre`;
  }

  if (tpl?.neutralNote) {
    return 'Confirmation du jour (oui/non, réversible).';
  }

  return "Que souhaites-tu déclarer pour aujourd'hui ?";
}

function objectiveLineFor(
  goal: GoalDefinition,
  ver: ActiveHabitVersion | undefined,
  weeklyDone: number,
): string {
  if (goal.status === 'paused') {
    return 'Habitude en pause — reprends quand tu es prêt.';
  }

  if (ver?.scheduleKind === 'weekly' && ver.weeklyTarget != null) {
    return formatWeeklyProgress(weeklyDone, ver.weeklyTarget);
  }

  if (goal.kind === 'abstinence') {
    return 'Objectif : journée sans consommation déclarée';
  }

  if (goal.followWithoutXp && (goal.kind === 'quantity' || usesNumericLog(goal.kind))) {
    return 'Suivi neutre — aucune récompense XP automatique';
  }

  if (ver?.target != null) {
    return formatObjectiveLimit(ver.target, goal.unit, goal.kind);
  }

  if (goal.kind === 'habit' && ver?.scheduleKind !== 'weekly') {
    return 'Confirmation quotidienne (oui / non)';
  }

  if (goal.kind === 'quantity') {
    return 'Suivi neutre — note la valeur du jour';
  }

  return 'Pas de repère chiffré — déclare ta journée';
}

function inputPlaceholderFor(goal: GoalDefinition): string {
  if (goal.templateId === 'vape_sessions') {
    return goal.followWithoutXp
      ? 'Nombre de séances'
      : "Séances aujourd'hui";
  }
  if (goal.templateId === 'alcohol_limit') {
    return "Verres standard aujourd'hui (0 = aucun verre)";
  }
  if (goal.templateId === 'freq_regulation') {
    return "Nombre aujourd'hui";
  }
  if (goal.templateId === 'sport_minutes' || goal.templateId === 'breathing5') {
    return "Minutes réelles aujourd'hui";
  }
  if (goal.templateId === 'screen_free') {
    return "Minutes sans écran aujourd'hui";
  }
  if (goal.kind === 'limit' || goal.kind === 'reduce') {
    return goal.unit ? `${goal.unit} aujourd'hui` : 'Valeur du jour';
  }
  if (goal.kind === 'duration') {
    return goal.unit ? "Minutes aujourd'hui" : "Durée aujourd'hui";
  }
  return goal.unit ? `Valeur (${goal.unit})` : 'Valeur du jour';
}

export function presentHabitCard(
  goal: GoalDefinition,
  ver: ActiveHabitVersion | undefined,
  tracking: { status: TrackingStatus; value: number | null | undefined } | undefined,
  weeklyDone: number,
): HabitCardPresentation {
  const status = goal.status === 'paused' ? 'paused' : (tracking?.status ?? 'unknown');
  const binary = binaryLabels(goal, ver);

  return {
    title: publicGoalTitle(goal),
    objectiveLine: objectiveLineFor(goal, ver, weeklyDone),
    dailyQuestion: dailyQuestionFor(goal, ver),
    todayValueLabel: usesNumericLog(goal.kind)
      ? todayNumericValue(goal, status, tracking?.value)
      : status === 'unknown'
        ? 'Pas encore renseigné'
        : status === 'success'
          ? 'Déclaré : oui'
          : status === 'miss'
            ? 'Déclaré : non'
            : 'Renseigné',
    inputPlaceholder: inputPlaceholderFor(goal),
    inputAccessibilityLabel: `Saisie pour ${publicGoalTitle(goal)}`,
    primaryLogLabel: 'Enregistrer',
    binaryPrompt: binary.prompt,
    binarySuccessLabel: binary.success,
    binaryMissLabel: binary.miss,
    weeklyHint:
      ver?.scheduleKind === 'weekly'
        ? 'Suivi hebdomadaire : chaque jour compte une fois ; les jours sans réponse ne sont pas des échecs. Pas encore de récompense RPG sur cette habitude.'
        : null,
    breathingManualNote:
      goal.templateId === 'breathing5'
        ? "Les séances lancées depuis l'outil Respiration sont enregistrées séparément : déclare ici uniquement si tu suis cet objectif à la main (pas de double comptage)."
        : null,
    editTargetTitle: "Modifier mon objectif (prise d'effet demain)",
    editTargetPlaceholder:
      ver?.scheduleKind === 'weekly'
        ? 'Jours avec appel par semaine (1–7)'
        : goal.kind === 'duration'
          ? 'Nouveau minimum (minutes / jour)'
          : goal.kind === 'limit' || goal.kind === 'reduce'
            ? 'Nouveau plafond par jour'
            : 'Nouvelle valeur',
    editTargetSaveLabel: 'Enregistrer le nouvel objectif',
    settingsToggleClosed: 'Modifier mon objectif',
    settingsToggleOpen: 'Masquer les réglages',
    pauseHint:
      "Pause : l'habitude reste dans la liste mais tu n'as plus à la renseigner chaque jour.",
    archiveHint: "Archiver : conserve l'historique et retire l'habitude de la liste active.",
  };
}

export function setupTargetCopy(
  category: HabitCategory,
  intention: HabitIntentionChoice,
): HabitSetupTargetCopy | null {
  if (intention === 'stop' || intention === 'measure' || intention === 'weekly_calls') {
    return null;
  }
  if (intention === 'minutes') {
    const isSport = category === 'D';
    return {
      prompt: isSport
        ? "Combien de minutes d'activité vises-tu par jour ?"
        : "Combien de minutes sans écran vises-tu par jour ?",
      placeholder: isSport ? 'Minutes minimum / jour' : 'Minutes sans écran / jour',
      accessibilityLabel: isSport ? "Minutes d'activité par jour" : 'Minutes sans écran par jour',
    };
  }
  const units: Record<'A' | 'B' | 'C', string> = {
    A: 'séances',
    B: 'verres',
    C: 'fois',
  };
  const unit = units[category as 'A' | 'B' | 'C'] ?? 'unités';
  return {
    prompt: `Quel plafond quotidien (${unit}) veux-tu te fixer ?`,
    placeholder: `Maximum ${unit} / jour`,
    accessibilityLabel: `Plafond quotidien en ${unit}`,
  };
}

export function customCreationTargetPlaceholder(kind: GoalKind): string {
  switch (kind) {
    case 'limit':
    case 'reduce':
      return 'Plafond quotidien (nombre)';
    case 'duration':
      return 'Minimum quotidien (minutes)';
    case 'quantity':
      return 'Repère facultatif (suivi neutre)';
    default:
      return 'Valeur';
  }
}