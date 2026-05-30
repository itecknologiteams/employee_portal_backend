-- Migration: Add "IT" workflow stage for IT Equipments category
--
-- Flow change for IT Equipments:
--   Before: HOD → Committee → Procurement → CEO
--   After:  HOD → IT (adds items & pricing) → Committee → Procurement → CEO
--
-- IT stage is approval-style: IT employee opens the requisition, edits/adds line items
-- with proper brand/qty/unit-price, then either forwards to Committee or rejects.

-- 1) Ensure "IT" employee_type row exists (already inserted manually per user; safe upsert)
INSERT INTO employee_type (emp_type_name)
SELECT 'IT'
WHERE NOT EXISTS (
  SELECT 1 FROM employee_type WHERE LOWER(emp_type_name) = LOWER('IT')
);

-- 2) Add IT-stage columns on requisition (approval flag, timestamp, approver id).
ALTER TABLE requisition
  ADD COLUMN IF NOT EXISTS req_it_approval SMALLINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS req_it_approval_date TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS req_it_approved_by INTEGER NULL;

COMMENT ON COLUMN requisition.req_it_approval IS '1 once IT has finalised items & pricing and forwarded';
COMMENT ON COLUMN requisition.req_it_approval_date IS 'Timestamp of IT forward action';
COMMENT ON COLUMN requisition.req_it_approved_by IS 'Employee id of the IT user who forwarded';

-- 3) Insert IT into requisition_flow_stage, shifting later stages to make room at sequence_order = 2.
-- We bump everything that currently lives at sequence_order >= 2 by +1, then insert IT at 2.
UPDATE requisition_flow_stage
   SET sequence_order = sequence_order + 1
 WHERE sequence_order >= 2;

INSERT INTO requisition_flow_stage
  (stage_key, stage_label, sequence_order, employee_type_name, designation_name,
   filter_by_department, requisition_done_column)
SELECT 'it', 'IT', 2, 'IT', 'IT', 0, 'req_it_approval'
WHERE NOT EXISTS (
  SELECT 1 FROM requisition_flow_stage WHERE stage_key = 'it'
);

-- 4) Configure IT behavior for every existing category:
--    - "IT Equipments" → behavior = 'approval'
--    - everyone else  → behavior = 'skip'
-- Safe to re-run: skips rows where (category_id, flow_stage_id) already mapped.
WITH it_stage AS (
  SELECT id FROM requisition_flow_stage WHERE stage_key = 'it' LIMIT 1
)
INSERT INTO requisition_category_stage (category_id, flow_stage_id, behavior)
SELECT c.id, it.id,
       CASE WHEN LOWER(TRIM(c.name)) = 'it equipments' THEN 'approval' ELSE 'skip' END
  FROM requisition_category c
  CROSS JOIN it_stage it
 WHERE NOT EXISTS (
   SELECT 1 FROM requisition_category_stage cs
    WHERE cs.category_id = c.id AND cs.flow_stage_id = it.id
 );

SELECT 'IT stage migration applied.' AS message;
