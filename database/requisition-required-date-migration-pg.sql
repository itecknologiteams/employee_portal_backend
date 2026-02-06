-- PostgreSQL: Replace req_priority with req_required_by_date
-- Run: psql -d employee_portal -f requisition-required-date-migration-pg.sql

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'requisition' AND column_name = 'req_required_by_date') THEN
    ALTER TABLE requisition ADD COLUMN req_required_by_date DATE;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'requisition' AND column_name = 'req_priority') THEN
    ALTER TABLE requisition DROP COLUMN req_priority;
  END IF;
END $$;
