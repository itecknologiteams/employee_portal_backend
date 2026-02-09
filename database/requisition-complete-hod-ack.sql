-- Procurement marks purchase complete; HOD acknowledges receipt
-- Run after requisition-procurement-finance.sql

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'requisition' AND column_name = 'req_purchase_completed') THEN
    ALTER TABLE requisition ADD COLUMN req_purchase_completed SMALLINT DEFAULT 0 CHECK (req_purchase_completed IN (0, 1));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'requisition' AND column_name = 'req_purchase_completed_date') THEN
    ALTER TABLE requisition ADD COLUMN req_purchase_completed_date TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'requisition' AND column_name = 'req_purchase_completed_by') THEN
    ALTER TABLE requisition ADD COLUMN req_purchase_completed_by INTEGER REFERENCES employees(employee_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'requisition' AND column_name = 'req_hod_acknowledged') THEN
    ALTER TABLE requisition ADD COLUMN req_hod_acknowledged SMALLINT DEFAULT 0 CHECK (req_hod_acknowledged IN (0, 1));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'requisition' AND column_name = 'req_hod_acknowledged_date') THEN
    ALTER TABLE requisition ADD COLUMN req_hod_acknowledged_date TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'requisition' AND column_name = 'req_hod_acknowledged_by') THEN
    ALTER TABLE requisition ADD COLUMN req_hod_acknowledged_by INTEGER REFERENCES employees(employee_id);
  END IF;
END $$;

SELECT 'Requisition complete & HOD acknowledge columns added.' AS message;
