-- Migration 008: Create conversation_history table
-- Previously created at runtime via ensureConversationHistory(); now managed as a proper migration.

CREATE TABLE IF NOT EXISTS conversation_history (
  id          SERIAL PRIMARY KEY,
  chat_id     TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content     JSONB NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conv_history_chat ON conversation_history(chat_id, created_at DESC);
