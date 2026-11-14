import type { Db } from '../../data/db/client';
import * as rpgRepo from '../../data/db/repositories/rpgRepo';
import { ITEMS } from '../../data/content/items';
import { MAP_NODES } from '../../data/content/map';
import { CAMP_UPGRADE_SHARD_COST } from '../rules/xp';

export async function getAdventureView(db: Db) {
  const adv = await rpgRepo.getAdventure(db);
  const node = MAP_NODES[adv.currentNode] ?? MAP_NODES.camp_gate;
  const equipment = await rpgRepo.listEquipment(db);
  const equippedEffects = new Set<string>();
  for (const slot of equipment) {
    if (!slot.itemId) continue;
    const effect = ITEMS[slot.itemId]?.usefulEffect;
    if (effect) equippedEffects.add(effect);
  }
  const locked = !!(node.requiresItemEffect && !equippedEffects.has(node.requiresItemEffect));
  return { ...adv, node, locked, equippedEffects: [...equippedEffects] };
}

export async function chooseAdventure(db: Db, choiceId: string): Promise<{ ok: boolean; message: string }> {
  const view = await getAdventureView(db);
  if (view.locked) {
    return { ok: false, message: 'Il te faut la lanterne équipée pour voir clairement.' };
  }
  const choice = view.node.choices.find((c) => c.id === choiceId);
  if (!choice) return { ok: false, message: 'Choix invalide' };

  const next = MAP_NODES[choice.to];
  if (!next) return { ok: false, message: 'Destination inconnue' };

  if (next.requiresItemEffect && !view.equippedEffects.includes(next.requiresItemEffect)) {
    // Allow moving there but content stays veiled — still move.
  }

  const visited = view.visited.includes(choice.to) ? view.visited : [...view.visited, choice.to];
  const choiceLog = [...view.choiceLog, { at: new Date().toISOString(), from: view.currentNode, choiceId }];

  await db.withTransactionAsync(async () => {
    await rpgRepo.setAdventure(db, choice.to, visited, choiceLog);
    if (choice.grantItem) await rpgRepo.grantItem(db, choice.grantItem);
    if (choice.grantShards) {
      await rpgRepo.addShards(
        db,
        choice.grantShards,
        `aventure:${choiceId}`,
        `adv-shards:${view.currentNode}:${choiceId}:${choice.grantItem ?? 'x'}`,
      );
    }
    if (choice.setFlag) await rpgRepo.setFlag(db, choice.setFlag, '1');
  });

  return { ok: true, message: next.title };
}

export async function equipLantern(db: Db): Promise<{ ok: boolean; message: string }> {
  const inv = await rpgRepo.listInventory(db);
  if (!inv.some((i) => i.itemId === 'lantern')) {
    return { ok: false, message: 'Pas de lanterne dans l\'inventaire.' };
  }
  await rpgRepo.equipItem(db, 'hand', 'lantern');
  return { ok: true, message: 'Lanterne équipée.' };
}

export async function upgradeCamp(db: Db): Promise<{ ok: boolean; message: string }> {
  const c = await rpgRepo.getCharacter(db);
  const cost = CAMP_UPGRADE_SHARD_COST * c.campLevel;
  const spent = await rpgRepo.spendShards(db, cost, `camp upgrade to ${c.campLevel + 1}`, `camp-up:${c.campLevel + 1}`);
  if (!spent) return { ok: false, message: `Il faut ${cost} éclats.` };
  await rpgRepo.setCampLevel(db, c.campLevel + 1);
  return { ok: true, message: `Camp niveau ${c.campLevel + 1}.` };
}
