const sql = `
CREATE TABLE IF NOT EXISTS weekly_quest_sets (
  week_start TEXT PRIMARY KEY,
  replacements_used INTEGER NOT NULL DEFAULT 0 CHECK (replacements_used >= 0 AND replacements_used <= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS weekly_quest_offers (
  id TEXT PRIMARY KEY,
  week_start TEXT NOT NULL,
  slot_index INTEGER NOT NULL CHECK (slot_index >= 0 AND slot_index <= 1),
  template_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'offered' CHECK (state IN ('offered', 'accepted', 'replaced', 'expired')),
  instance_id TEXT,
  replaced_by TEXT,
  closed_reason TEXT CHECK (closed_reason IS NULL OR closed_reason IN ('expired', 'abandoned')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_weekly_quest_offers_week ON weekly_quest_offers (week_start, slot_index);
CREATE INDEX IF NOT EXISTS idx_weekly_quest_offers_instance ON weekly_quest_offers (instance_id);

CREATE TABLE IF NOT EXISTS quest_evidence_allocations (
  id TEXT PRIMARY KEY,
  evidence_key TEXT NOT NULL UNIQUE,
  evidence_group TEXT NOT NULL UNIQUE,
  instance_id TEXT NOT NULL,
  source TEXT NOT NULL,
  claimed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_quest_evidence_allocations_instance ON quest_evidence_allocations (instance_id);
`;

export default sql;
