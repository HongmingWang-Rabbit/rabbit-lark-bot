-- Migration 004: Add reporter_open_id to tasks table
-- The reporter is the task creator (the person who runs /add).
-- When a task is completed, the reporter receives a Feishu DM notification.

ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS reporter_open_id VARCHAR(255);  -- open_id of reporter (ou_xxx), for DM notification
