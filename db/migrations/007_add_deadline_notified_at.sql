-- Migration 007: Track one-time deadline-overdue notification
-- When a task's deadline passes, both reporter and assignee receive a dedicated alert.
-- deadline_notified_at is set when that alert is sent — prevents re-sending on every cron run.

ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS deadline_notified_at TIMESTAMPTZ;

-- Index for the overdue-alert query (tasks past deadline but not yet notified)
CREATE INDEX IF NOT EXISTS tasks_overdue_idx
    ON tasks (deadline, deadline_notified_at)
    WHERE status = 'pending';
