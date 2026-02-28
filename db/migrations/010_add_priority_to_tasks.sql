-- Migration 010: Add priority to tasks
-- P0=紧急, P1=一般 (default), P2=不紧急
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority VARCHAR(2) NOT NULL DEFAULT 'p1';
