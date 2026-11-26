import { RENEWABLE_BY_ID } from '../data/content/renewableQuestTemplates';
import * as challengeSessionRepo from '../data/db/repositories/challengeSessionRepo';
import * as renewableQuestRepo from '../data/db/repositories/renewableQuestRepo';
import { createId } from '../utils/id';
import { completeSportChallengeOnConn, startChallengeSessionOnConn } from '../domain/services/challengeService';
import {
  abandonRenewableQuest,
  acceptRenewableQuest,
  claimRenewableQuest,
  failRenewableTimer,
  getRenewableQuestBoard,
  partialStopRenewableTimer,
  startRenewableTimer,
  succeedRenewableTimer,
} from '../domain/services/renewableQuestService';
import { evaluateRenewableProof, renewableProofSatisfied } from '../domain/services/renewableQuestEvidence';
import { buildWhatToDoNow } from '../domain/services/whatToDoNowService';
import { nodeSqliteAvailable, openNodeSqliteDb, type TestDb } from './helpers/nodeSqliteDb';

const HAS_SQLITE = nodeSqliteAvailable();
const suite = HAS_SQLITE ? describe : describe.skip;

async function seedOffer(t: TestDb, templateId: string): Promise<string> {
  const tmpl = RENEWABLE_BY_ID[templateId];
  const id = createId('rnw');
  const now = new Date().toISOString();
  await renewableQuestRepo.insertOffered(t.db, id, tmpl.id, tmpl.category, tmpl.rewardGold, now);
  return id;
}

