-- Delete all requisitions (requisition_items are removed automatically via ON DELETE CASCADE)
-- Run with: psql -U postgres -d employee_portal -f database/delete-requisitions.sql

BEGIN;

DELETE FROM requisition;

-- Optional: show how many were deleted (run after DELETE in same session)
-- SELECT 'Requisitions deleted.' AS message;

COMMIT;
