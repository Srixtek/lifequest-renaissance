const sql = `
CREATE TABLE IF NOT EXISTS challenge_sessions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('no_vape', 'no_screen', 'sport')),
  started_utc TEXT NOT NULL,
  ended_utc TEXT,
  target_duration_sec INTEGER,
  state TEXT NOT NULL DEFAULT 'running' CHECK (state IN ('running', 'completed', 'interrupted')),
  duration_sec INTEGER NOT NULL DEFAULT 0,
  user_confirmed INTEGER NOT NULL DEFAULT 0,
  user_confirmed_duration_sec INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_challenge_sessions_one_running_per_type
  ON challenge_sessions (type)
  WHERE state = 'running';
`;

export default sql;