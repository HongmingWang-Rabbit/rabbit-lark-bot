-- Agent Webhooks 表
-- 存储已注册的 AI Agent webhook 配置

CREATE TABLE IF NOT EXISTS agent_webhooks (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,           -- Agent 标识名
    webhook_url TEXT NOT NULL,                   -- Agent 的 webhook 接收地址
    api_key VARCHAR(255),                        -- 共享密钥（用于签名验证）
    enabled BOOLEAN DEFAULT true,                -- 是否启用
    filters JSONB DEFAULT '{}',                  -- 过滤规则 (chat_types, user_ids, etc.)
    description TEXT,                            -- Agent 描述
    last_success_at TIMESTAMP,                   -- 最后成功转发时间
    last_error TEXT,                             -- 最后错误信息
    error_count INTEGER DEFAULT 0,               -- 连续错误次数
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_agent_webhooks_enabled ON agent_webhooks(enabled);

-- 触发器
CREATE TRIGGER agent_webhooks_updated_at
    BEFORE UPDATE ON agent_webhooks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

COMMENT ON TABLE agent_webhooks IS 'AI Agent webhook registrations for message forwarding';
COMMENT ON COLUMN agent_webhooks.filters IS 'JSON filter rules: {chat_types: ["p2p"], user_ids: [...], keywords: [...]}';
