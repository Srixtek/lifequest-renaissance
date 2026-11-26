const sql = `
ALTER TABLE adaptive_challenge_state ADD COLUMN tier_index_interval INTEGER NOT NULL DEFAULT 0;
ALTER TABLE adaptive_challenge_state ADD COLUMN tier_manual_interval INTEGER NOT NULL DEFAULT 0;
ALTER TABLE adaptive_challenge_attempts ADD COLUMN coping_session_id TEXT;
`;

export default sql;