-- Migration 006: Persistent user sessions (survives server restarts)
-- Replaces in-memory Map used for multi-step flows (e.g., "complete which task?")

CREATE TABLE IF NOT EXISTS user_sessions (
    id          SERIAL PRIMARY KEY,
    session_key VARCHAR(255) NOT NULL UNIQUE,
    data        JSONB NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_sessions_key_idx     ON user_sessions (session_key);
CREATE INDEX IF NOT EXISTS user_sessions_expires_idx ON user_sessions (expires_at);
