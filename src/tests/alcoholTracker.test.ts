jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: '/tmp/',
  documentDirectory: '/tmp/',
  EncodingType: { Base64: 'base64' },
  writeAsStringAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
}));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { migrate } from '../data/db/client';
import {
  ALCOHOL_PRESETS,
  STANDARD_DRINK_MG,
  computeAlcoholMg,
  computeGoalSuggestion,
  computeSince,
  formatDrinks,
  formatDrinksLabel,
  parseScaledDecimal,
  parseWeeklyGoalDrinks,
  scaledToText,
  validateDrinkForm,
  wallClockToInstant,
  alcoholLogicalDate,
  type DrinkFormInput,
  type ValidatedDrink,
} from '../domain/rules/alcohol';
import {
  acceptGoalSuggestion,
  addConsumption,
  cancelConsumption,
  confirmStartMarker,
  declareZeroDay,
  dismissGoalSuggestion,
  editConsumption,
  getAlcoholDashboard,
  getConsumptionAudit,
  listDayEntries,
  revokeZeroDayDeclaration,
  setWeeklyGoal,
  type AlcoholOpts,
} from '../domain/services/alcoholTrackerService';
import { exportBackupPayload, importBackupPayload } from '../domain/services/backupService';
import { declareVape, getVapeTrackerDashboard, startVapeMainSession } from '../domain/services/vapeTrackerService';
import { nodeSqliteAvailable, openNodeSqliteDb, type TestDb } from './helpers/nodeSqliteDb';

const TZ = 'Europe/Paris';
const BASE: AlcoholOpts = { timeZone: TZ, dayStartHour: 4 };
const at = (iso: string) => new Date(iso);
const opts = (nowIso: string): AlcoholOpts => ({ ...BASE, now: at(nowIso) });

function drink(
  type: DrinkFormInput['type'],
  volumeMl: string,
  abvPct: string,
  quantity = '1',
  extra: Partial<DrinkFormInput> = {},
): ValidatedDrink {
  const v = validateDrinkForm({ type, name: '', volumeMl, abvPct, quantity, ...extra });
  if (!v.ok) throw new Error(`drink invalide: ${JSON.stringify(v.errors)}`);
  return v.value;
}
const beer = (q = '1') => drink('beer', '250', '5', q);
const wine = (q = '1') => drink('wine', '100', '12', q);
const spirit = (q = '1') => drink('spirit', '30', '40', q);

