-- Migration 003: Add phone column to users table
-- Stores mobile number collected from Feishu Contact API on first message

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50);

CREATE INDEX IF NOT EXISTS users_phone_idx ON users(phone) WHERE phone IS NOT NULL;
