import type { GoalDefinition, TrackingEvent, TrackingStatus } from '../models/types';
import { publicGoalTitle } from '../content/goalDisplay';
import { challengeTypeForTemplate } from '../models/challengeSession';
import { vapeChallengeDef } from '../content/vapeChallengeDefs';
import type { ChallengeType } from '../models/challengeSession';

export type CampNextChallengeRoute =
  | { kind: 'vape-adaptive' }
  | { kind: 'challenges'; challengeType: ChallengeType }
  | { kind: 'goals' };

export interface CampNextChallenge {
  title: string;
  subtitle: string;
  targetLine?: string;
  cta: string;
  route: CampNextChallengeRoute;
  empty?: boolean;
}

export function buildCampNextChallenge(input: {
  activeGoals: GoalDefinition[];
  todayTracking: Record<string, TrackingEvent | null>;
  vapeDelayMin: number | null;
  vapeRunning: boolean;
}): CampNextChallenge {
  const { activeGoals, todayTracking, vapeDelayMin, vapeRunning } = input;
  const vapeGoal = activeGoals.find((g) => g.templateId === 'vape_sessions');

  if (vapeGoal && vapeRunning) {
    return {
      title: 'Défi vape en cours',
      subtitle: publicGoalTitle(vapeGoal),
      cta: 'Reprendre mon défi',
      route: { kind: 'vape-adaptive' },
    };
  }

  if (vapeGoal && vapeDelayMin != null) {
    const def = vapeChallengeDef('delay_craving');
    return {
      title: def.title,
      subtitle: publicGoalTitle(vapeGoal),
      targetLine: `Cible : tenir ${vapeDelayMin} min avant de vapoter`,
      cta: 'Voir le défi',
      route: { kind: 'vape-adaptive' },
    };
  }

  const unstated = activeGoals.find((g) => {
    if (g.templateId === 'vape_sessions') return false;
    const tr = todayTracking[g.id];
    const status = (tr?.status ?? 'unknown') as TrackingStatus;
    return status === 'unknown';
  });

  if (unstated) {
    const challengeType = challengeTypeForTemplate(unstated.templateId);
    const displayTitle = publicGoalTitle(unstated);
    if (challengeType) {
      return {
        title: `Défi : ${displayTitle}`,
        subtitle: 'Chronomètre recommandé pour aujourd\'hui',
        cta: 'Voir le défi',
        route: { kind: 'challenges', challengeType },
      };
    }
    return {
      title: displayTitle,
      subtitle: 'Ton suivi du jour n\'est pas encore renseigné',
      cta: 'Renseigner',
      route: { kind: 'goals' },
    };
  }

  if (activeGoals.length === 0) {
    return {
      title: 'Aucune habitude active',
      subtitle: 'Choisis une première habitude pour lancer l\'aventure',
      cta: 'Ajouter une habitude',
      route: { kind: 'goals' },
      empty: true,
    };
  }

  const doneCount = activeGoals.filter((g) => {
    const tr = todayTracking[g.id];
    const s = (tr?.status ?? 'unknown') as TrackingStatus;
    return s === 'success' || s === 'partial';
  }).length;

  return {
    title: doneCount === activeGoals.length ? 'Journée bien avancée' : 'Tout est à jour',
    subtitle:
      doneCount === activeGoals.length
        ? 'Explore une quête ou prépare demain depuis Habitudes'
        : 'Retrouve le détail de tes habitudes si besoin',
    targetLine: `${doneCount}/${activeGoals.length} habitudes renseignées aujourd'hui`,
    cta: 'Voir mes habitudes',
    route: { kind: 'goals' },
  };
}