-- Migration 005: Add periodic reminder fields to tasks
--   reminder_interval_hours  INTEGER  -- how often to remind assignee (0 = disabled, default 24h)
--   last_reminded_at         TIMESTAMPTZ -- when the last reminder was sent; used to compute next send time

ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS reminder_interval_hours INTEGER NOT NULL DEFAULT 24,
    ADD COLUMN IF NOT EXISTS last_reminded_at        TIMESTAMPTZ;

-- Index for the reminder cron query
CREATE INDEX IF NOT EXISTS tasks_reminder_idx
    ON tasks (status, reminder_interval_hours, assignee_open_id)
    WHERE status = 'pending';
