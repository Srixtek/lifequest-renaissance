const sql = `
CREATE TABLE IF NOT EXISTS daily_reward_days (
  local_date TEXT PRIMARY KEY,
  rule_version TEXT NOT NULL,
  snapshot_at TEXT NOT NULL,
  legacy INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS daily_reward_goals (
  local_date TEXT NOT NULL,
  goal_id TEXT NOT NULL,
  weight REAL NOT NULL,
  potential_centi INTEGER NOT NULL,
  credited_centi INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (local_date, goal_id),
  FOREIGN KEY (local_date) REFERENCES daily_reward_days(local_date) ON DELETE CASCADE,
  FOREIGN KEY (goal_id) REFERENCES goal_definitions(id)
);

CREATE INDEX IF NOT EXISTS idx_daily_reward_goals_date ON daily_reward_goals(local_date);
`;
export default sql;