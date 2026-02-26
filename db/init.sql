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

-- 用户表（覆盖所有用户，包括管理员和普通用户）
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(64) UNIQUE NOT NULL,     -- 飞书 user_id
    open_id VARCHAR(64),                      -- 飞书 open_id
    name VARCHAR(100),                        -- 显示名
    email VARCHAR(255),                       -- 邮箱
    role VARCHAR(20) NOT NULL DEFAULT 'user', -- superadmin / admin / user
    configs JSONB NOT NULL DEFAULT '{}',      -- 每用户功能配置（覆盖默认值）
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