describe('V1-02B — calcul exact des unités (règles pures)', () => {
  test('1. bière, vin, spiritueux : alcool pur en mg entiers, formule indépendante', () => {
    // 250 ml × 5 % × 0,789 = 9,8625 g → 9862,5 mg → 9863 mg (demi vers le haut)
    expect(computeAlcoholMg(beer())).toBe(9863);
    // 100 ml × 12 % × 0,789 = 9,468 g ; 30 ml × 40 % × 0,789 = 9,468 g
    expect(computeAlcoholMg(wine())).toBe(9468);
    expect(computeAlcoholMg(spirit())).toBe(9468);
    expect(formatDrinks(9863)).toBe('0,99');
    expect(formatDrinks(9468)).toBe('0,95');
  });

  test('1. quantités multiples : calculées depuis les paramètres, pas depuis une valeur déjà arrondie', () => {
    // 2 × 9,8625 g = 19,725 g exactement (et non 2 × 9863 = 19726)
    expect(computeAlcoholMg(beer('2'))).toBe(19725);
    expect(computeAlcoholMg(beer('3'))).toBe(29588); // 29587,5 → 29588
    expect(computeAlcoholMg(beer('0,5'))).toBe(4931); // 4931,25
    expect(formatDrinks(19725)).toBe('1,97');
  });

  test('1. décimales de volume, degré et quantité', () => {
    // 125 ml × 12,5 % × 0,789 = 12,328125 g
    expect(computeAlcoholMg(drink('wine', '125', '12,5'))).toBe(12328);
    // 330 ml × 4,5 % × 0,789 = 11,71665 g
    expect(computeAlcoholMg(drink('beer', '330', '4.5'))).toBe(11717);
    // 4,5 ml × 40 % × 0,789 = 1,4202 g
    expect(computeAlcoholMg(drink('other', '4,5', '40'))).toBe(1420);
    expect(computeAlcoholMg(drink('other', '5000', '100', '50'))).toBe(197_250_000);
  });

  test('1. un verre standard = 10 g : un gros volume donne exactement 1 verre', () => {
    // 10 g / 0,789 / 0,4 = 31,6857 ml → 316,857… ; test inverse : 12,67427… impossible en entier, on vérifie la cohérence
    const mg = computeAlcoholMg(drink('other', '1000', '1,3'));
    expect(mg).toBe(10257); // 1000 × 0,013 × 0,789 = 10,257 g
    expect(mg / STANDARD_DRINK_MG).toBeCloseTo(1.0257, 4);
    expect(formatDrinksLabel(10_000)).toBe('1 verre standard');
    expect(formatDrinksLabel(5_000)).toBe('0,5 verre standard');
    expect(formatDrinksLabel(19_725)).toBe('1,97 verre standard');
    expect(formatDrinksLabel(20_000)).toBe('2 verres standard');
  });

  test('2. préréglages modifiables ; « Autre » ne suppose rien', () => {
    const byType = Object.fromEntries(ALCOHOL_PRESETS.map((p) => [p.type, p]));
    expect(byType.beer).toMatchObject({ volumeMl: '250', abvPct: '5' });
    expect(byType.wine).toMatchObject({ volumeMl: '100', abvPct: '12' });
    expect(byType.spirit).toMatchObject({ volumeMl: '30', abvPct: '40' });
    expect(byType.other).toMatchObject({ volumeMl: null, abvPct: null });
    // Un préréglage modifié (bière 33 cl, 6,5 %) est accepté tel quel
    const custom = drink('beer', '330', '6,5', '1', { name: '  IPA  ' });
    expect(custom).toMatchObject({ volumeMlX10: 3300, abvX10: 65, quantityX100: 100, name: 'IPA' });
    expect(scaledToText(custom.volumeMlX10, 1)).toBe('330');
    expect(scaledToText(65, 1)).toBe('6,5');
    expect(scaledToText(50, 2)).toBe('0,5');
  });

  test('2/5. rejette non numérique, négatif, vide, incohérent ; aucun degré supposé', () => {
    const base: DrinkFormInput = { type: 'beer', name: '', volumeMl: '250', abvPct: '5', quantity: '1' };
    const bad = (patch: Partial<DrinkFormInput>) => validateDrinkForm({ ...base, ...patch });
    expect(bad({ volumeMl: '' }).ok).toBe(false);
    expect(bad({ volumeMl: 'abc' }).ok).toBe(false);
    expect(bad({ volumeMl: '-250' }).ok).toBe(false);
    expect(bad({ volumeMl: '0' }).ok).toBe(false);
    expect(bad({ volumeMl: '5001' }).ok).toBe(false);
    expect(bad({ volumeMl: '1e3' }).ok).toBe(false);
    expect(bad({ volumeMl: '25,55' }).ok).toBe(false);
    expect(bad({ abvPct: '' }).ok).toBe(false);
    expect(bad({ abvPct: '0' }).ok).toBe(false);
    expect(bad({ abvPct: '-5' }).ok).toBe(false);
    expect(bad({ abvPct: '101' }).ok).toBe(false);
    expect(bad({ abvPct: '5,55' }).ok).toBe(false);
    expect(bad({ quantity: '0' }).ok).toBe(false);
    expect(bad({ quantity: '-1' }).ok).toBe(false);
    expect(bad({ quantity: '51' }).ok).toBe(false);
    expect(bad({ quantity: 'deux' }).ok).toBe(false);
    expect(bad({ type: 'cocktail' as never }).ok).toBe(false);
    const r = bad({ volumeMl: '', abvPct: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['abvPct', 'volumeMl']);
    expect(parseScaledDecimal(' 12,5 ', 1)).toEqual({ ok: true, scaled: 125 });
    expect(parseScaledDecimal('12.', 1).ok).toBe(false);
    expect(() => computeAlcoholMg({ volumeMlX10: 0, abvX10: 50, quantityX100: 100 })).toThrow();
    expect(() => computeAlcoholMg({ volumeMlX10: 2500.5, abvX10: 50, quantityX100: 100 })).toThrow();
  });

  test('8. objectif hebdomadaire saisi en verres : conversion exacte en mg', () => {
    expect(parseWeeklyGoalDrinks('10')).toEqual({ ok: true, mg: 100_000 });
    expect(parseWeeklyGoalDrinks('7,5')).toEqual({ ok: true, mg: 75_000 });
    expect(parseWeeklyGoalDrinks('0')).toEqual({ ok: true, mg: 0 });
    expect(parseWeeklyGoalDrinks('').ok).toBe(false);
    expect(parseWeeklyGoalDrinks('-3').ok).toBe(false);
    expect(parseWeeklyGoalDrinks('201').ok).toBe(false);
  });
});

describe('V1-02B — dates, fuseau Europe/Paris, minuit, changement d\'heure (règles pures)', () => {
  const logical = (iso: string) => alcoholLogicalDate(at(iso), TZ, 4);

  test('9. frontière de journée à 4 h (heure d\'hiver)', () => {
    expect(logical('2026-03-10T02:59:00Z')).toBe('2026-03-09'); // 03:59 Paris
    expect(logical('2026-03-10T03:00:00Z')).toBe('2026-03-10'); // 04:00 Paris
    expect(logical('2026-03-09T23:30:00Z')).toBe('2026-03-09'); // 00:30 Paris le 10 → journée du 9
    expect(alcoholLogicalDate(at('2026-03-09T23:30:00Z'), TZ, 0)).toBe('2026-03-10');
  });

  test('9. passage à l\'heure d\'été (29 mars 2026, 02:00 → 03:00)', () => {
    expect(logical('2026-03-29T01:30:00Z')).toBe('2026-03-28'); // 03:30 CEST : avant 4 h
    expect(logical('2026-03-29T02:00:00Z')).toBe('2026-03-29'); // 04:00 CEST pile
    expect(logical('2026-03-29T02:30:00Z')).toBe('2026-03-29'); // 04:30 CEST (un décalage fixe de 4 h UTC se tromperait ici)
    expect(logical('2026-03-28T22:30:00Z')).toBe('2026-03-28'); // 23:30 CET
  });

  test('9. retour à l\'heure d\'hiver (25 octobre 2026, 03:00 → 02:00)', () => {
    expect(logical('2026-10-25T00:30:00Z')).toBe('2026-10-24'); // 02:30 CEST
    expect(logical('2026-10-25T01:30:00Z')).toBe('2026-10-24'); // 02:30 CET (seconde occurrence)
    expect(logical('2026-10-25T02:59:00Z')).toBe('2026-10-24'); // 03:59 CET
    expect(logical('2026-10-25T03:00:00Z')).toBe('2026-10-25'); // 04:00 CET
  });

  test('9. saisie date + heure murales → instant (été, hiver, saut, ambiguïté, invalide)', () => {
    expect(wallClockToInstant('2026-01-15', '12:00', TZ)?.toISOString()).toBe('2026-01-15T11:00:00.000Z');
    expect(wallClockToInstant('2026-07-01', '12:00', TZ)?.toISOString()).toBe('2026-07-01T10:00:00.000Z');
    expect(wallClockToInstant('2026-03-29', '02:30', TZ)?.toISOString()).toBe('2026-03-29T01:30:00.000Z'); // heure inexistante → 03:30 CEST
    expect(wallClockToInstant('2026-10-25', '02:30', TZ)?.toISOString()).toBe('2026-10-25T00:30:00.000Z'); // ambiguë → première occurrence
    expect(wallClockToInstant('2026-02-30', '12:00', TZ)).toBeNull();
    expect(wallClockToInstant('2026-03-10', '24:00', TZ)).toBeNull();
    expect(wallClockToInstant('hier', '12:00', TZ)).toBeNull();
  });
});

describe('V1-02B — chrono et suggestion (règles pures)', () => {
  test('8. chrono : dernière boisson ou départ confirmé, jamais un passé inventé', () => {
    const now = Date.parse('2026-03-11T12:00:00Z');
    expect(computeSince(null, null, now)).toBeNull();
    expect(computeSince('2026-03-11T10:00:00Z', null, now)).toMatchObject({ kind: 'last_drink', elapsedSec: 7200 });
    expect(computeSince(null, '2026-03-10T12:00:00Z', now)).toMatchObject({ kind: 'confirmed_start', elapsedSec: 86400 });
    expect(computeSince('2026-03-11T10:00:00Z', '2026-03-09T12:00:00Z', now)?.kind).toBe('last_drink');
    expect(computeSince('2026-03-08T10:00:00Z', '2026-03-09T12:00:00Z', now)?.kind).toBe('confirmed_start');
    expect(computeSince('2026-03-12T10:00:00Z', null, now)).toMatchObject({ elapsedSec: 0, clockAnomaly: true });
  });

  test('10. suggestion : jamais plus dure que nécessaire, silence après changement/refus', () => {
    const weeks = (totals: number[], docDays = 7) =>
      totals.map((t, i) => ({ weekStart: `w${i}`, totalMg: t * STANDARD_DRINK_MG, documentedDays: docDays, complete: true }));
    const base = { lastGoalChangeMs: null, lastDismissMs: null, nowMs: Date.parse('2026-03-30T10:00:00Z') };

    const s = computeGoalSuggestion({ ...base, completedWeeksNewestFirst: weeks([12, 14, 13]), currentGoalMg: null });
    expect(s).toMatchObject({ weeksUsed: 3, averageMg: 130_000, proposedMg: 115_000 });
    expect(s?.message).toContain('13 unités par semaine sur les 3 dernières semaines');
    expect(s?.message).toContain('objectif proposé : 11,5');

    // Historique insuffisant : une seule semaine, ou semaines trop peu renseignées (jamais traitées comme zéro)
    expect(computeGoalSuggestion({ ...base, completedWeeksNewestFirst: weeks([12]), currentGoalMg: null })).toBeNull();
    expect(computeGoalSuggestion({ ...base, completedWeeksNewestFirst: weeks([12, 14, 13], 4), currentGoalMg: null })).toBeNull();
    const withGap = [...weeks([12, 14]), { weekStart: 'gap', totalMg: 0, documentedDays: 0, complete: true }];
    expect(computeGoalSuggestion({ ...base, completedWeeksNewestFirst: withGap, currentGoalMg: null })?.averageMg).toBe(130_000);

    // Pas d'escalade : objectif déjà ≤ proposition → rien ; moyenne déjà basse → rien
    expect(computeGoalSuggestion({ ...base, completedWeeksNewestFirst: weeks([8, 8]), currentGoalMg: 70_000 })).toBeNull();
    expect(computeGoalSuggestion({ ...base, completedWeeksNewestFirst: weeks([8, 8]), currentGoalMg: 100_000 })?.proposedMg).toBe(70_000);
    expect(computeGoalSuggestion({ ...base, completedWeeksNewestFirst: weeks([2, 1]), currentGoalMg: null })).toBeNull();

    // Silence 28 jours après un changement d'objectif ou un refus
    const day = 86_400_000;
    const recent = { ...base, completedWeeksNewestFirst: weeks([12, 14]), currentGoalMg: null };
    expect(computeGoalSuggestion({ ...recent, lastGoalChangeMs: base.nowMs - 27 * day })).toBeNull();
    expect(computeGoalSuggestion({ ...recent, lastGoalChangeMs: base.nowMs - 29 * day })).not.toBeNull();
    expect(computeGoalSuggestion({ ...recent, lastDismissMs: base.nowMs - 10 * day })).toBeNull();
  });
});

const suite = nodeSqliteAvailable() ? describe : describe.skip;

async function countRows(t: TestDb, table: string): Promise<number> {
  const r = await t.db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`);
  return Number(r?.n ?? 0);
}

suite('V1-02B — journal alcool (SQLite réel)', () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await openNodeSqliteDb();
  });
  afterEach(() => t.close());

  async function add(nowIso: string, d: ValidatedDrink, consumedIso = nowIso, clientRequestId?: string) {
    const r = await addConsumption(t.db, { drink: d, consumedAt: at(consumedIso), clientRequestId }, opts(nowIso));
    if (!r.ok) throw new Error(`add: ${r.code}`);
    return r;
  }

  const NOW = '2026-03-11T11:00:00.000Z'; // mercredi 11 mars 2026, 12:00 Paris

  test('3. correction : volume, degré, quantité, heure recalculent les totaux ; trace d\'audit', async () => {
    const a = await add('2026-03-10T19:00:00Z', beer());
    expect(a.consumption.alcoholMg).toBe(9863);
    let dash = await getAlcoholDashboard(t.db, opts(NOW));
    expect(dash.todayMg).toBe(0);
    expect(dash.weekMg).toBe(9863);

    const e1 = await editConsumption(t.db, a.consumption.id, { drink: beer('2'), consumedAt: at('2026-03-10T19:00:00Z') }, opts(NOW));
    expect(e1).toMatchObject({ ok: true, changed: true });
    if (e1.ok) expect(e1.consumption).toMatchObject({ alcoholMg: 19725, quantityX100: 200, corrections: 1 });

    const e2 = await editConsumption(
      t.db,
      a.consumption.id,
      { drink: drink('wine', '125', '12,5', '1', { name: 'Rouge', note: 'dîner' }), consumedAt: at('2026-03-11T10:00:00Z') },
      opts(NOW),
    );
    expect(e2).toMatchObject({ ok: true, changed: true });
    dash = await getAlcoholDashboard(t.db, opts(NOW));
    expect(dash.todayMg).toBe(12328); // déplacée d'hier à aujourd'hui
    expect(dash.weekMg).toBe(12328);

    // Aucun changement : pas de ligne d'audit supplémentaire
    const same = await editConsumption(
      t.db,
      a.consumption.id,
      { drink: drink('wine', '125', '12,5', '1', { name: 'Rouge', note: 'dîner' }), consumedAt: at('2026-03-11T10:00:00Z') },
      opts(NOW),
    );
    expect(same).toMatchObject({ ok: true, changed: false });

    const audit = await getConsumptionAudit(t.db, a.consumption.id);
    expect(audit.map((k) => k.kind)).toEqual(['edit', 'edit']);
    expect(audit[0].before).toMatchObject({ alcoholMg: 9863, quantityX100: 100, drinkType: 'beer', localDate: '2026-03-10' });
    expect(audit[0].after).toMatchObject({ alcoholMg: 19725, quantityX100: 200 });
    expect(audit[1].before).toMatchObject({ alcoholMg: 19725 });
    expect(audit[1].after).toMatchObject({ alcoholMg: 12328, drinkType: 'wine', name: 'Rouge', localDate: '2026-03-11' });

    expect(await editConsumption(t.db, 'inconnu', { drink: beer(), consumedAt: at(NOW) }, opts(NOW))).toEqual({ ok: false, code: 'not_found' });
    expect(await editConsumption(t.db, a.consumption.id, { drink: beer(), consumedAt: at('2026-03-12T10:00:00Z') }, opts(NOW))).toEqual({ ok: false, code: 'future_time' });
    expect(
      await editConsumption(t.db, a.consumption.id, { drink: { ...beer(), volumeMlX10: 0 }, consumedAt: at(NOW) }, opts(NOW)),
    ).toEqual({ ok: false, code: 'invalid_drink' });
  });

  test('4. annulation : exclue des totaux et du chrono, mais ligne + audit conservés', async () => {
    const a = await add('2026-03-11T08:00:00Z', beer());
    const b = await add('2026-03-11T09:00:00Z', wine());
    await editConsumption(t.db, b.consumption.id, { drink: wine('2'), consumedAt: at('2026-03-11T09:00:00Z') }, opts(NOW));
    let dash = await getAlcoholDashboard(t.db, opts(NOW));
    expect(dash.todayMg).toBe(9863 + 18936);
    expect(dash.since).toMatchObject({ kind: 'last_drink', sinceIso: '2026-03-11T09:00:00.000Z' });

    expect(await cancelConsumption(t.db, b.consumption.id, opts(NOW))).toEqual({ ok: true });
    expect(await cancelConsumption(t.db, b.consumption.id, opts(NOW))).toEqual({ ok: false, code: 'already_cancelled' });
    expect(await cancelConsumption(t.db, 'inconnu', opts(NOW))).toEqual({ ok: false, code: 'not_found' });
    expect(
      await editConsumption(t.db, b.consumption.id, { drink: beer(), consumedAt: at(NOW) }, opts(NOW)),
    ).toEqual({ ok: false, code: 'cancelled' });

    dash = await getAlcoholDashboard(t.db, opts(NOW));
    expect(dash.todayMg).toBe(9863);
    expect(dash.since).toMatchObject({ kind: 'last_drink', sinceIso: '2026-03-11T08:00:00.000Z' });

    const rows = await t.db.getAllAsync<{ id: string; status: string; alcohol_mg: number }>(
      `SELECT id, status, alcohol_mg FROM alcohol_consumptions ORDER BY created_at, rowid`,
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ id: b.consumption.id, status: 'cancelled', alcohol_mg: 18936 });
    const audit = await getConsumptionAudit(t.db, b.consumption.id);
    expect(audit.map((k) => k.kind)).toEqual(['edit', 'cancel']);
    expect(audit[1].before).toMatchObject({ alcoholMg: 18936, quantityX100: 200 });

    const day = await listDayEntries(t.db, '2026-03-11');
    expect(day.map((c) => c.status)).toEqual(['active', 'cancelled']);
    expect((await listDayEntries(t.db, '2026-03-11', false)).map((c) => c.id)).toEqual([a.consumption.id]);
  });

  test('5. pas de double saisie : même identifiant de demande, séquentiel ou simultané', async () => {
    const first = await add(NOW, beer(), '2026-03-11T10:00:00Z', 'req-1');
    expect(first.duplicate).toBe(false);
    const second = await add(NOW, beer(), '2026-03-11T10:00:00Z', 'req-1');
    expect(second.duplicate).toBe(true);
    expect(second.consumption.id).toBe(first.consumption.id);

    const [x, y] = await Promise.all([
      addConsumption(t.db, { drink: wine(), consumedAt: at('2026-03-11T10:30:00Z'), clientRequestId: 'req-2' }, opts(NOW)),
      addConsumption(t.db, { drink: wine(), consumedAt: at('2026-03-11T10:30:00Z'), clientRequestId: 'req-2' }, opts(NOW)),
    ]);
    expect(x.ok && y.ok).toBe(true);
    if (x.ok && y.ok) expect([x.duplicate, y.duplicate].sort()).toEqual([false, true]);
    expect(await countRows(t, 'alcohol_consumptions')).toBe(2);
    expect(await countRows(t, 'alcohol_events')).toBe(2);
    // Deux boissons identiques volontaires (identifiants distincts) restent possibles
    await add(NOW, beer(), '2026-03-11T10:00:00Z', 'req-3');
    expect(await countRows(t, 'alcohol_consumptions')).toBe(3);
  });

  test('5. saisies invalides refusées sans rien écrire (futur, date aberrante, paramètres)', async () => {
    const bad = (consumedAt: Date, d = beer()) => addConsumption(t.db, { drink: d, consumedAt }, opts(NOW));
    expect(await bad(at('2026-03-11T13:00:00Z'))).toEqual({ ok: false, code: 'future_time' });
    expect(await bad(new Date('nope'))).toEqual({ ok: false, code: 'invalid_time' });
    expect(await bad(at('1999-01-01T00:00:00Z'))).toEqual({ ok: false, code: 'invalid_time' });
    expect(await bad(at(NOW), { ...beer(), abvX10: 1001 })).toEqual({ ok: false, code: 'invalid_drink' });
    expect(await bad(at(NOW), { ...beer(), quantityX100: -1 })).toEqual({ ok: false, code: 'invalid_drink' });
    expect(await countRows(t, 'alcohol_consumptions')).toBe(0);
    expect(await countRows(t, 'alcohol_events')).toBe(0);
  });

  test('6. totaux jour / 7 derniers jours / semaine civile (calculés depuis les mg stockés)', async () => {
    await add('2026-03-04T19:30:00Z', wine()); // mer. 4 (semaine précédente, hors 7 jours)
    await add('2026-03-08T19:00:00Z', beer()); // dim. 8
    await add('2026-03-09T19:00:00Z', beer()); // lun. 9
    await add('2026-03-10T20:00:00Z', wine()); // mar. 10
    await add('2026-03-11T00:30:00Z', spirit()); // 01:30 Paris mer. 11 → journée du mardi 10
    await add('2026-03-11T10:00:00Z', beer('2')); // mer. 11
    const dash = await getAlcoholDashboard(t.db, opts(NOW));
    expect(dash.today).toBe('2026-03-11');
    expect([dash.weekStart, dash.weekEnd]).toEqual(['2026-03-09', '2026-03-15']);
    expect(dash.todayMg).toBe(19725);
    expect(dash.weekMg).toBe(9863 + 9468 + 9468 + 19725);
    expect(dash.last7Mg).toBe(9863 + 9863 + 9468 + 9468 + 19725); // 5 → 11 mars
    expect(dash.last7Days.map((d) => [d.localDate, d.totalMg])).toEqual([
      ['2026-03-05', 0],
      ['2026-03-06', 0],
      ['2026-03-07', 0],
      ['2026-03-08', 9863],
      ['2026-03-09', 9863],
      ['2026-03-10', 18936],
      ['2026-03-11', 19725],
    ]);
    expect(formatDrinks(dash.weekMg)).toBe('4,85');
    expect(dash.weeks[1]).toMatchObject({ weekStart: '2026-03-02', totalMg: 9468 + 9863, drinkDays: 2 });
  });

  test('6/9. semaine civile et minuit : lundi 00:30 appartient à la semaine précédente, lundi 04:30 à la nouvelle', async () => {
    // Semaine du 23 au 29 mars ; passage à l'heure d'été dans la nuit du 28 au 29
    await add('2026-03-29T21:00:00Z', beer()); // 23:00 CEST dim. 29
    await add('2026-03-29T22:30:00Z', beer()); // 00:30 CEST lun. 30 → journée du dimanche 29
    await add('2026-03-30T02:30:00Z', beer()); // 04:30 CEST lun. 30 → nouvelle semaine
    const dash = await getAlcoholDashboard(t.db, opts('2026-03-30T09:00:00Z'));
    expect(dash.today).toBe('2026-03-30');
    expect(dash.weekStart).toBe('2026-03-30');
    expect(dash.weekMg).toBe(9863);
    expect(dash.weeks[1]).toMatchObject({ weekStart: '2026-03-23', totalMg: 2 * 9863 });
    const sunday = await listDayEntries(t.db, '2026-03-29');
    expect(sunday).toHaveLength(2);
  });

  test('7. zéro déclaré ≠ aucune donnée ; une boisson annule la déclaration de zéro', async () => {
    let dash = await getAlcoholDashboard(t.db, opts(NOW));
    expect(dash.todayStatus).toBe('no_data');
    expect(dash.last7Days.every((d) => d.status === 'no_data' && d.totalMg === 0)).toBe(true);
    expect(dash.week.documentedDays).toBe(0);
    expect(dash.week.vsGoal).toBe('no_data');

    expect(await declareZeroDay(t.db, '2026-03-10', opts(NOW))).toEqual({ ok: true, alreadyDeclared: false });
    expect(await declareZeroDay(t.db, '2026-03-10', opts(NOW))).toEqual({ ok: true, alreadyDeclared: true });
    expect(await declareZeroDay(t.db, '2026-03-12', opts(NOW))).toEqual({ ok: false, code: 'future_date' });
    expect(await declareZeroDay(t.db, '10/03', opts(NOW))).toEqual({ ok: false, code: 'invalid_date' });
    dash = await getAlcoholDashboard(t.db, opts(NOW));
    const byDate = Object.fromEntries(dash.last7Days.map((d) => [d.localDate, d.status]));
    expect(byDate['2026-03-10']).toBe('zero_declared');
    expect(byDate['2026-03-09']).toBe('no_data');
    expect(dash.week).toMatchObject({ zeroDays: 1, documentedDays: 1, drinkDays: 0 });

    // Boisson le même jour → déclaration de zéro révoquée (tracée), refus inverse
    const r = await add('2026-03-10T19:00:00Z', beer());
    expect(r.revokedZeroDay).toBe(true);
    expect(await declareZeroDay(t.db, '2026-03-10', opts(NOW))).toEqual({ ok: false, code: 'has_consumption' });
    const zd = await t.db.getAllAsync<{ revoked_at: string | null; revoke_reason: string | null }>(`SELECT * FROM alcohol_zero_days`);
    expect(zd).toHaveLength(1);
    expect(zd[0].revoke_reason).toBe('consumption_added');

    // Annuler l'unique boisson ne fabrique PAS un zéro : le jour redevient « aucune donnée »
    await cancelConsumption(t.db, r.consumption.id, opts(NOW));
    dash = await getAlcoholDashboard(t.db, opts(NOW));
    expect(dash.last7Days.find((d) => d.localDate === '2026-03-10')?.status).toBe('no_data');

    expect(await declareZeroDay(t.db, '2026-03-10', opts(NOW))).toMatchObject({ ok: true });
    expect(await revokeZeroDayDeclaration(t.db, '2026-03-10', opts(NOW))).toBe(true);
    expect(await revokeZeroDayDeclaration(t.db, '2026-03-10', opts(NOW))).toBe(false);
  });

  test('8. chrono : demande un départ explicite, persiste, recalcul après correction', async () => {
    let dash = await getAlcoholDashboard(t.db, opts(NOW));
    expect(dash.since).toBeNull();
    expect(dash.needsStartConfirmation).toBe(true);

    expect(await confirmStartMarker(t.db, at('2026-03-12T10:00:00Z'), opts(NOW))).toEqual({ ok: false, code: 'future_time' });
    expect(await confirmStartMarker(t.db, new Date('x'), opts(NOW))).toEqual({ ok: false, code: 'invalid_time' });
    expect(await confirmStartMarker(t.db, at('2026-03-09T11:00:00Z'), opts(NOW))).toEqual({ ok: true });
    dash = await getAlcoholDashboard(t.db, opts(NOW));
    expect(dash.needsStartConfirmation).toBe(false);
    expect(dash.since).toMatchObject({ kind: 'confirmed_start', elapsedSec: 2 * 86_400, sinceIso: '2026-03-09T11:00:00.000Z' });

    // Un départ corrigé remplace le précédent sans l'effacer
    await confirmStartMarker(t.db, at('2026-03-10T11:00:00Z'), opts(NOW));
    expect(await countRows(t, 'alcohol_start_markers')).toBe(2);
    dash = await getAlcoholDashboard(t.db, opts(NOW));
    expect(dash.since?.elapsedSec).toBe(86_400);

    // Nouvelle boisson : le chrono repart de cette boisson
    const d = await add('2026-03-11T09:00:00Z', beer());
    expect(await confirmStartMarker(t.db, at('2026-03-11T08:00:00Z'), opts(NOW))).toEqual({ ok: false, code: 'before_last_drink' });
    dash = await getAlcoholDashboard(t.db, opts(NOW));
    expect(dash.since).toMatchObject({ kind: 'last_drink', elapsedSec: 7200 });

    // Correction de l'heure → recalcul ; annulation → retour au départ confirmé
    await editConsumption(t.db, d.consumption.id, { drink: beer(), consumedAt: at('2026-03-11T06:00:00Z') }, opts(NOW));
    dash = await getAlcoholDashboard(t.db, opts(NOW));
    expect(dash.since).toMatchObject({ kind: 'last_drink', elapsedSec: 5 * 3600 });
    await cancelConsumption(t.db, d.consumption.id, opts(NOW));
    dash = await getAlcoholDashboard(t.db, opts(NOW));
    expect(dash.since).toMatchObject({ kind: 'confirmed_start', sinceIso: '2026-03-10T11:00:00.000Z' });
  });

  test('8. chrono persistant : fermeture/réouverture de la base, recalculé depuis les horodatages', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lq-alc-'));
    const file = path.join(dir, 'a.db');
    const first = await openNodeSqliteDb(file);
    await addConsumption(first.db, { drink: beer(), consumedAt: at('2026-03-11T08:00:00Z') }, opts('2026-03-11T08:01:00Z'));
    first.close();

    const second = await openNodeSqliteDb(file);
    const d1 = await getAlcoholDashboard(second.db, opts('2026-03-11T10:00:00Z'));
    expect(d1.since).toMatchObject({ kind: 'last_drink', elapsedSec: 2 * 3600 });
    const d2 = await getAlcoholDashboard(second.db, opts('2026-03-13T08:00:00Z'));
    expect(d2.since?.elapsedSec).toBe(2 * 86_400);
    second.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('10. objectif : versions conservées, semaines passées évaluées avec l\'objectif d\'alors', async () => {
    expect(await setWeeklyGoal(t.db, 250_000, opts('2026-03-04T10:00:00Z'))).toMatchObject({ ok: true, changed: true, effectiveFrom: '2026-03-02' });
    expect(await setWeeklyGoal(t.db, 250_000, opts('2026-03-04T11:00:00Z'))).toMatchObject({ ok: true, changed: false });
    await add('2026-03-04T19:00:00Z', beer('4')); // semaine du 2 : 39 450 mg
    expect(await setWeeklyGoal(t.db, 30_000, opts(NOW))).toMatchObject({ ok: true, changed: true, effectiveFrom: '2026-03-09' });
    expect(await setWeeklyGoal(t.db, -1, opts(NOW))).toEqual({ ok: false, code: 'invalid_goal' });
    expect(await setWeeklyGoal(t.db, 1.5, opts(NOW))).toEqual({ ok: false, code: 'invalid_goal' });
    await add('2026-03-10T19:00:00Z', beer('4'));

    const dash = await getAlcoholDashboard(t.db, opts(NOW));
    expect(dash.goal).toMatchObject({ targetMg: 30_000, effectiveFrom: '2026-03-09', source: 'manual' });
    expect(dash.weeks[0]).toMatchObject({ goalMg: 30_000, totalMg: 39450, vsGoal: 'over' });
    expect(dash.weeks[1]).toMatchObject({ goalMg: 250_000, totalMg: 39450, vsGoal: 'within' });
    expect(await countRows(t, 'alcohol_weekly_goals')).toBe(2);
    // Consulter le tableau de bord n'écrit jamais d'objectif (pas de durcissement automatique)
    await getAlcoholDashboard(t.db, opts(NOW));
    await getAlcoholDashboard(t.db, opts('2026-03-30T10:00:00Z'));
    expect(await countRows(t, 'alcohol_weekly_goals')).toBe(2);
    expect(await setWeeklyGoal(t.db, 0, opts(NOW))).toMatchObject({ ok: true, changed: true }); // objectif 0 volontaire possible
  });

  async function seedDocumentedWeeks() {
    // Semaines du 9, 16 et 23 mars : 12 bières le lundi + 4 jours « aucune boisson » → 5 jours renseignés, 11,84 verres.
    // La semaine du 2 mars reste vide : « non renseignée », jamais traitée comme zéro.
    for (const monday of ['2026-03-09', '2026-03-16', '2026-03-23']) {
      await add(`${monday}T20:00:00Z`, beer('12'));
      for (const off of [1, 2, 3, 4]) {
        const d = new Date(Date.parse(`${monday}T12:00:00Z`) + off * 86_400_000).toISOString().slice(0, 10);
        expect(await declareZeroDay(t.db, d, opts('2026-03-30T10:00:00Z'))).toMatchObject({ ok: true });
      }
    }
  }

  test('10. suggestion expliquée, refusable/modifiable, jamais appliquée automatiquement', async () => {
    const NOW2 = '2026-03-30T10:00:00.000Z';
    let dash = await getAlcoholDashboard(t.db, opts(NOW2));
    expect(dash.suggestion).toBeNull();

    await seedDocumentedWeeks();
    dash = await getAlcoholDashboard(t.db, opts(NOW2));
    expect(dash.weeks[4]).toMatchObject({ weekStart: '2026-03-02', documentedDays: 0, vsGoal: 'no_data' });
    expect(dash.weeks[1]).toMatchObject({ weekStart: '2026-03-23', totalMg: 118_350, documentedDays: 5, weekOver: true });
    expect(dash.suggestion).toMatchObject({ weeksUsed: 3, averageMg: 118_350, proposedMg: 105_000 });
    expect(dash.suggestion?.message).toBe(
      'Tu as enregistré 11,84 unités par semaine sur les 3 dernières semaines renseignées (jours non renseignés non comptés) ; objectif proposé : 10,5 par semaine.',
    );
    expect(dash.goal).toBeNull();
    expect(await countRows(t, 'alcohol_weekly_goals')).toBe(0);
    expect(dash.comparison).toMatchObject({ latestWeekStart: '2026-03-23', previousWeekStart: '2026-03-16', deltaMg: 0 });

    // Valeur périmée refusée ; acceptation = nouvelle version d'objectif tracée
    expect(await acceptGoalSuggestion(t.db, 90_000, opts(NOW2))).toEqual({ ok: false, code: 'stale_suggestion' });
    expect(await acceptGoalSuggestion(t.db, 105_000, opts(NOW2))).toMatchObject({ ok: true, changed: true, effectiveFrom: '2026-03-30' });
    dash = await getAlcoholDashboard(t.db, opts(NOW2));
    expect(dash.goal).toMatchObject({ targetMg: 105_000, source: 'suggestion' });
    expect(dash.suggestion).toBeNull(); // silence après un changement d'objectif
  });

  test('10. refus d\'une suggestion : aucun objectif modifié, silence ensuite', async () => {
    await seedDocumentedWeeks();
    const NOW2 = '2026-03-30T10:00:00.000Z';
    expect((await getAlcoholDashboard(t.db, opts(NOW2))).suggestion).not.toBeNull();
    await dismissGoalSuggestion(t.db, opts(NOW2));
    expect((await getAlcoholDashboard(t.db, opts(NOW2))).suggestion).toBeNull();
    expect(await countRows(t, 'alcohol_weekly_goals')).toBe(0);
    // L'utilisateur reste libre de fixer son propre objectif
    expect(await setWeeklyGoal(t.db, 140_000, opts(NOW2))).toMatchObject({ ok: true });
    expect((await getAlcoholDashboard(t.db, opts(NOW2))).goal?.source).toBe('manual');
  });

  test('11. aucune récompense, aucune pénalité : registres XP/or/éclats, inventaire et progression intacts', async () => {
    const tables = ['xp_ledger', 'wallet_ledger', 'inventory_items', 'quest_instances', 'renewable_quest_history', 'daily_reward_days', 'tracking_events'];
    const snap = async () => ({
      counts: await Promise.all(tables.map((n) => countRows(t, n))),
      character: await t.db.getAllAsync(`SELECT * FROM character_progress`),
    });
    const before = await snap();
    const a = await add(NOW, beer('3'), '2026-03-11T10:00:00Z');
    await add(NOW, spirit('2'), '2026-03-11T10:30:00Z');
    await editConsumption(t.db, a.consumption.id, { drink: beer('5'), consumedAt: at('2026-03-11T10:00:00Z') }, opts(NOW));
    await cancelConsumption(t.db, a.consumption.id, opts(NOW));
    await declareZeroDay(t.db, '2026-03-10', opts(NOW));
    await confirmStartMarker(t.db, at('2026-03-09T10:00:00Z'), opts(NOW));
    await setWeeklyGoal(t.db, 70_000, opts(NOW));
    await getAlcoholDashboard(t.db, opts(NOW));
    expect(await snap()).toEqual(before);
  });

  test('11. ancien suivi alcohol_limit : jamais compté ni modifié par le journal', async () => {
    await t.db.execAsync(`
      INSERT INTO goal_definitions (id, title, kind, unit, weight, status, template_id, sensitive, follow_without_xp, created_at, category_id)
        VALUES ('g_alc', 'Alcool — verres déclarés', 'limit', 'verres', 1, 'active', 'alcohol_limit', 0, 0, '2026-01-01T00:00:00.000Z', 'alcool');
      INSERT INTO goal_versions (id, goal_id, version, tier, target_value, schedule_kind, weekly_target_count, notes, effective_from, effective_to)
        VALUES ('gv_alc', 'g_alc', 1, 'normal', 2, 'daily', NULL, NULL, '2026-01-01', NULL);
      INSERT INTO tracking_events (id, goal_id, local_date, status, value, note, created_at, updated_at)
        VALUES ('te_alc', 'g_alc', '2026-03-11', 'success', 3, NULL, '2026-03-11T09:00:00.000Z', '2026-03-11T09:00:00.000Z');
    `);
    const legacyBefore = await t.db.getAllAsync(`SELECT * FROM tracking_events`);
    await add(NOW, beer(), '2026-03-11T10:00:00Z');
    const dash = await getAlcoholDashboard(t.db, opts(NOW));
    expect(dash.legacyGoalActive).toBe(true);
    expect(dash.todayMg).toBe(9863); // les « 3 verres » historiques ne sont pas réinterprétés en unités standard
    expect(await t.db.getAllAsync(`SELECT * FROM tracking_events`)).toEqual(legacyBefore);
  });

  test('12. migration 012 → 013 : additive, sans perte, idempotente', async () => {
    await t.db.execAsync(`
      DROP TABLE alcohol_events; DROP TABLE alcohol_weekly_goals; DROP TABLE alcohol_start_markers;
      DROP TABLE alcohol_zero_days; DROP TABLE alcohol_corrections; DROP TABLE alcohol_consumptions;
      DELETE FROM schema_migrations WHERE version = 13;
    `);
    await t.db.execAsync(`
      INSERT INTO goal_definitions (id, title, kind, unit, weight, status, template_id, sensitive, follow_without_xp, created_at, category_id)
        VALUES ('g_alc', 'Alcool — verres déclarés', 'limit', 'verres', 1, 'active', 'alcohol_limit', 0, 0, '2026-01-01T00:00:00.000Z', 'alcool');
      INSERT INTO goal_versions (id, goal_id, version, tier, target_value, schedule_kind, weekly_target_count, notes, effective_from, effective_to)
        VALUES ('gv_alc', 'g_alc', 1, 'normal', 2, 'daily', NULL, NULL, '2026-01-01', NULL);
      INSERT INTO tracking_events (id, goal_id, local_date, status, value, note, created_at, updated_at)
        VALUES ('te_alc', 'g_alc', '2026-03-11', 'success', 3, NULL, '2026-03-11T09:00:00.000Z', '2026-03-11T09:00:00.000Z');
      INSERT INTO xp_ledger (id, source_event_id, source_rule_version, xp_amount, reason, idempotency_key, local_date, created_at)
        VALUES ('x1', 'te_alc', '0.2.0', 4, 'test', 'k1', '2026-03-11', '2026-03-11T09:00:00.000Z');
      INSERT INTO wallet_ledger (id, resource, amount, reason, idempotency_key, created_at)
        VALUES ('w1', 'gold', 15, 'quête', 'quest:x:reward', '2026-03-11T09:00:00.000Z');
      INSERT INTO vape_main_sessions (id, status, started_at, created_at, updated_at)
        VALUES ('vms_old', 'active', '2026-03-10T10:00:00.000Z', '2026-03-10T10:00:00.000Z', '2026-03-10T10:00:00.000Z');
    `);
    const dump = async () => ({
      goals: await t.db.getAllAsync(`SELECT * FROM goal_definitions ORDER BY id`),
      versions: await t.db.getAllAsync(`SELECT * FROM goal_versions ORDER BY id`),
      tracking: await t.db.getAllAsync(`SELECT * FROM tracking_events ORDER BY id`),
      xp: await t.db.getAllAsync(`SELECT * FROM xp_ledger ORDER BY id`),
      wallet: await t.db.getAllAsync(`SELECT * FROM wallet_ledger ORDER BY id`),
      vape: await t.db.getAllAsync(`SELECT * FROM vape_main_sessions ORDER BY id`),
      migrations: (await t.db.getAllAsync<{ version: number }>(`SELECT version FROM schema_migrations ORDER BY version`)).filter((r) => r.version <= 12),
    });
    const before = await dump();
    await migrate(t.db);
    await migrate(t.db); // idempotent
    expect(await dump()).toEqual(before);

    const versions = (await t.db.getAllAsync<{ version: number }>(`SELECT version FROM schema_migrations ORDER BY version`)).map((r) => r.version);
    expect(versions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    const names = (await t.db.getAllAsync<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'alcohol_%' ORDER BY name`)).map((r) => r.name);
    expect(names).toEqual([
      'alcohol_consumptions',
      'alcohol_corrections',
      'alcohol_events',
      'alcohol_start_markers',
      'alcohol_weekly_goals',
      'alcohol_zero_days',
    ]);
    const idx = (await t.db.getAllAsync<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_alcohol_%'`)).map((r) => r.name);
    expect(idx).toEqual(expect.arrayContaining(['idx_alcohol_consumptions_date', 'idx_alcohol_events_at', 'idx_alcohol_zero_days_active']));
    // Les nouvelles tables sont utilisables immédiatement après migration
    await add(NOW, beer(), '2026-03-11T10:00:00Z');
    expect((await getAlcoholDashboard(t.db, opts(NOW))).todayMg).toBe(9863);
  });

  test('12. contraintes SQL : un jour « zéro » actif unique ; types et bornes vérifiés par la base', async () => {
    await declareZeroDay(t.db, '2026-03-10', opts(NOW));
    await expect(
      t.db.runAsync(`INSERT INTO alcohol_zero_days (id, local_date, declared_at) VALUES ('dup', '2026-03-10', 'x')`),
    ).rejects.toThrow();
    await expect(
      t.db.runAsync(
        `INSERT INTO alcohol_consumptions (id, drink_type, volume_ml_x10, abv_x10, quantity_x100, alcohol_mg, consumed_at, local_date, status, created_at, updated_at)
         VALUES ('bad', 'beer', 2500, 5000, 100, 1, 'x', '2026-03-10', 'active', 'x', 'x')`,
      ),
    ).rejects.toThrow();
  });

  test('13. export/restauration : toutes les nouvelles tables, corrections et événements inclus', async () => {
    const a = await add('2026-03-10T19:00:00Z', beer('2'), '2026-03-10T19:00:00Z', 'req-a');
    await add(NOW, wine(), '2026-03-11T10:00:00Z');
    await editConsumption(t.db, a.consumption.id, { drink: beer('3'), consumedAt: at('2026-03-10T19:00:00Z') }, opts(NOW));
    const c = await add(NOW, spirit(), '2026-03-11T10:30:00Z');
    await cancelConsumption(t.db, c.consumption.id, opts(NOW));
    await declareZeroDay(t.db, '2026-03-09', opts(NOW));
    await confirmStartMarker(t.db, at('2026-03-11T10:45:00Z'), opts(NOW));
    await setWeeklyGoal(t.db, 70_000, opts(NOW));
    const expected = await getAlcoholDashboard(t.db, opts(NOW));

    const exported = await exportBackupPayload(t.db, '0.2.0');
    const json = JSON.parse(JSON.stringify(exported)) as typeof exported;
    for (const tbl of ['alcohol_consumptions', 'alcohol_corrections', 'alcohol_zero_days', 'alcohol_start_markers', 'alcohol_weekly_goals', 'alcohol_events']) {
      expect((json.manifest.tables as string[]).includes(tbl)).toBe(true);
      expect(json.data[tbl].length).toBeGreaterThan(0);
    }

    const target = await openNodeSqliteDb();
    try {
      // Données préexistantes dans la cible : remplacées (import = remplacement complet)
      await addConsumption(target.db, { drink: beer(), consumedAt: at('2026-03-11T09:00:00Z') }, opts(NOW));
      await declareZeroDay(target.db, '2026-03-08', opts(NOW));
      await importBackupPayload(target.db, json.manifest, json.data);
      const restored = await getAlcoholDashboard(target.db, opts(NOW));
      expect(restored).toEqual(expected);
      for (const tbl of ['alcohol_consumptions', 'alcohol_corrections', 'alcohol_zero_days', 'alcohol_start_markers', 'alcohol_weekly_goals', 'alcohol_events']) {
        expect(await target.db.getAllAsync(`SELECT * FROM ${tbl} ORDER BY id`)).toEqual(
          await t.db.getAllAsync(`SELECT * FROM ${tbl} ORDER BY id`),
        );
      }
      const audit = await getConsumptionAudit(target.db, a.consumption.id);
      expect(audit).toHaveLength(1);
      expect(audit[0].before).toMatchObject({ alcoholMg: 19725 });
    } finally {
      target.close();
    }
  });

  test('13. sauvegarde antérieure (sans tables alcool) : import accepté, journal vide', async () => {
    await add(NOW, beer(), '2026-03-11T10:00:00Z');
    const exported = await exportBackupPayload(t.db, '0.2.0');
    const old = { ...exported.data };
    for (const k of Object.keys(old)) if (k.startsWith('alcohol_')) delete old[k];
    await importBackupPayload(t.db, exported.manifest, old);
    expect(await countRows(t, 'alcohol_consumptions')).toBe(0);
    expect((await getAlcoholDashboard(t.db, opts(NOW))).since).toBeNull();
  });

  test('14. non-régression vape : le journal alcool n\'interfère pas avec le chrono vape', async () => {
    const start = await startVapeMainSession(t.db, at('2026-03-11T08:00:00Z'));
    expect(start.ok).toBe(true);
    const vapeTables = ['vape_main_sessions', 'vape_main_claims', 'vape_events', 'adaptive_challenge_attempts'];
    const before = await Promise.all(vapeTables.map((n) => countRows(t, n)));
    await add(NOW, beer(), '2026-03-11T10:00:00Z');
    await declareZeroDay(t.db, '2026-03-10', opts(NOW));
    expect(await Promise.all(vapeTables.map((n) => countRows(t, n)))).toEqual(before);

    const dash = await getVapeTrackerDashboard(t.db, at('2026-03-11T11:00:00Z'));
    expect(dash.active?.elapsedSec).toBe(3 * 3600);
    expect(await declareVape(t.db, { now: at('2026-03-11T11:00:00Z') })).toMatchObject({ ok: true, durationSec: 3 * 3600 });
    expect((await getAlcoholDashboard(t.db, opts(NOW))).todayMg).toBe(9863);
  });

  test('journées : fuseau et début de journée lus depuis le profil par défaut', async () => {
    await t.db.runAsync(
      `INSERT INTO profiles (id, pseudo, class_id, tone, day_start_hour, timezone, created_at, onboarding_done)
       VALUES ('p1', 'Test', 'rodeur', 'fantasy', 6, 'Europe/Paris', '2026-01-01T00:00:00.000Z', 1)`,
    );
    // 05:30 Paris = avant 6 h → journée précédente
    const r = await addConsumption(t.db, { drink: beer(), consumedAt: at('2026-03-11T04:30:00Z') }, { now: at(NOW) });
    expect(r.ok && r.consumption.localDate).toBe('2026-03-10');
    const dash = await getAlcoholDashboard(t.db, { now: at(NOW) });
    expect(dash).toMatchObject({ dayStartHour: 6, timeZone: 'Europe/Paris', today: '2026-03-11' });
    expect(dash.weekMg).toBe(9863);
    expect(dash.todayMg).toBe(0);
  });
});
