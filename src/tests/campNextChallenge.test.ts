import { buildCampNextChallenge } from '../domain/services/campNextChallenge';
import type { GoalDefinition } from '../domain/models/types';

function goal(overrides: Partial<GoalDefinition> & Pick<GoalDefinition, 'id' | 'templateId'>): GoalDefinition {
  return {
    status: 'active',
    followWithoutXp: false,
    measureMode: false,
    kind: 'limit',
    createdAt: '2020-01-01',
    updatedAt: '2020-01-01',
    ...overrides,
  } as GoalDefinition;
}

describe('buildCampNextChallenge — vape', () => {
  test('does not recommend vape delay when habit is paused (not in active list)', () => {
    const screen = goal({ id: 'g1', templateId: 'screen_free' });
    const r = buildCampNextChallenge({
      activeGoals: [screen],
      todayTracking: {},
      vapeDelayMin: 10,
      vapeRunning: false,
    });
    expect(r.title).toContain('Défi');
    expect(r.route.kind).toBe('challenges');
  });

  test('running vape shows Reprendre mon défi', () => {
    const vape = goal({ id: 'gv', templateId: 'vape_sessions' });
    const r = buildCampNextChallenge({
      activeGoals: [vape],
      todayTracking: {},
      vapeDelayMin: null,
      vapeRunning: true,
    });
    expect(r.cta).toBe('Reprendre mon défi');
    expect(r.route).toEqual({ kind: 'vape-adaptive' });
  });

  test('active vape without running uses Voir le défi', () => {
    const vape = goal({ id: 'gv', templateId: 'vape_sessions' });
    const r = buildCampNextChallenge({
      activeGoals: [vape],
      todayTracking: { gv: { status: 'success' } as never },
      vapeDelayMin: 15,
      vapeRunning: false,
    });
    expect(r.cta).toBe('Voir le défi');
    expect(r.targetLine).toContain('15 min');
  });
});

describe('buildCampNextChallenge — habitudes', () => {
  test('chronometer habit uses Voir le défi not Commencer', () => {
    const sport = goal({ id: 'gs', templateId: 'sport_minutes' });
    const r = buildCampNextChallenge({
      activeGoals: [sport],
      todayTracking: {},
      vapeDelayMin: null,
      vapeRunning: false,
    });
    expect(r.cta).toBe('Voir le défi');
    expect(r.route).toEqual({ kind: 'challenges', challengeType: 'sport' });
  });

  test('no active habits proposes creation', () => {
    const r = buildCampNextChallenge({
      activeGoals: [],
      todayTracking: {},
      vapeDelayMin: null,
      vapeRunning: false,
    });
    expect(r.empty).toBe(true);
    expect(r.cta).toBe('Ajouter une habitude');
  });
});