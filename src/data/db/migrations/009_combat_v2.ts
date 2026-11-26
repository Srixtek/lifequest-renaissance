const sql = `
CREATE TABLE IF NOT EXISTS kingdom_combat_v2 (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  active INTEGER NOT NULL DEFAULT 0,
  hero_hp INTEGER NOT NULL DEFAULT 0,
  hero_hp_max INTEGER NOT NULL DEFAULT 0,
  enemy_hp INTEGER NOT NULL DEFAULT 0,
  enemy_hp_max INTEGER NOT NULL DEFAULT 0,
  turn_number INTEGER NOT NULL DEFAULT 0,
  enemy_intent TEXT NOT NULL DEFAULT 'normal' CHECK (enemy_intent IN ('normal', 'heavy', 'brace')),
  enemy_intent_index INTEGER NOT NULL DEFAULT 0,
  enemy_id TEXT NOT NULL DEFAULT 'thorn_guardian',
  concentration INTEGER NOT NULL DEFAULT 1 CHECK (concentration >= 0 AND concentration <= 3),
  hero_guarding INTEGER NOT NULL DEFAULT 0,
  skill_cooldown INTEGER NOT NULL DEFAULT 0,
  outcome TEXT CHECK (outcome IS NULL OR outcome IN ('victory', 'defeat')),
  log_json TEXT NOT NULL DEFAULT '[]',
  first_win_rewarded INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

INSERT INTO kingdom_combat_v2 (
  id, active, hero_hp, hero_hp_max, enemy_hp, enemy_hp_max,
  turn_number, enemy_intent, enemy_intent_index, enemy_id, concentration,
  hero_guarding, skill_cooldown, outcome, log_json, first_win_rewarded, updated_at
)
SELECT
  id,
  active,
  hero_hp,
  hero_hp_max,
  enemy_hp,
  enemy_hp_max,
  turn_number,
  CASE
    WHEN enemy_intent = 'power' THEN 'heavy'
    WHEN enemy_intent IN ('heavy', 'brace') THEN enemy_intent
    ELSE 'normal'
  END,
  0,
  'thorn_guardian',
  CASE
    WHEN skill_cooldown >= 2 THEN 0
    WHEN skill_cooldown = 1 THEN 1
    ELSE 1
  END,
  hero_guarding,
  skill_cooldown,
  outcome,
  log_json,
  first_win_rewarded,
  updated_at
FROM kingdom_combat
WHERE EXISTS (SELECT 1 FROM kingdom_combat WHERE id = 1);

INSERT OR IGNORE INTO kingdom_combat_v2 (
  id, active, hero_hp, hero_hp_max, enemy_hp, enemy_hp_max,
  turn_number, enemy_intent, enemy_intent_index, enemy_id, concentration,
  hero_guarding, skill_cooldown, outcome, log_json, first_win_rewarded, updated_at
) VALUES (1, 0, 0, 0, 0, 0, 0, 'normal', 0, 'thorn_guardian', 1, 0, 0, NULL, '[]', 0, '1970-01-01T00:00:00.000Z');

DROP TABLE kingdom_combat;
ALTER TABLE kingdom_combat_v2 RENAME TO kingdom_combat;
`;

export default sql;