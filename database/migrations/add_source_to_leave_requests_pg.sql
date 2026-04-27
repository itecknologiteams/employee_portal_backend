-- Migration: Add source column to leave_requests table
-- Purpose: Track whether a leave request originated from the Employee Portal ('portal')
--          or was pushed in from the ICS Attendance System ('ics').
-- Created: 2026-04-23

BEGIN;

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'portal';

-- Back-fill any existing rows that have no source (treat as portal-originated)
UPDATE leave_requests
  SET source = 'portal'
  WHERE source IS NULL;

-- Add a check constraint to prevent invalid values
ALTER TABLE leave_requests
  DROP CONSTRAINT IF EXISTS chk_leave_requests_source;

ALTER TABLE leave_requests
  ADD CONSTRAINT chk_leave_requests_source
  CHECK (source IN ('portal', 'ics'));

-- Index for filtering/querying by source
CREATE INDEX IF NOT EXISTS idx_leave_requests_source ON leave_requests(source);

COMMENT ON COLUMN leave_requests.source IS
  'Origin of the leave request: portal = submitted via Employee Portal, ics = pushed from ICS Attendance System';

COMMIT;

SELECT 'Migration complete: source column added to leave_requests' AS message;
