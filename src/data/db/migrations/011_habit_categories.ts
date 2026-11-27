const sql = `
ALTER TABLE goal_definitions ADD COLUMN category_id TEXT;

UPDATE goal_definitions SET category_id = CASE template_id
  WHEN 'vape_sessions' THEN 'vape'
  WHEN 'alcohol_limit' THEN 'alcool'
  WHEN 'sport_minutes' THEN 'sport'
  WHEN 'call_family' THEN 'proches'
  WHEN 'freq_regulation' THEN 'personnel'
  WHEN 'screen_free' THEN 'sans_ecran'
  WHEN 'breathing5' THEN 'divers'
  ELSE NULL
END
WHERE category_id IS NULL AND template_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_goal_definitions_category ON goal_definitions (category_id);
`;

export default sql;
