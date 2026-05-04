-- Add urgency flag and date to requisition table.
-- req_is_urgent: 1 = urgent, 0 = can wait (default).
-- req_urgent_date: set to CURRENT_DATE at submission time when req_is_urgent = 1.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'requisition' AND column_name = 'req_is_urgent') THEN
    ALTER TABLE requisition ADD COLUMN req_is_urgent SMALLINT DEFAULT 0 CHECK (req_is_urgent IN (0, 1));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'requisition' AND column_name = 'req_urgent_date') THEN
    ALTER TABLE requisition ADD COLUMN req_urgent_date DATE;
  END IF;
END $$;
