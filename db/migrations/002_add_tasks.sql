-- Migration 002: Add tasks table (replaces Feishu Bitable as task storage)
-- Tasks are stored in Postgres; bot messages assignees directly via Feishu API

CREATE TABLE IF NOT EXISTS tasks (
    id               SERIAL PRIMARY KEY,
    title            TEXT NOT NULL,
    creator_id       VARCHAR(255),           -- feishu_user_id of creator (on_xxx)
    assignee_id      VARCHAR(255) NOT NULL,  -- feishu_user_id of assignee (for lookup)
    assignee_open_id VARCHAR(255),           -- open_id of assignee (ou_xxx, for messaging)
    deadline         TIMESTAMPTZ,
    status           VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | completed
    proof            TEXT,                   -- completion proof URL
    note             TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS tasks_assignee_status_idx ON tasks(assignee_id, status);
CREATE INDEX IF NOT EXISTS tasks_creator_idx ON tasks(creator_id);
CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks(status);
