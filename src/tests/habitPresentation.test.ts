import {
  customCreationTargetPlaceholder,
  presentHabitCard,
  setupTargetCopy,
} from '../domain/content/habitPresentation';
import type { GoalDefinition } from '../domain/models/types';

function goal(partial: Partial<GoalDefinition> & Pick<GoalDefinition, 'kind'>): GoalDefinition {
  return {
    id: 'g1',
    title: 'Test',
    unit: null,
    weight: 1,
    status: 'active',
    templateId: null,
    sensitive: false,
    followWithoutXp: false,
    createdAt: '2025-01-01T00:00:00.000Z',
    ...partial,
  };
}

const dailyVer = { unit: null, target: 2, scheduleKind: 'daily' as const, weeklyTarget: null };

describe('presentHabitCard — vape', () => {
  test('limit shows plafond and explicit question', () => {
    const g = goal({
      kind: 'limit',
      templateId: 'vape_sessions',
      title: 'Vape — maximum quotidien',
      unit: 'séances',
    });
    const card = presentHabitCard(g, { ...dailyVer, target: 5, unit: 'séances' }, undefined, 0);
    expect(card.objectiveLine).toMatch(/Plafond du jour : 5 séances maximum/);
    expect(card.dailyQuestion).toMatch(/séances de vape/);
    expect(card.inputPlaceholder).not.toMatch(/Quantité/);
    expect(card.primaryLogLabel).toBe('Enregistrer');
  });

  test('measure mode is neutral', () => {
    const g = goal({
      kind: 'quantity',
      templateId: 'vape_sessions',
      followWithoutXp: true,
      unit: 'séances',
    });
    const card = presentHabitCard(g, { ...dailyVer, target: null }, undefined, 0);
    expect(card.objectiveLine).toMatch(/Suivi neutre/);
    expect(card.dailyQuestion).toMatch(/sans XP auto/);
  });

  test('abstinence binary labels', () => {
    const g = goal({ kind: 'abstinence', templateId: 'vape_sessions', unit: 'séances' });
    const card = presentHabitCard(g, { ...dailyVer, target: null }, undefined, 0);
    expect(card.objectiveLine).toMatch(/sans consommation/);
    expect(card.binarySuccessLabel).toBe('Journée sans consommation enregistrée');
    expect(card.binaryMissLabel).toBe('Consommation enregistrée');
  });

  test('abstinence today label never uses Déclaré : oui', () => {
    const g = goal({ kind: 'abstinence', templateId: 'vape_sessions', unit: 'séances' });
    const ok = presentHabitCard(g, { ...dailyVer, target: null }, { status: 'success', value: 0 }, 0);
    const ko = presentHabitCard(g, { ...dailyVer, target: null }, { status: 'miss', value: 1 }, 0);
    expect(ok.todayValueLabel).toBe('Journée sans consommation enregistrée');
    expect(ko.todayValueLabel).toBe('Consommation enregistrée');
    expect(ok.todayValueLabel).not.toMatch(/Déclaré/);
  });
});

describe('presentHabitCard — alcool', () => {
  test('limit allows zero in copy', () => {
    const g = goal({
      kind: 'limit',
      templateId: 'alcohol_limit',
      unit: 'verres',
      title: 'Alcool — maximum quotidien',
    });
    const card = presentHabitCard(g, { ...dailyVer, target: 2 }, undefined, 0);
    expect(card.objectiveLine).toMatch(/Plafond/);
    expect(card.dailyQuestion).toMatch(/0 = aucun verre/);
    expect(card.inputPlaceholder).toMatch(/0 = aucun verre/);
  });
});

describe('presentHabitCard — sport et écran', () => {
  test('duration uses minimum wording', () => {
    const g = goal({
      kind: 'duration',
      templateId: 'sport_minutes',
      unit: 'min',
      title: 'Sport ou mouvement',
    });
    const card = presentHabitCard(g, { ...dailyVer, target: 30 }, undefined, 0);
    expect(card.objectiveLine).toMatch(/au moins 30 min/);
    expect(card.dailyQuestion).toMatch(/activité/);
  });

  test('screen-free minimum', () => {
    const g = goal({
      kind: 'duration',
      templateId: 'screen_free',
      unit: 'min',
      title: 'Temps sans écran (déclaré)',
    });
    const card = presentHabitCard(g, { ...dailyVer, target: 60 }, undefined, 0);
    expect(card.objectiveLine).toMatch(/au moins 60 min/);
  });
});

