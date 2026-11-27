/** Activités fixes du journal Sport (réinsérées sans écraser si une sauvegarde ancienne les a vidées). */
export const SPORT_ACTIVITY_SEED_SQL = `
INSERT OR IGNORE INTO sport_activities (id, label, kind, sort_order) VALUES
  ('pushups', 'Pompes', 'reps', 1),
  ('walking', 'Marche', 'distance_time', 2),
  ('running', 'Course', 'distance_time', 3),
  ('free', 'Séance libre', 'free', 4);
`;

const sql = `
CREATE TABLE IF NOT EXISTS sport_activities (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('reps', 'distance_time', 'free')),
  sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sport_goals (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES sport_activities(id),
  metric TEXT NOT NULL CHECK (metric IN ('reps', 'duration_sec', 'distance_m')),
  target_value INTEGER CHECK (target_value IS NULL OR target_value > 0),
  effective_from TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('manual', 'suggestion', 'habit')),
  reason TEXT,
  legacy_goal_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sport_goals_activity ON sport_goals (activity_id, created_at);

CREATE TABLE IF NOT EXISTS sport_sessions (
  id TEXT PRIMARY KEY,
  client_request_id TEXT UNIQUE,
  activity_id TEXT NOT NULL REFERENCES sport_activities(id),
  discipline_name TEXT,
  performed_at TEXT NOT NULL,
  local_date TEXT NOT NULL,
  reps INTEGER CHECK (reps IS NULL OR reps >= 0),
  duration_sec INTEGER CHECK (duration_sec IS NULL OR duration_sec >= 0),
  distance_m INTEGER CHECK (distance_m IS NULL OR distance_m >= 0),
  outcome TEXT NOT NULL DEFAULT 'free' CHECK (outcome IN ('free', 'achieved', 'failed')),
  goal_id TEXT REFERENCES sport_goals(id),
  goal_metric TEXT CHECK (goal_metric IS NULL OR goal_metric IN ('reps', 'duration_sec', 'distance_m')),
  goal_target INTEGER CHECK (goal_target IS NULL OR goal_target > 0),
  note TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  cancelled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (reps IS NOT NULL OR duration_sec IS NOT NULL OR distance_m IS NOT NULL),
  CHECK (
    (outcome = 'free' AND goal_id IS NULL)
    OR (outcome IN ('achieved', 'failed') AND goal_id IS NOT NULL AND goal_metric IS NOT NULL AND goal_target IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_sport_sessions_date ON sport_sessions (local_date, status);
CREATE INDEX IF NOT EXISTS idx_sport_sessions_activity ON sport_sessions (activity_id, status, performed_at);

CREATE TABLE IF NOT EXISTS sport_corrections (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sport_sessions(id),
  kind TEXT NOT NULL CHECK (kind IN ('edit', 'cancel')),
  before_json TEXT NOT NULL,
  after_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sport_corrections_session ON sport_corrections (session_id, created_at);

CREATE TABLE IF NOT EXISTS sport_events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  session_id TEXT,
  activity_id TEXT,
  local_date TEXT,
  occurred_at TEXT NOT NULL,
  payload_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_sport_events_at ON sport_events (occurred_at);
CREATE INDEX IF NOT EXISTS idx_sport_events_kind ON sport_events (kind, activity_id);
${SPORT_ACTIVITY_SEED_SQL}
`;

export default sql;
