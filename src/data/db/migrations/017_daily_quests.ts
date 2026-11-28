const sql = `
ALTER TABLE divers_day_slots ADD COLUMN slot0_passed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE divers_day_slots ADD COLUMN slot1_passed INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS daily_quest_sets (
  local_date TEXT PRIMARY KEY,
  replacements_used INTEGER NOT NULL DEFAULT 0 CHECK (replacements_used >= 0 AND replacements_used <= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_quest_offers (
  id TEXT PRIMARY KEY,
  local_date TEXT NOT NULL,
  slot_index INTEGER NOT NULL CHECK (slot_index >= 0 AND slot_index <= 2),
  template_id TEXT NOT NULL,
  params_json TEXT,
  state TEXT NOT NULL DEFAULT 'offered' CHECK (state IN ('offered', 'accepted', 'replaced', 'expired')),
  instance_id TEXT,
  replaced_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_daily_quest_offers_date ON daily_quest_offers (local_date, slot_index);
CREATE INDEX IF NOT EXISTS idx_daily_quest_offers_instance ON daily_quest_offers (instance_id);

CREATE TABLE IF NOT EXISTS quest_evidence_claims (
  id TEXT PRIMARY KEY,
  evidence_key TEXT NOT NULL UNIQUE,
  evidence_group TEXT NOT NULL UNIQUE,
  instance_id TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  gold_credited INTEGER NOT NULL DEFAULT 0,
  claimed_at TEXT NOT NULL
);
`;

export default sql;
