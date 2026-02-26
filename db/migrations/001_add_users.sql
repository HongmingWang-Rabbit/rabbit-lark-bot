-- Migration 001: Add users table with per-user feature configs
-- Run this against the existing database to migrate

-- New unified users table (covers admins + regular users)
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(64) UNIQUE NOT NULL,     -- Feishu user_id
    open_id VARCHAR(64),                      -- Feishu open_id (alternate lookup)
    name VARCHAR(100),                        -- display name
    email VARCHAR(255),                       -- email (optional)
    role VARCHAR(20) NOT NULL DEFAULT 'user', -- superadmin / admin / user
    configs JSONB NOT NULL DEFAULT '{}',      -- per-user feature config (see features/index.js)
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_open_id ON users(open_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Migrate existing admins into users table
INSERT INTO users (user_id, name, email, role, configs)
SELECT
    user_id,
    name,
    email,
    CASE WHEN role = 'superadmin' THEN 'superadmin' ELSE 'admin' END,
    '{}'::jsonb
FROM admins
WHERE user_id IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;

-- Trigger: auto-update updated_at
CREATE TRIGGER users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();
