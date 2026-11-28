const sql = `
CREATE TABLE IF NOT EXISTS kingdom_campaign (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  highest_unlocked INTEGER NOT NULL DEFAULT 1 CHECK (highest_unlocked >= 1 AND highest_unlocked <= 10),
  cleared_stages_json TEXT NOT NULL DEFAULT '[]',
  stage_stats_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO kingdom_campaign (id, highest_unlocked, cleared_stages_json, stage_stats_json, updated_at)
VALUES (1, 1, '[]', '{}', '1970-01-01T00:00:00.000Z');

ALTER TABLE kingdom_combat ADD COLUMN combat_mode TEXT NOT NULL DEFAULT 'arena';
ALTER TABLE kingdom_combat ADD COLUMN campaign_stage_id TEXT;
ALTER TABLE kingdom_combat ADD COLUMN enemy_phase INTEGER NOT NULL DEFAULT 0;

UPDATE kingdom_combat SET combat_mode = 'arena' WHERE id = 1;
`;

export default sql;