-- Migration 012: User tags + tag-based auto-assignment for scheduled tasks
-- tags: TEXT[] on users for grouping (e.g. 'finance', 'ops')
-- target_tag: optional on scheduled_tasks; when set, scheduler picks lowest-workload user in group

-- 1. Add tags to users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_users_tags ON users USING GIN (tags);

-- 2. Extend scheduled_tasks for tag-based assignment
ALTER TABLE scheduled_tasks
  ALTER COLUMN target_open_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS target_tag VARCHAR(100);

-- Either target_open_id or target_tag must be set (but not enforced at DB level — enforced in app)
COMMENT ON COLUMN scheduled_tasks.target_tag IS
  'When set, scheduler picks the user in this tag group with the lowest pending-task workload.';
COMMENT ON COLUMN scheduled_tasks.target_open_id IS
  'Direct assignee open_id. Null when target_tag is used for auto-assignment.';
