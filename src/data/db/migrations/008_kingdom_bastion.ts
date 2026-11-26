const sql = `
CREATE TABLE IF NOT EXISTS kingdom_buildings (
  building_id TEXT PRIMARY KEY,
  level INTEGER NOT NULL DEFAULT 0 CHECK (level >= 0 AND level <= 2),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kingdom_combat (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  active INTEGER NOT NULL DEFAULT 0,
  hero_hp INTEGER NOT NULL DEFAULT 0,
  hero_hp_max INTEGER NOT NULL DEFAULT 0,
  enemy_hp INTEGER NOT NULL DEFAULT 0,
  enemy_hp_max INTEGER NOT NULL DEFAULT 0,
  turn_number INTEGER NOT NULL DEFAULT 0,
  enemy_intent TEXT NOT NULL DEFAULT 'normal' CHECK (enemy_intent IN ('normal', 'power')),
  hero_guarding INTEGER NOT NULL DEFAULT 0,
  skill_cooldown INTEGER NOT NULL DEFAULT 0,
  outcome TEXT CHECK (outcome IS NULL OR outcome IN ('victory', 'defeat')),
  log_json TEXT NOT NULL DEFAULT '[]',
  first_win_rewarded INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO kingdom_buildings (building_id, level, updated_at)
VALUES ('forge', 0, '1970-01-01T00:00:00.000Z');

INSERT OR IGNORE INTO kingdom_combat (
  id, active, hero_hp, hero_hp_max, enemy_hp, enemy_hp_max,
  turn_number, enemy_intent, hero_guarding, skill_cooldown, outcome, log_json, first_win_rewarded, updated_at
) VALUES (1, 0, 0, 0, 0, 0, 0, 'normal', 0, 0, NULL, '[]', 0, '1970-01-01T00:00:00.000Z');
`;

export default sql;