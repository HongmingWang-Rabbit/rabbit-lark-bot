-- 初始化数据库 schema

-- 管理员表
CREATE TABLE IF NOT EXISTS admins (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(64) UNIQUE,          -- 飞书 user_id
    email VARCHAR(255) UNIQUE,           -- 邮箱（备用标识）
    name VARCHAR(100),                   -- 显示名
    role VARCHAR(20) DEFAULT 'admin',    -- admin / superadmin
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 配置表（通用 KV 存储）
CREATE TABLE IF NOT EXISTS settings (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 操作日志（审计用）
CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(64),
    action VARCHAR(50) NOT NULL,         -- create_task, complete_task, add_admin, etc.
    target_type VARCHAR(50),             -- task, admin, setting
    target_id VARCHAR(100),
    details JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_admins_email ON admins(email);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);

-- 插入默认配置
INSERT INTO settings (key, value, description) VALUES
    ('default_deadline_days', '3', '默认截止天数'),
    ('timezone', '"Asia/Shanghai"', '时区'),
    ('features', '{"cuiban": {"enabled": true}}', '功能开关')
ON CONFLICT (key) DO NOTHING;

-- 催办任务表（Bot 直接存储，不依赖飞书多维表格）
CREATE TABLE IF NOT EXISTS tasks (
    id               SERIAL PRIMARY KEY,
    title            TEXT NOT NULL,
    creator_id       VARCHAR(255),           -- feishu_user_id of creator (on_xxx)
    assignee_id      VARCHAR(255) NOT NULL,  -- feishu_user_id of assignee (for lookup)
    assignee_open_id VARCHAR(255),           -- open_id of assignee (ou_xxx, for messaging)
    reporter_open_id      VARCHAR(255),           -- open_id of reporter/creator (ou_xxx), notified on completion
    deadline              TIMESTAMPTZ,
    status                VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | completed
    reminder_interval_hours INTEGER NOT NULL DEFAULT 24,          -- hours between reminders (0 = disabled)
    last_reminded_at      TIMESTAMPTZ,                            -- when last reminder was sent
    deadline_notified_at  TIMESTAMPTZ,                            -- when one-time deadline-overdue alert was sent
    proof                 TEXT,
    note                  TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS tasks_assignee_status_idx ON tasks(assignee_id, status);

-- 用户会话表（替代内存 Map，重启后依然有效）
CREATE TABLE IF NOT EXISTS user_sessions (
    id          SERIAL PRIMARY KEY,
    session_key VARCHAR(255) NOT NULL UNIQUE,
    data        JSONB NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_sessions_key_idx     ON user_sessions (session_key);
CREATE INDEX IF NOT EXISTS user_sessions_expires_idx ON user_sessions (expires_at);
CREATE INDEX IF NOT EXISTS tasks_creator_idx ON tasks(creator_id);
CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks(status);

-- 用户会话表（持久化多步操作会话，重启后恢复）
CREATE TABLE IF NOT EXISTS user_sessions (
    id          SERIAL PRIMARY KEY,
    session_key VARCHAR(255) NOT NULL UNIQUE,
    data        JSONB NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_sessions_key_idx     ON user_sessions (session_key);
CREATE INDEX IF NOT EXISTS user_sessions_expires_idx ON user_sessions (expires_at);

-- 用户表（覆盖所有用户，包括管理员和普通用户）
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(64) UNIQUE NOT NULL,     -- 飞书 user_id
    open_id VARCHAR(64),                      -- 飞书 open_id
    name VARCHAR(100),                        -- 显示名
    email VARCHAR(255),                       -- 邮箱
    role VARCHAR(20) NOT NULL DEFAULT 'user', -- superadmin / admin / user
    configs JSONB NOT NULL DEFAULT '{}',      -- 每用户功能配置（覆盖默认值）
    phone VARCHAR(50),                        -- 手机号（从飞书 Contact API 获取）
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_open_id ON users(open_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- 触发器：自动更新 updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER admins_updated_at
    BEFORE UPDATE ON admins
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER settings_updated_at
    BEFORE UPDATE ON settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

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
