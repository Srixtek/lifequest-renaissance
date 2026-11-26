import type { Db } from '../../data/db/client';
import * as challengeSessionRepo from '../../data/db/repositories/challengeSessionRepo';
import {
  getRenewableQuestBoard,
  type RenewableBoardEntry,
} from './renewableQuestService';
import { getQuestBoard } from './questService';
import { getKingdomView } from './kingdomService';
import { buildCampNextChallenge } from './campNextChallenge';
import type { GoalDefinition, TrackingEvent } from '../models/types';

export type WhatToDoRoute =
  | { kind: 'adventure'; tab: 'quests' | 'royaume'; instanceId?: string }
  | { kind: 'camp' }
  | { kind: 'goals' }
  | { kind: 'vape-adaptive' }
  | { kind: 'challenges'; challengeType: string };

export interface WhatToDoNow {
  title: string;
  subtitle: string;
  cta: string;
  route: WhatToDoRoute;
  kind: 'chrono' | 'claim' | 'adaptive' | 'combat' | 'forge' | 'habit' | 'quest' | 'idle';
}

function entryHasRunningTimer(e: RenewableBoardEntry): boolean {
  return e.timerRunning;
}

export async function buildWhatToDoNow(
  db: Db,
  input: {
    activeGoals: GoalDefinition[];
    todayTracking: Record<string, TrackingEvent | null>;
    vapeDelayMin: number | null;
    vapeRunning: boolean;
  },
): Promise<WhatToDoNow> {
  const renewable = await getRenewableQuestBoard(db);
  const running = renewable.entries.find((e) => e.state === 'active' && entryHasRunningTimer(e));
  if (running) {
    return {
      title: `Chrono : ${running.template.title}`,
      subtitle: running.progress.label,
      cta: 'Reprendre la quête',
      route: { kind: 'adventure', tab: 'quests', instanceId: running.instanceId },
      kind: 'chrono',
    };
  }

  for (const type of ['sport', 'no_screen'] as const) {
    const s = await challengeSessionRepo.getRunningByType(db, type);
    if (s) {
      return {
        title: 'Défi en cours',
        subtitle: `${type === 'sport' ? 'Sport' : 'Sans écran'} — chrono actif`,
        cta: 'Voir le défi',
        route: { kind: 'challenges', challengeType: type },
        kind: 'chrono',
      };
    }
  }

  const renewableReady = renewable.entries.find((e) => e.state === 'ready');
  if (renewableReady) {
    return {
      title: `Réclamer : ${renewableReady.template.title}`,
      subtitle: `+${renewableReady.template.rewardGold} or t'attendent`,
      cta: 'Réclamer la récompense',
      route: { kind: 'adventure', tab: 'quests', instanceId: renewableReady.instanceId },
      kind: 'claim',
    };
  }
  const legacyReady = (await getQuestBoard(db)).entries.find((e) => e.state === 'ready');
  if (legacyReady) {
    return {
      title: `Réclamer : ${legacyReady.def.title}`,
      subtitle: 'Quête des Légendes prête',
      cta: 'Aller aux quêtes',
      route: { kind: 'adventure', tab: 'quests' },
      kind: 'claim',
    };
  }

  if (input.vapeRunning) {
    return {
      title: 'Défi vape en cours',
      subtitle: 'Reprends ton défi adaptatif',
      cta: 'Ouvrir le défi vape',
      route: { kind: 'vape-adaptive' },
      kind: 'adaptive',
    };
  }

  const kingdom = await getKingdomView(db);
  if (kingdom.combat.active && !kingdom.combat.outcome) {
    return {
      title: 'Combat en cours',
      subtitle: 'L\'arène t\'attend au bastion',
      cta: 'Reprendre le combat',
      route: { kind: 'adventure', tab: 'royaume' },
      kind: 'combat',
    };
  }

  if (kingdom.canUpgrade && kingdom.forge.upgradeCost) {
    return {
      title: 'Améliorer la forge',
      subtitle: `${kingdom.forge.upgradeCost} or — renforcer le bastion`,
      cta: 'Aller à la forge',
      route: { kind: 'adventure', tab: 'royaume' },
      kind: 'forge',
    };
  }

  const offered = renewable.recommended.find((e) => e.state === 'offered' || e.state === 'active');
  if (offered) {
    return {
      title: offered.template.title,
      subtitle: offered.template.nextStep,
      cta: offered.state === 'active' ? 'Continuer la quête' : 'Accepter la quête',
      route: { kind: 'adventure', tab: 'quests', instanceId: offered.instanceId },
      kind: 'quest',
    };
  }

  const camp = buildCampNextChallenge(input);
  return {
    title: camp.title,
    subtitle: camp.subtitle,
    cta: camp.cta,
    route:
      camp.route.kind === 'vape-adaptive'
        ? { kind: 'vape-adaptive' }
        : camp.route.kind === 'challenges'
          ? { kind: 'challenges', challengeType: camp.route.challengeType }
          : { kind: 'goals' },
    kind: camp.empty ? 'idle' : 'habit',
  };
}