suite('008A-R — fiabilisation boucle jouable', () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await openNodeSqliteDb();
  });
  afterEach(() => t.close());

  test('sport inline : start → succès sans transaction imbriquée', async () => {
    const inst = await seedOffer(t, 'rnw_sport_quick');
    expect((await acceptRenewableQuest(t.db, inst)).ok).toBe(true);
    const start = await startRenewableTimer(t.db, inst);
    expect(start.ok).toBe(true);
    const row = await renewableQuestRepo.getInstance(t.db, inst);
    expect(row?.challengeSessionId).toBeTruthy();
    const session = await challengeSessionRepo.getById(t.db, row!.challengeSessionId!);
    expect(session?.state).toBe('running');
    const past = new Date(Date.now() - 700_000).toISOString();
    await t.db.runAsync(`UPDATE challenge_sessions SET started_utc = ? WHERE id = ?`, past, session!.id);
    const ok = await succeedRenewableTimer(t.db, inst);
    expect(ok.ok).toBe(true);
    const after = await renewableQuestRepo.getInstance(t.db, inst);
    expect(after?.status).toBe('ready');
  });

  test('sans écran inline : échec puis renouvellement offre', async () => {
    const inst = await seedOffer(t, 'rnw_screenless_short');
    await acceptRenewableQuest(t.db, inst);
    await startRenewableTimer(t.db, inst);
    const fail = await failRenewableTimer(t.db, inst);
    expect(fail.ok).toBe(true);
    const row = await renewableQuestRepo.getInstance(t.db, inst);
    expect(row?.status).toBe('failed');
    const claim = await claimRenewableQuest(t.db, inst);
    expect(claim.ok).toBe(false);
  });

  test('abandon avec chrono actif', async () => {
    const inst = await seedOffer(t, 'rnw_sport_quick');
    await acceptRenewableQuest(t.db, inst);
    await startRenewableTimer(t.db, inst);
    const row = await renewableQuestRepo.getInstance(t.db, inst);
    const before = await challengeSessionRepo.getById(t.db, row!.challengeSessionId!);
    expect(before?.state).toBe('running');
    const r = await abandonRenewableQuest(t.db, inst);
    expect(r.ok).toBe(true);
    const after = await challengeSessionRepo.getById(t.db, row!.challengeSessionId!);
    expect(after?.state).toBe('interrupted');
  });

  test('arrêt partiel sport : pas de ready', async () => {
    const inst = await seedOffer(t, 'rnw_sport_quick');
    await acceptRenewableQuest(t.db, inst);
    await startRenewableTimer(t.db, inst);
    const partial = await partialStopRenewableTimer(t.db, inst);
    expect(partial.ok).toBe(true);
    const row = await renewableQuestRepo.getInstance(t.db, inst);
    expect(row?.status).toBe('active');
    const tmpl = RENEWABLE_BY_ID[row!.templateId];
    const proof = await evaluateRenewableProof(t.db, tmpl, row!.acceptedAt!, row!.progressJson, row!.challengeSessionId);
    expect(proof.current).toBe(0);
  });

  test('inline_challenge : session courte ne valide pas une quête longue', async () => {
    const inst = await seedOffer(t, 'rnw_sport_20');
    const acceptedAt = new Date().toISOString();
    await acceptRenewableQuest(t.db, inst);
    const short = await startChallengeSessionOnConn(t.db, 'sport', 300);
    expect(short.ok).toBe(true);
    await completeSportChallengeOnConn(t.db, short.session.id, 5);
    const tmpl = RENEWABLE_BY_ID['rnw_sport_20'];
    const proof = await evaluateRenewableProof(t.db, tmpl, acceptedAt, null, null);
    expect(proof.current).toBe(0);
  });

  test('inline_challenge : preuve liée à la session instance uniquement', async () => {
    const inst = await seedOffer(t, 'rnw_sport_20');
    await acceptRenewableQuest(t.db, inst);
    await startRenewableTimer(t.db, inst);
    const row = await renewableQuestRepo.getInstance(t.db, inst);
    const otherId = createId('chlg');
    const now = new Date().toISOString();
    await t.db.runAsync(
      `INSERT INTO challenge_sessions
       (id, type, started_utc, ended_utc, target_duration_sec, state, duration_sec, user_confirmed, user_confirmed_duration_sec, created_at, updated_at)
       VALUES (?, 'sport', ?, ?, 1200, 'completed', 1200, 1, 1200, ?, ?)`,
      otherId,
      now,
      now,
      now,
      now,
    );
    const tmpl = RENEWABLE_BY_ID[row!.templateId];
    const proof = await evaluateRenewableProof(t.db, tmpl, row!.acceptedAt!, row!.progressJson, row!.challengeSessionId);
    expect(renewableProofSatisfied(tmpl, proof, 'active')).toBe(false);
  });

  test('recommandées excluent les quêtes actives (pas de doublon)', async () => {
    const inst = await seedOffer(t, 'rnw_breathe_3');
    await acceptRenewableQuest(t.db, inst);
    const board = await getRenewableQuestBoard(t.db);
    const inRecommended = board.recommended.some((e) => e.instanceId === inst && e.state === 'active');
    expect(inRecommended).toBe(false);
    const inProgress = board.entries.some((e) => e.instanceId === inst && e.state === 'active');
    expect(inProgress).toBe(true);
  });

  test('pas deux offres du même gabarit', async () => {
    await getRenewableQuestBoard(t.db);
    const tmpl = RENEWABLE_BY_ID['rnw_breathe_3'];
    const now = new Date().toISOString();
    await renewableQuestRepo.insertOffered(t.db, createId('rnw'), tmpl.id, tmpl.category, tmpl.rewardGold, now);
    await renewableQuestRepo.insertOffered(t.db, createId('rnw'), tmpl.id, tmpl.category, tmpl.rewardGold, now);
    const board = await getRenewableQuestBoard(t.db);
    const offers = board.entries.filter((e) => e.template.id === tmpl.id && e.state === 'offered');
    expect(offers.length).toBeLessThanOrEqual(1);
  });

  test('Accueil : pas de chrono sans timerRunning', async () => {
    const inst = await seedOffer(t, 'rnw_breathe_3');
    await acceptRenewableQuest(t.db, inst);
    const w = await buildWhatToDoNow(t.db, {
      activeGoals: [],
      todayTracking: {},
      vapeDelayMin: null,
      vapeRunning: false,
    });
    expect(w.kind).not.toBe('chrono');
    await startRenewableTimer(t.db, inst);
    const w2 = await buildWhatToDoNow(t.db, {
      activeGoals: [],
      todayTracking: {},
      vapeDelayMin: null,
      vapeRunning: false,
    });
    expect(w2.kind).toBe('chrono');
    expect(w2.route.kind).toBe('adventure');
    if (w2.route.kind === 'adventure') {
      expect(w2.route.tab).toBe('quests');
      expect(w2.route.instanceId).toBe(inst);
    }
  });

  test('combat : une victoire consommée par instance', async () => {
    const inst = await seedOffer(t, 'rnw_beat_thorn');
    const acceptedAt = new Date().toISOString();
    await acceptRenewableQuest(t.db, inst);
    const victoryId = createId('cbt');
    await t.db.runAsync(
      `INSERT INTO combat_victory_log (id, enemy_id, outcome, fought_at) VALUES (?, 'thorn_guardian', 'victory', ?)`,
      victoryId,
      new Date().toISOString(),
    );
    const inst2 = await seedOffer(t, 'rnw_beat_thorn');
    await acceptRenewableQuest(t.db, inst2);
    const tmpl = RENEWABLE_BY_ID['rnw_beat_thorn'];
    const p1 = await evaluateRenewableProof(t.db, tmpl, acceptedAt, null, null);
    expect(p1.current).toBe(1);
    await t.db.runAsync(
      `UPDATE renewable_quest_instances SET progress_json = ? WHERE id = ?`,
      JSON.stringify({ proofCombatVictoryId: victoryId }),
      inst,
    );
    const p2 = await evaluateRenewableProof(
      t.db,
      tmpl,
      (await renewableQuestRepo.getInstance(t.db, inst2))!.acceptedAt!,
      null,
      null,
    );
    expect(p2.current).toBe(0);
  });

  test('sans écran : win via succès carte', async () => {
    const inst = await seedOffer(t, 'rnw_screenless_short');
    await acceptRenewableQuest(t.db, inst);
    await startRenewableTimer(t.db, inst);
    const row = await renewableQuestRepo.getInstance(t.db, inst);
    const past = new Date(Date.now() - 1_000_000).toISOString();
    await t.db.runAsync(`UPDATE challenge_sessions SET started_utc = ? WHERE id = ?`, past, row!.challengeSessionId!);
    const ok = await succeedRenewableTimer(t.db, inst);
    expect(ok.ok).toBe(true);
    expect((await renewableQuestRepo.getInstance(t.db, inst))?.status).toBe('ready');
  });

  test('sport fail ferme la session', async () => {
    const inst = await seedOffer(t, 'rnw_sport_quick');
    await acceptRenewableQuest(t.db, inst);
    await startRenewableTimer(t.db, inst);
    const row = await renewableQuestRepo.getInstance(t.db, inst);
    await failRenewableTimer(t.db, inst);
    const session = await challengeSessionRepo.getById(t.db, row!.challengeSessionId!);
    expect(session?.state).toBe('interrupted');
  });
});