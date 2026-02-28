-- Migration 011: Scheduled tasks (cron-based automatic task creation)
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id                      SERIAL PRIMARY KEY,
  name                    VARCHAR(200) NOT NULL,          -- display name (e.g. "周报催办")
  title                   TEXT NOT NULL,                  -- task title to create
  target_open_id          VARCHAR(255) NOT NULL,          -- assignee open_id (ou_xxx)
  reporter_open_id        VARCHAR(255),                   -- notified on completion
  schedule                VARCHAR(100) NOT NULL,          -- cron expression (e.g. "0 6 * * 1")
  timezone                VARCHAR(100) NOT NULL DEFAULT 'Asia/Shanghai',
  deadline_days           INTEGER NOT NULL DEFAULT 1,     -- days from creation to deadline
  priority                VARCHAR(2)  NOT NULL DEFAULT 'p1',
  note                    TEXT,
  reminder_interval_hours INTEGER NOT NULL DEFAULT 24,
  enabled                 BOOLEAN NOT NULL DEFAULT true,
  last_run_at             TIMESTAMPTZ,
  created_by              VARCHAR(64),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
