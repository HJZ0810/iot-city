ALTER TABLE game_sessions ADD COLUMN previous_session_id VARCHAR(80) NULL;
CREATE UNIQUE INDEX game_sessions_previous_unique ON game_sessions(previous_session_id);
