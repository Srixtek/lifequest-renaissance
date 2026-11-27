const sql = `
CREATE TABLE IF NOT EXISTS vape_main_sessions (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'voided')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_sec INTEGER,
  end_reason TEXT CHECK (end_reason IS NULL OR end_reason IN ('vaped')),
  original_ended_at TEXT,
  void_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vape_main_one_active
  ON vape_main_sessions (status)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_vape_main_started ON vape_main_sessions (started_at);

CREATE TABLE IF NOT EXISTS vape_main_claims (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('step', 'record')),
  session_id TEXT NOT NULL REFERENCES vape_main_sessions(id),
  step INTEGER NOT NULL,
  requested_gold INTEGER NOT NULL,
  granted_gold INTEGER NOT NULL,
  ledger_key TEXT NOT NULL UNIQUE,
  claimed_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vape_claims_step
  ON vape_main_claims (session_id, step)
  WHERE kind = 'step';

CREATE UNIQUE INDEX IF NOT EXISTS idx_vape_claims_record
  ON vape_main_claims (step)
  WHERE kind = 'record';

CREATE TABLE IF NOT EXISTS vape_events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  session_id TEXT,
  attempt_id TEXT,
  occurred_at TEXT NOT NULL,
  payload_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_vape_events_at ON vape_events (occurred_at);
`;

export default sql;
