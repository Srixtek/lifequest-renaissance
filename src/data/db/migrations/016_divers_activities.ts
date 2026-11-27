const sql = `
CREATE TABLE IF NOT EXISTS divers_day_slots (
  local_date TEXT PRIMARY KEY,
  slot0_activity_id TEXT NOT NULL,
  slot1_activity_id TEXT NOT NULL,
  replacements_used INTEGER NOT NULL DEFAULT 0 CHECK (replacements_used >= 0 AND replacements_used <= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS divers_completions (
  id TEXT PRIMARY KEY,
  client_request_id TEXT UNIQUE,
  activity_id TEXT NOT NULL,
  confirmed_at TEXT NOT NULL,
  local_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  cancelled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_divers_completions_date ON divers_completions (local_date, status);
CREATE INDEX IF NOT EXISTS idx_divers_completions_activity ON divers_completions (activity_id, status, confirmed_at);

CREATE TABLE IF NOT EXISTS divers_events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  activity_id TEXT,
  slot_index INTEGER,
  local_date TEXT,
  completion_id TEXT,
  occurred_at TEXT NOT NULL,
  payload_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_divers_events_date ON divers_events (local_date, kind);
CREATE INDEX IF NOT EXISTS idx_divers_events_at ON divers_events (occurred_at);
`;

export default sql;