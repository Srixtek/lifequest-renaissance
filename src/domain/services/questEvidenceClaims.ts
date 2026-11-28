import type { Db } from '../../data/db/client';
import type { SqlRunner } from '../../data/db/sqlRunner';

type Conn = Db | SqlRunner;

/**
 * Attribution durable des preuves aux récompenses de missions (table `quest_evidence_claims`).
 * Une ligne n'existe qu'une fois l'or crédité (ou le plafond atteint) : la preuve est alors consommée pour toujours.
 * Les services Sport / Proches / Divers refusent d'annuler ou de réécrire une preuve consommée.
 */
export async function isEvidencePaid(db: Conn, evidenceKey: string): Promise<boolean> {
  const r = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) AS c FROM quest_evidence_claims WHERE evidence_key = ?`,
    evidenceKey,
  );
  return Number(r?.c ?? 0) > 0;
}

export async function isEvidenceGroupPaid(db: Conn, evidenceGroup: string): Promise<boolean> {
  const r = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) AS c FROM quest_evidence_claims WHERE evidence_group = ?`,
    evidenceGroup,
  );
  return Number(r?.c ?? 0) > 0;
}

export async function insertEvidenceClaim(
  db: Conn,
  row: {
    id: string;
    evidenceKey: string;
    evidenceGroup: string;
    instanceId: string;
    source: string;
    goldCredited: number;
    claimedAt: string;
  },
): Promise<void> {
  await db.runAsync(
    `INSERT INTO quest_evidence_claims (id, evidence_key, evidence_group, instance_id, source, gold_credited, claimed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    row.id,
    row.evidenceKey,
    row.evidenceGroup,
    row.instanceId,
    row.source,
    row.goldCredited,
    row.claimedAt,
  );
}
