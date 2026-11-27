const sql = `
CREATE TABLE IF NOT EXISTS alcohol_consumptions (
  id TEXT PRIMARY KEY,
  client_request_id TEXT UNIQUE,
  drink_type TEXT NOT NULL CHECK (drink_type IN ('beer', 'wine', 'spirit', 'other')),
  name TEXT,
  volume_ml_x10 INTEGER NOT NULL CHECK (volume_ml_x10 > 0),
  abv_x10 INTEGER NOT NULL CHECK (abv_x10 > 0 AND abv_x10 <= 1000),
  quantity_x100 INTEGER NOT NULL CHECK (quantity_x100 > 0),
  alcohol_mg INTEGER NOT NULL CHECK (alcohol_mg >= 0),
  consumed_at TEXT NOT NULL,
  local_date TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  cancelled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alcohol_consumptions_date ON alcohol_consumptions (local_date, status);
CREATE INDEX IF NOT EXISTS idx_alcohol_consumptions_at ON alcohol_consumptions (consumed_at);

CREATE TABLE IF NOT EXISTS alcohol_corrections (
  id TEXT PRIMARY KEY,
  consumption_id TEXT NOT NULL REFERENCES alcohol_consumptions(id),
  kind TEXT NOT NULL CHECK (kind IN ('edit', 'cancel')),
  before_json TEXT NOT NULL,
  after_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alcohol_corrections_consumption ON alcohol_corrections (consumption_id, created_at);

CREATE TABLE IF NOT EXISTS alcohol_zero_days (
  id TEXT PRIMARY KEY,
  local_date TEXT NOT NULL,
  declared_at TEXT NOT NULL,
  revoked_at TEXT,
  revoke_reason TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_alcohol_zero_days_active
  ON alcohol_zero_days (local_date)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS alcohol_start_markers (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  voided_at TEXT
);

CREATE TABLE IF NOT EXISTS alcohol_weekly_goals (
  id TEXT PRIMARY KEY,
  effective_from TEXT NOT NULL,
  target_mg INTEGER NOT NULL CHECK (target_mg >= 0),
  source TEXT NOT NULL CHECK (source IN ('manual', 'suggestion')),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alcohol_weekly_goals_from ON alcohol_weekly_goals (effective_from);

CREATE TABLE IF NOT EXISTS alcohol_events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  consumption_id TEXT,
  local_date TEXT,
  occurred_at TEXT NOT NULL,
  payload_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_alcohol_events_at ON alcohol_events (occurred_at);
CREATE INDEX IF NOT EXISTS idx_alcohol_events_date ON alcohol_events (local_date);
`;

export default sql;
