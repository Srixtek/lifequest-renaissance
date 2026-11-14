import type { Db } from '../client';
import type { CharacterProgress, EquipmentSlot, InventoryItem } from '../../../domain/models/types';

export async function getCharacter(db: Db): Promise<CharacterProgress> {
  const r = await db.getFirstAsync<any>('SELECT * FROM character_progress WHERE id = 1');
  return {
    level: r.level,
    totalXp: r.total_xp,
    shards: r.shards,
    campLevel: r.camp_level,
    storyFlagsJson: r.story_flags_json,
  };
}

export async function addShards(db: Db, amount: number, reason: string, idempotencyKey: string): Promise<boolean> {
  try {
    await db.runAsync(
      `INSERT INTO wallet_ledger (id, resource, amount, reason, idempotency_key, created_at)
       VALUES (?, 'shards', ?, ?, ?, ?)`,
      `wal_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      amount,
      reason,
      idempotencyKey,
      new Date().toISOString(),
    );
    await db.runAsync('UPDATE character_progress SET shards = shards + ? WHERE id = 1', amount);
    return true;
  } catch (err: any) {
    if (String(err?.message ?? err).toLowerCase().includes('unique')) return false;
    throw err;
  }
}

export async function spendShards(db: Db, amount: number, reason: string, idempotencyKey: string): Promise<boolean> {
  const c = await getCharacter(db);
  if (c.shards < amount) return false;
  return addShards(db, -amount, reason, idempotencyKey);
}

export async function setCampLevel(db: Db, level: number): Promise<void> {
  await db.runAsync('UPDATE character_progress SET camp_level = ? WHERE id = 1', level);
}

export async function listInventory(db: Db): Promise<InventoryItem[]> {
  const rows = await db.getAllAsync<any>('SELECT * FROM inventory_items ORDER BY acquired_at');
  return rows.map((r) => ({
    id: r.id,
    itemId: r.item_id,
    quantity: r.quantity,
    acquiredAt: r.acquired_at,
  }));
}

export async function grantItem(db: Db, itemId: string): Promise<void> {
  const existing = await db.getFirstAsync<any>('SELECT * FROM inventory_items WHERE item_id = ?', itemId);
  if (existing) {
    await db.runAsync('UPDATE inventory_items SET quantity = quantity + 1 WHERE item_id = ?', itemId);
  } else {
    await db.runAsync(
      `INSERT INTO inventory_items (id, item_id, quantity, acquired_at) VALUES (?, ?, 1, ?)`,
      `inv_${itemId}`,
      itemId,
      new Date().toISOString(),
    );
  }
}

export async function listEquipment(db: Db): Promise<EquipmentSlot[]> {
  const rows = await db.getAllAsync<any>('SELECT * FROM equipment_slots');
  return rows.map((r) => ({ slot: r.slot, itemId: r.item_id }));
}

export async function equipItem(db: Db, slot: string, itemId: string | null): Promise<void> {
  await db.runAsync('UPDATE equipment_slots SET item_id = ? WHERE slot = ?', itemId, slot);
}

export async function getAdventure(db: Db): Promise<{ currentNode: string; visited: string[]; choiceLog: any[] }> {
  const r = await db.getFirstAsync<any>('SELECT * FROM adventure_state WHERE id = 1');
  return {
    currentNode: r.current_node,
    visited: JSON.parse(r.visited_json || '[]'),
    choiceLog: JSON.parse(r.choice_log_json || '[]'),
  };
}

export async function setAdventure(
  db: Db,
  currentNode: string,
  visited: string[],
  choiceLog: any[],
): Promise<void> {
  await db.runAsync(
    `UPDATE adventure_state SET current_node = ?, visited_json = ?, choice_log_json = ? WHERE id = 1`,
    currentNode,
    JSON.stringify(visited),
    JSON.stringify(choiceLog),
  );
}

export async function getFlag(db: Db, key: string): Promise<string | null> {
  const r = await db.getFirstAsync<{ value: string }>('SELECT value FROM story_flags WHERE key = ?', key);
  return r?.value ?? null;
}

export async function setFlag(db: Db, key: string, value: string): Promise<void> {
  await db.runAsync(
    `INSERT INTO story_flags (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    key,
    value,
  );
}
