const sql = `
CREATE TABLE IF NOT EXISTS renewable_quest_instances (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('habitudes', 'royaume', 'exploits')),
  status TEXT NOT NULL DEFAULT 'offered'
    CHECK (status IN ('offered', 'active', 'ready', 'claimed', 'failed')),
  accepted_at TEXT,
  claimed_at TEXT,
  failed_at TEXT,
  challenge_session_id TEXT,
  progress_json TEXT,
  reward_gold INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_renewable_instances_status ON renewable_quest_instances (status);
CREATE INDEX IF NOT EXISTS idx_renewable_instances_category ON renewable_quest_instances (category);
CREATE INDEX IF NOT EXISTS idx_renewable_instances_template ON renewable_quest_instances (template_id);

CREATE TABLE IF NOT EXISTS renewable_quest_history (
  id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  category TEXT NOT NULL,
  completed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_renewable_history_template ON renewable_quest_history (template_id, completed_at);

CREATE TABLE IF NOT EXISTS combat_victory_log (
  id TEXT PRIMARY KEY,
  enemy_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('victory', 'defeat')),
  fought_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_combat_victory_log_at ON combat_victory_log (fought_at);
`;

export default sql;