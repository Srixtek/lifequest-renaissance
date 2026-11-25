const sql = `
ALTER TABLE quest_instances ADD COLUMN accepted_at TEXT;
ALTER TABLE quest_instances ADD COLUMN claimed_at TEXT;
ALTER TABLE quest_instances ADD COLUMN abandoned_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_quest_instances_quest_id
  ON quest_instances (quest_id);

CREATE INDEX IF NOT EXISTS idx_wallet_ledger_resource
  ON wallet_ledger (resource);
`;

export default sql;
