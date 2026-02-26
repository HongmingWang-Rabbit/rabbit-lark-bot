-- 002_email_identifier.sql
-- Add feishu_user_id column to separate Feishu internal ID from the human-readable user_id (email)

ALTER TABLE users ADD COLUMN IF NOT EXISTS feishu_user_id TEXT;
CREATE INDEX IF NOT EXISTS users_feishu_user_id_idx ON users(feishu_user_id) WHERE feishu_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx ON users(email) WHERE email IS NOT NULL;
