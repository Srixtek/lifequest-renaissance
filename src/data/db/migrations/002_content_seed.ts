const sql = "-- Seed flags only; narrative content lives in TS modules.\nINSERT OR IGNORE INTO settings (key, value) VALUES ('schema_content', '0.1.0');\nINSERT OR IGNORE INTO settings (key, value) VALUES ('locale', 'fr');\nINSERT OR IGNORE INTO settings (key, value) VALUES ('notifications', 'off');\nINSERT OR IGNORE INTO settings (key, value) VALUES ('streaks', 'off');\n";
export default sql;
