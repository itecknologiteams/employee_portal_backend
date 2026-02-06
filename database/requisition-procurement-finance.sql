-- Procurement & Finance workflow: add columns to requisition
-- Run after requisition-schema.sql
-- Required for: Acknowledge, 3 Quotations, Hand over to Finance, Finance HOD approval

-- Add Employee Type 'Finance' for Finance HOD
INSERT INTO employee_type (emp_type_name) VALUES ('Finance')
ON CONFLICT (emp_type_name) DO NOTHING;

-- Procurement: acknowledge, 3 quotation URLs, hand over to finance
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'requisition' AND column_name = 'req_procurement_ack') THEN
    ALTER TABLE requisition ADD COLUMN req_procurement_ack SMALLINT DEFAULT 0 CHECK (req_procurement_ack IN (0, 1));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'requisition' AND column_name = 'req_procurement_ack_date') THEN
    ALTER TABLE requisition ADD COLUMN req_procurement_ack_date TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'requisition' AND column_name = 'req_procurement_ack_by') THEN
    ALTER TABLE requisition ADD COLUMN req_procurement_ack_by INTEGER REFERENCES employees(employee_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'requisition' AND column_name = 'req_quotation_1_url') THEN
    ALTER TABLE requisition ADD COLUMN req_quotation_1_url VARCHAR(500);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'requisition' AND column_name = 'req_quotation_2_url') THEN
    ALTER TABLE requisition ADD COLUMN req_quotation_2_url VARCHAR(500);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'requisition' AND column_name = 'req_quotation_3_url') THEN
    ALTER TABLE requisition ADD COLUMN req_quotation_3_url VARCHAR(500);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'requisition' AND column_name = 'req_handed_to_finance') THEN
    ALTER TABLE requisition ADD COLUMN req_handed_to_finance SMALLINT DEFAULT 0 CHECK (req_handed_to_finance IN (0, 1));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'requisition' AND column_name = 'req_handed_to_finance_date') THEN
    ALTER TABLE requisition ADD COLUMN req_handed_to_finance_date TIMESTAMP;
  END IF;
  -- Finance approval
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'requisition' AND column_name = 'req_finance_approval') THEN
    ALTER TABLE requisition ADD COLUMN req_finance_approval SMALLINT DEFAULT 0 CHECK (req_finance_approval IN (0, 1));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'requisition' AND column_name = 'req_finance_approval_date') THEN
    ALTER TABLE requisition ADD COLUMN req_finance_approval_date TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'requisition' AND column_name = 'req_finance_approved_by') THEN
    ALTER TABLE requisition ADD COLUMN req_finance_approved_by INTEGER REFERENCES employees(employee_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'requisition' AND column_name = 'req_approved_quotation_index') THEN
    ALTER TABLE requisition ADD COLUMN req_approved_quotation_index SMALLINT CHECK (req_approved_quotation_index IN (1, 2, 3));
  END IF;
  -- Expected date for procurement to complete purchase and hand over to requesting employee
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'requisition' AND column_name = 'req_expected_handover_date') THEN
    ALTER TABLE requisition ADD COLUMN req_expected_handover_date DATE;
  END IF;
END $$;

SELECT 'Requisition procurement & finance columns added.' AS message;
