-- Add req_category column for requisition category (Stationary, Vehicle Maintenance, etc.)
-- Run after schema / creator-role migration

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'requisition' AND column_name = 'req_category') THEN
    ALTER TABLE requisition ADD COLUMN req_category VARCHAR(120);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_requisition_category ON requisition(req_category);

COMMENT ON COLUMN requisition.req_category IS 'Category of requisition: Stationary, Vehicle Maintenance, Vehicle Repair, etc. Used for routing and reporting.';

SELECT 'Requisition category column added successfully.' AS message;
