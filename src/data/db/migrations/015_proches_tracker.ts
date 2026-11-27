const sql = `
CREATE TABLE IF NOT EXISTS proches_contacts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  relation TEXT CHECK (relation IS NULL OR relation IN ('family', 'friend', 'other')),
  note TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_proches_contacts_status ON proches_contacts (status, name);

CREATE TABLE IF NOT EXISTS proches_calls (
  id TEXT PRIMARY KEY,
  client_request_id TEXT UNIQUE,
  contact_id TEXT NOT NULL REFERENCES proches_contacts(id),
  called_at TEXT NOT NULL,
  local_date TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  cancelled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_proches_calls_date ON proches_calls (local_date, status);
CREATE INDEX IF NOT EXISTS idx_proches_calls_contact ON proches_calls (contact_id, status, called_at);

CREATE TABLE IF NOT EXISTS proches_weekly_goals (
  id TEXT PRIMARY KEY,
  effective_from TEXT NOT NULL,
  target_count INTEGER NOT NULL CHECK (target_count >= 1 AND target_count <= 7),
  source TEXT NOT NULL CHECK (source IN ('manual', 'default')),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_proches_weekly_goals_from ON proches_weekly_goals (effective_from);

CREATE TABLE IF NOT EXISTS proches_corrections (
  id TEXT PRIMARY KEY,
  call_id TEXT NOT NULL REFERENCES proches_calls(id),
  kind TEXT NOT NULL CHECK (kind IN ('edit', 'cancel')),
  before_json TEXT NOT NULL,
  after_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_proches_corrections_call ON proches_corrections (call_id, created_at);

CREATE TABLE IF NOT EXISTS proches_events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  call_id TEXT,
  contact_id TEXT,
  local_date TEXT,
  occurred_at TEXT NOT NULL,
  payload_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_proches_events_at ON proches_events (occurred_at);
CREATE INDEX IF NOT EXISTS idx_proches_events_kind ON proches_events (kind, contact_id);
`;

export default sql;