-- Migration: Add concurrency protection fields
-- Run this in your MySQL database

-- Add version column for optimistic locking (if not exists)
ALTER TABLE activities ADD COLUMN IF NOT EXISTS version INT DEFAULT 1;

-- Create unique index on sof_no that allows NULLs
-- MySQL allows multiple NULL values in unique indexes by default
CREATE UNIQUE INDEX IF NOT EXISTS idx_sof_unique ON activities (sof_no);

-- Initialize version for existing records
UPDATE activities SET version = 1 WHERE version IS NULL;