describe('presentHabitCard — famille hebdo', () => {
  test('weekly progress in objective', () => {
    const g = goal({
      kind: 'habit',
      templateId: 'call_family',
      title: 'Famille et proches — appels',
      followWithoutXp: true,
    });
    const card = presentHabitCard(
      g,
      { unit: null, target: null, scheduleKind: 'weekly', weeklyTarget: 2 },
      { status: 'unknown', value: null },
      1,
    );
    expect(card.objectiveLine).toBe('1/2 jours avec appel cette semaine');
    expect(card.weeklyHint).toBeTruthy();
    expect(card.binarySuccessLabel).toBe('Appel enregistré');
  });

  test('weekly call states', () => {
    const g = goal({
      kind: 'habit',
      templateId: 'call_family',
      title: 'Famille et proches — appels',
      followWithoutXp: true,
    });
    const ver = { unit: null, target: null, scheduleKind: 'weekly' as const, weeklyTarget: 2 };
    expect(
      presentHabitCard(g, ver, { status: 'success', value: null }, 1).todayValueLabel,
    ).toBe('Appel enregistré');
    expect(presentHabitCard(g, ver, { status: 'miss', value: null }, 0).todayValueLabel).toBe(
      "Pas d'appel aujourd'hui",
    );
    expect(presentHabitCard(g, ver, { status: 'unknown', value: null }, 0).todayValueLabel).toBe(
      'Pas encore renseigné',
    );
  });

  test('weekly habit paused', () => {
    const g = goal({
      kind: 'habit',
      templateId: 'call_family',
      status: 'paused',
      followWithoutXp: true,
    });
    const card = presentHabitCard(
      g,
      { unit: null, target: null, scheduleKind: 'weekly', weeklyTarget: 2 },
      { status: 'unknown', value: null },
      0,
    );
    expect(card.todayValueLabel).toMatch(/En pause/);
    expect(card.objectiveLine).toMatch(/pause/i);
  });
});

describe('presentHabitCard — régulation sensible', () => {
  test('discreet title via publicGoalTitle', () => {
    const g = goal({
      kind: 'reduce',
      templateId: 'freq_regulation',
      sensitive: true,
      title: 'Masturbation / sexualité personnelle — maximum quotidien',
      unit: 'fois',
    });
    const card = presentHabitCard(g, { ...dailyVer, target: 1 }, undefined, 0);
    expect(card.title).toBe('Régulation personnelle — maximum quotidien');
    expect(card.objectiveLine).toMatch(/Plafond/);
  });
});

describe('presentHabitCard — respiration historique', () => {
  test('manual note and duration question', () => {
    const g = goal({
      kind: 'duration',
      templateId: 'breathing5',
      unit: 'min',
      title: 'Respiration 5 min',
    });
    const card = presentHabitCard(g, { ...dailyVer, target: 5 }, undefined, 0);
    expect(card.breathingManualNote).toMatch(/outil Respiration/);
    expect(card.dailyQuestion).toMatch(/respiration lente/);
  });
});

describe('presentHabitCard — valeurs du jour', () => {
  test('unknown numeric is pas encore renseigné', () => {
    const g = goal({ kind: 'limit', templateId: 'vape_sessions', unit: 'séances' });
    const card = presentHabitCard(
      g,
      { ...dailyVer, target: 3 },
      { status: 'unknown', value: null },
      0,
    );
    expect(card.todayValueLabel).toBe('Pas encore renseigné');
  });

  test('zero is shown as value not empty', () => {
    const g = goal({ kind: 'limit', templateId: 'alcohol_limit', unit: 'verres' });
    const card = presentHabitCard(
      g,
      { ...dailyVer, target: 2 },
      { status: 'success', value: 0 },
      0,
    );
    expect(card.todayValueLabel).toBe('0 verres');
  });
});

describe('setupTargetCopy', () => {
  test('vape reduce uses plafond', () => {
    const c = setupTargetCopy('A', 'reduce');
    expect(c?.placeholder).toMatch(/Maximum séances/);
    expect(c?.prompt).toMatch(/plafond/i);
  });

  test('sport uses minimum minutes', () => {
    const c = setupTargetCopy('D', 'minutes');
    expect(c?.placeholder).toMatch(/minimum/i);
  });

  test('stop has no numeric field copy', () => {
    expect(setupTargetCopy('B', 'stop')).toBeNull();
  });
});

describe('presentHabitCard — quantity personnalisée', () => {
  test('followWithoutXp stays neutral', () => {
    const g = goal({ kind: 'quantity', followWithoutXp: true, unit: 'fois' });
    const card = presentHabitCard(g, { ...dailyVer, target: null }, undefined, 0);
    expect(card.objectiveLine).toMatch(/Suivi neutre/);
    expect(card.dailyQuestion).toMatch(/suivi neutre/);
  });

  test('with target shows minimum not neutral', () => {
    const g = goal({ kind: 'quantity', followWithoutXp: false, unit: 'fois' });
    const card = presentHabitCard(g, { ...dailyVer, target: 3 }, undefined, 0);
    expect(card.objectiveLine).toMatch(/au moins 3/);
    expect(card.dailyQuestion).toMatch(/minimum visé/);
  });
});

describe('customCreationTargetPlaceholder', () => {
  test('quantity is required not facultatif', () => {
    const p = customCreationTargetPlaceholder('quantity');
    expect(p).not.toMatch(/facultatif/i);
    expect(p).toMatch(/Minimum|>/);
  });
});