-- Agent API keys (DB-backed, replaces single AGENT_API_KEY env var)
CREATE TABLE IF NOT EXISTS agent_api_keys (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(100) NOT NULL,
    key_hash     CHAR(64) NOT NULL UNIQUE,     -- SHA-256 hex
    key_prefix   CHAR(8) NOT NULL,             -- "rlk_xxxx" for display
    created_by   VARCHAR(64) NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ                   -- NULL = active
);
CREATE INDEX IF NOT EXISTS idx_agent_api_keys_hash ON agent_api_keys(key_hash);

-- Avatar URL for users (from OAuth)
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
