-- Migration: Add ics_leave_id column to leave_requests table
-- Purpose: Store the external ICS Attendance System's own leave ID so the portal
--          can call back the CRM status-update API with the correct leave reference.
-- Created: 2026-04-28

BEGIN;

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS ics_leave_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_leave_requests_ics_leave_id
  ON leave_requests(ics_leave_id)
  WHERE ics_leave_id IS NOT NULL;

COMMENT ON COLUMN leave_requests.ics_leave_id IS
  'ICS Attendance System internal leave ID — populated only for source=ics records';

COMMIT;

SELECT 'Migration complete: ics_leave_id column added to leave_requests' AS message;
