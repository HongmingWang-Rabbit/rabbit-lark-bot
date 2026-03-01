-- Migration 013: add estimated_hours and target_tag to tasks
--
-- estimated_hours — effort estimate in hours (e.g. 0.5, 2, 8).
--   Used to weight workload when picking a tag-based assignee:
--   sort by SUM(COALESCE(estimated_hours, 1)) ascending instead of raw task count.
--
-- target_tag — if set, the task was auto-assigned to whoever in that tag group
--   had the lowest workload at creation time. Stored for audit / display purposes.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS estimated_hours NUMERIC(5,2);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS target_tag      VARCHAR(100);
