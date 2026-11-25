import type { Db } from '../../data/db/client';
import type { SqlRunner } from '../../data/db/sqlRunner';
import * as questRepo from '../../data/db/repositories/questRepo';
import * as rpgRepo from '../../data/db/repositories/rpgRepo';
import { MAX_ACCEPTED_QUESTS, QUESTS, QUEST_BY_ID, type QuestDef } from '../../data/content/quests';
import { createId } from '../../utils/id';
import { evaluateQuestProof, type QuestProgress } from './questEvidence';

type Conn = Db | SqlRunner;

export type QuestBoardState = 'available' | 'accepted' | 'ready' | 'claimed';

export interface QuestBoardEntry {
  def: QuestDef;
  state: QuestBoardState;
  progress: QuestProgress;
  acceptedAt: string | null;
  claimedAt: string | null;
}

export interface QuestBoard {
  entries: QuestBoardEntry[];
  acceptedCount: number;
  maxAccepted: number;
  goldBalance: number;
}

export type QuestActionCode =
  | 'unknown_quest'
  | 'already_accepted'
  | 'already_claimed'
  | 'max_accepted'
  | 'not_accepted'
  | 'not_ready';

export type QuestActionResult =
  | { ok: true; message: string }
  | { ok: false; code: QuestActionCode; message: string };

export type QuestClaimResult =
  | { ok: true; message: string; gold: number; balance: number; alreadyHadLedgerEntry: boolean }
  | { ok: false; code: QuestActionCode; message: string };

export const questRewardKey = (questId: string) => `quest:${questId}:reward`;

const MESSAGES: Record<QuestActionCode, string> = {
  unknown_quest: 'Cette quête n\'existe pas.',
  already_accepted: 'Cette quête est déjà dans ton carnet.',
  already_claimed: 'Récompense déjà réclamée pour cette quête.',
  max_accepted: `Ton carnet est plein (${MAX_ACCEPTED_QUESTS} quêtes). Termine ou abandonne une quête pour en accepter une autre.`,
  not_accepted: 'Cette quête n\'est pas dans ton carnet.',
  not_ready: 'Pas encore : l\'objectif n\'est pas atteint. Rien ne presse.',
};

function fail(code: QuestActionCode): { ok: false; code: QuestActionCode; message: string } {
  return { ok: false, code, message: MESSAGES[code] };
}

export async function getQuestBoard(db: Conn): Promise<QuestBoard> {
  const rows = new Map((await questRepo.listRows(db)).map((r) => [r.questId, r]));
  const entries: QuestBoardEntry[] = [];
  let acceptedCount = 0;
  for (const def of QUESTS) {
    const row = rows.get(def.id);
    if (row?.status === 'claimed') {
      entries.push({
        def,
        state: 'claimed',
        progress: { current: 1, target: 1, label: 'Objectif accompli' },
        acceptedAt: row.acceptedAt,
        claimedAt: row.claimedAt,
      });
    } else if (row?.status === 'accepted' && row.acceptedAt) {
      acceptedCount += 1;
      const progress = await evaluateQuestProof(db, def, row.acceptedAt);
      entries.push({
        def,
        state: progress.current >= progress.target ? 'ready' : 'accepted',
        progress,
        acceptedAt: row.acceptedAt,
        claimedAt: null,
      });
    } else {
      entries.push({
        def,
        state: 'available',
        progress: { current: 0, target: 1, label: 'Pas encore commencée' },
        acceptedAt: null,
        claimedAt: null,
      });
    }
  }
  return { entries, acceptedCount, maxAccepted: MAX_ACCEPTED_QUESTS, goldBalance: await rpgRepo.getGoldBalance(db) };
}

export async function acceptQuest(db: Db, questId: string, now: Date = new Date()): Promise<QuestActionResult> {
  const def = QUEST_BY_ID[questId];
  if (!def) return fail('unknown_quest');
  let result: QuestActionResult = fail('unknown_quest');
  await db.withExclusiveTransactionAsync(async (tx) => {
    const row = await questRepo.getRow(tx, questId);
    if (row?.status === 'claimed') {
      result = fail('already_claimed');
      return;
    }
    if (row?.status === 'accepted') {
      result = fail('already_accepted');
      return;
    }
    if ((await questRepo.countAccepted(tx)) >= MAX_ACCEPTED_QUESTS) {
      result = fail('max_accepted');
      return;
    }
    const acceptedAt = now.toISOString();
    if (row) {
      if (!(await questRepo.reacceptAbandoned(tx, questId, acceptedAt))) {
        result = fail('already_accepted');
        return;
      }
    } else {
      await questRepo.insertAccepted(tx, createId('qst'), questId, acceptedAt);
    }
    result = { ok: true, message: `Quête « ${def.title} » ajoutée à ton carnet.` };
  });
  return result;
}

/** Abandon : retire la quête du carnet sans toucher au ledger. Une quête déjà réclamée ne peut pas être abandonnée. */
export async function abandonQuest(db: Db, questId: string, now: Date = new Date()): Promise<QuestActionResult> {
  const def = QUEST_BY_ID[questId];
  if (!def) return fail('unknown_quest');
  let result: QuestActionResult = fail('not_accepted');
  await db.withExclusiveTransactionAsync(async (tx) => {
    const row = await questRepo.getRow(tx, questId);
    if (row?.status === 'claimed') {
      result = fail('already_claimed');
      return;
    }
    if (row?.status !== 'accepted') {
      result = fail('not_accepted');
      return;
    }
    await questRepo.markAbandoned(tx, questId, now.toISOString());
    result = { ok: true, message: `Quête « ${def.title} » mise de côté. Tu pourras la reprendre quand tu voudras.` };
  });
  return result;
}

/**
 * Réclamation atomique (une seule transaction exclusive, pas de transaction imbriquée) :
 * relecture de l'état, preuve revérifiée, or en ledger (clé unique par quête) + quête terminée.
 * Toute erreur d'écriture annule l'ensemble : la quête reste « acceptée ».
 */
export async function claimQuest(db: Db, questId: string, now: Date = new Date()): Promise<QuestClaimResult> {
  const def = QUEST_BY_ID[questId];
  if (!def) return fail('unknown_quest');
  let result: QuestClaimResult = fail('not_accepted');
  await db.withExclusiveTransactionAsync(async (tx) => {
    const row = await questRepo.getRow(tx, questId);
    if (row?.status === 'claimed') {
      result = fail('already_claimed');
      return;
    }
    if (row?.status !== 'accepted' || !row.acceptedAt) {
      result = fail('not_accepted');
      return;
    }
    const progress = await evaluateQuestProof(tx, def, row.acceptedAt);
    if (progress.current < progress.target) {
      result = fail('not_ready');
      return;
    }
    const at = now.toISOString();
    const credit = await rpgRepo.addGold(
      tx,
      def.rewardGold,
      `Quête « ${def.title} »`,
      questRewardKey(questId),
      at,
    );
    const done = await questRepo.markClaimed(tx, questId, at, JSON.stringify({ rewardGold: def.rewardGold }));
    if (!done) throw new Error('Quête non réclamable (état modifié)');
    const balance = await rpgRepo.getGoldBalance(tx);
    result = {
      ok: true,
      message:
        credit === 'inserted'
          ? `Récompense reçue : +${def.rewardGold} or. Bravo !`
          : 'Quête terminée (l\'or de cette quête était déjà au registre).',
      gold: credit === 'inserted' ? def.rewardGold : 0,
      balance,
      alreadyHadLedgerEntry: credit === 'duplicate',
    };
  });
  return result;
}
