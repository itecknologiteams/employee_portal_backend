-- Add HR approval stage and Admin execution support
-- Run after requisition-flow-db-driven-pg.sql

-- 1) HR approval columns on requisition
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'requisition' AND column_name = 'req_hr_approval') THEN
    ALTER TABLE requisition ADD COLUMN req_hr_approval SMALLINT DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'requisition' AND column_name = 'req_hr_approval_date') THEN
    ALTER TABLE requisition ADD COLUMN req_hr_approval_date TIMESTAMP NULL;
  END IF;
END $$;

-- 2) Insert HR flow stage (between HOD and Committee), then reorder
INSERT INTO requisition_flow_stage (stage_key, stage_label, sequence_order, employee_type_name, designation_name, filter_by_department, requisition_done_column)
VALUES ('hr', 'HR', 2, 'HR', 'HR', 0, 'req_hr_approval')
ON CONFLICT (stage_key) DO UPDATE SET
  sequence_order = 2,
  employee_type_name = 'HR',
  designation_name = 'HR',
  requisition_done_column = 'req_hr_approval';

UPDATE requisition_flow_stage SET sequence_order = 3 WHERE stage_key = 'committee';
UPDATE requisition_flow_stage SET sequence_order = 4 WHERE stage_key = 'ceo';
UPDATE requisition_flow_stage SET sequence_order = 5 WHERE stage_key = 'procurement';
UPDATE requisition_flow_stage SET sequence_order = 6 WHERE stage_key = 'finance';

-- 3) Per-category HR behavior: approval where hr_finance=1 (e.g. Loan), else skip
INSERT INTO requisition_category_stage (category_id, flow_stage_id, behavior)
SELECT c.id, (SELECT id FROM requisition_flow_stage WHERE stage_key = 'hr' LIMIT 1),
  CASE WHEN c.hr_finance = 1 THEN 'approval' ELSE 'skip' END
FROM requisition_category c
WHERE EXISTS (SELECT 1 FROM requisition_flow_stage WHERE stage_key = 'hr')
ON CONFLICT (category_id, flow_stage_id) DO UPDATE SET behavior = EXCLUDED.behavior;

SELECT 'HR stage and Admin support (columns) added.' AS message;
