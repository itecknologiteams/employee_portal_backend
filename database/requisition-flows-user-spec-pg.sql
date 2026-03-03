-- Requisition flows per user specification (all 9 categories)
-- Run after: requisition-categories-table-pg.sql, requisition-flow-db-driven-pg.sql, requisition-hr-and-admin-pg.sql
-- Order: hod=1, hr=2, committee=3, procurement=4, finance=5, ceo=6, admin=7

-- 1) Admin approval columns
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'requisition' AND column_name = 'req_admin_approval') THEN
    ALTER TABLE requisition ADD COLUMN req_admin_approval SMALLINT DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'requisition' AND column_name = 'req_admin_approval_date') THEN
    ALTER TABLE requisition ADD COLUMN req_admin_approval_date TIMESTAMP NULL;
  END IF;
END $$;

-- 2) Admin flow stage (sequence 7) and reorder all stages
INSERT INTO requisition_flow_stage (stage_key, stage_label, sequence_order, employee_type_name, designation_name, filter_by_department, requisition_done_column)
VALUES ('admin', 'Admin', 7, 'Admin', 'Admin', 0, 'req_admin_approval')
ON CONFLICT (stage_key) DO UPDATE SET sequence_order = 7, employee_type_name = 'Admin', designation_name = 'Admin', requisition_done_column = 'req_admin_approval';

UPDATE requisition_flow_stage SET sequence_order = 1 WHERE stage_key = 'hod';
UPDATE requisition_flow_stage SET sequence_order = 2 WHERE stage_key = 'hr';
UPDATE requisition_flow_stage SET sequence_order = 3 WHERE stage_key = 'committee';
UPDATE requisition_flow_stage SET sequence_order = 4 WHERE stage_key = 'procurement';
UPDATE requisition_flow_stage SET sequence_order = 5 WHERE stage_key = 'finance';
UPDATE requisition_flow_stage SET sequence_order = 6 WHERE stage_key = 'ceo';
UPDATE requisition_flow_stage SET sequence_order = 7 WHERE stage_key = 'admin';

-- 3) Ensure all categories have rows for admin stage, then set behaviors via upsert
INSERT INTO requisition_category_stage (category_id, flow_stage_id, behavior)
SELECT c.id, fs.id, 'skip' FROM requisition_category c CROSS JOIN requisition_flow_stage fs WHERE fs.stage_key = 'admin'
ON CONFLICT (category_id, flow_stage_id) DO UPDATE SET behavior = EXCLUDED.behavior;

-- 4) Set behavior per category (by name) and stage (by stage_key). Using a CTE or direct UPDATE with subqueries.

-- Stationary & Vehicle Maintenance: hod=for_info, admin=approval, rest=skip
UPDATE requisition_category_stage cs SET behavior = b.behavior
FROM (SELECT c.id AS cid, fs.id AS fid, 'for_info' AS behavior FROM requisition_category c, requisition_flow_stage fs WHERE c.name IN ('Stationary','Vehicle Maintenance') AND fs.stage_key = 'hod') b
WHERE cs.category_id = b.cid AND cs.flow_stage_id = b.fid;
UPDATE requisition_category_stage cs SET behavior = b.behavior
FROM (SELECT c.id AS cid, fs.id AS fid, 'approval' AS behavior FROM requisition_category c, requisition_flow_stage fs WHERE c.name IN ('Stationary','Vehicle Maintenance') AND fs.stage_key = 'admin') b
WHERE cs.category_id = b.cid AND cs.flow_stage_id = b.fid;
UPDATE requisition_category_stage cs SET behavior = 'skip'
FROM requisition_category c JOIN requisition_flow_stage fs ON fs.stage_key IN ('hr','committee','procurement','finance','ceo')
WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name IN ('Stationary','Vehicle Maintenance');

-- Vehicle Repair & Other Repair & Maintenance: hod=for_info, committee/procurement/finance/ceo/admin=approval, hr=skip
UPDATE requisition_category_stage cs SET behavior = 'for_info'
FROM requisition_category c, requisition_flow_stage fs
WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name IN ('Vehicle Repair','Other Repair & Maintenance') AND fs.stage_key = 'hod';
UPDATE requisition_category_stage cs SET behavior = 'skip'
FROM requisition_category c, requisition_flow_stage fs WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name IN ('Vehicle Repair','Other Repair & Maintenance') AND fs.stage_key = 'hr';
UPDATE requisition_category_stage cs SET behavior = 'approval'
FROM requisition_category c, requisition_flow_stage fs WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name IN ('Vehicle Repair','Other Repair & Maintenance') AND fs.stage_key IN ('committee','procurement','finance','ceo','admin');

-- Loan & Advance Salary: hod/hr/finance/ceo=approval, committee/procurement/admin=skip (amount routing in app: <50K -> finance, >=50K -> ceo -> finance)
UPDATE requisition_category_stage cs SET behavior = 'approval'
FROM requisition_category c, requisition_flow_stage fs WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name = 'Loan & Advance Salary' AND fs.stage_key IN ('hod','hr','finance','ceo');
UPDATE requisition_category_stage cs SET behavior = 'skip'
FROM requisition_category c, requisition_flow_stage fs WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name = 'Loan & Advance Salary' AND fs.stage_key IN ('committee','procurement','admin');

-- Specialized Projects: procurement/finance/ceo=approval, hod/hr/committee/admin=skip
UPDATE requisition_category_stage cs SET behavior = 'skip'
FROM requisition_category c, requisition_flow_stage fs WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name = 'Specialized Projects' AND fs.stage_key IN ('hod','hr','committee','admin');
UPDATE requisition_category_stage cs SET behavior = 'approval'
FROM requisition_category c, requisition_flow_stage fs WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name = 'Specialized Projects' AND fs.stage_key IN ('procurement','finance','ceo');

-- IT Equipments, General Proc Grocery, General Proc Electric: committee/procurement/finance/ceo=approval, hod/hr/admin=skip
UPDATE requisition_category_stage cs SET behavior = 'skip'
FROM requisition_category c, requisition_flow_stage fs WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name IN ('IT Equipments','General Procurements Grocerry & Others','General Procurements Electric Appliances') AND fs.stage_key IN ('hod','hr','admin');
UPDATE requisition_category_stage cs SET behavior = 'approval'
FROM requisition_category c, requisition_flow_stage fs WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name IN ('IT Equipments','General Procurements Grocerry & Others','General Procurements Electric Appliances') AND fs.stage_key IN ('committee','procurement','finance','ceo');

-- Devices / Accessories: committee/finance/ceo/admin=approval, hod/hr/procurement=skip (Committee -> Finance -> CEO -> Admin; no Procurement quotations)
UPDATE requisition_category_stage cs SET behavior = 'skip'
FROM requisition_category c, requisition_flow_stage fs WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name = 'Devices / Accessories' AND fs.stage_key IN ('hod','hr','procurement');
UPDATE requisition_category_stage cs SET behavior = 'approval'
FROM requisition_category c, requisition_flow_stage fs WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name = 'Devices / Accessories' AND fs.stage_key IN ('committee','finance','ceo','admin');

SELECT 'User-spec flows applied: Admin stage added, order set, category behaviors updated.' AS message;
