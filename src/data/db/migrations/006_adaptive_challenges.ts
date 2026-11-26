const sql = `
CREATE TABLE IF NOT EXISTS adaptive_challenge_state (
  habit_category TEXT PRIMARY KEY,
  tier_index INTEGER NOT NULL DEFAULT 0,
  tier_manual INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS adaptive_challenge_attempts (
  id TEXT PRIMARY KEY,
  habit_category TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('delay_craving', 'breathing', 'interval', 'record')),
  tier_index INTEGER NOT NULL,
  outcome TEXT NOT NULL DEFAULT 'running' CHECK (outcome IN ('running', 'success', 'failure', 'unknown')),
  challenge_session_id TEXT REFERENCES challenge_sessions(id),
  target_duration_sec INTEGER,
  declared_duration_sec INTEGER,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_adaptive_attempt_one_running
  ON adaptive_challenge_attempts (habit_category)
  WHERE outcome = 'running';

CREATE TABLE IF NOT EXISTS adaptive_challenge_records (
  habit_category TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('delay_craving', 'breathing', 'interval', 'record')),
  best_duration_sec INTEGER NOT NULL,
  attempt_id TEXT,
  achieved_at TEXT NOT NULL,
  PRIMARY KEY (habit_category, format)
);
`;

export default sql;