-- Set per-category, per-stage behavior for ALL categories from 1.csv (requisition_category flags)
-- Run after: requisition-categories-table-pg.sql, requisition-flow-db-driven-pg.sql, requisition-hr-and-admin-pg.sql
-- Safe to re-run: uses ON CONFLICT DO UPDATE so all flows stay in sync with requisition_category.

-- HOD: approval | for_info | skip
INSERT INTO requisition_category_stage (category_id, flow_stage_id, behavior)
SELECT c.id, fs.id,
  CASE WHEN fs.stage_key = 'hod' THEN
    CASE WHEN c.hod_approval = 1 THEN 'approval' WHEN c.hod_for_info = 1 THEN 'for_info' ELSE 'skip' END
  ELSE NULL END
FROM requisition_category c
CROSS JOIN requisition_flow_stage fs
WHERE fs.stage_key = 'hod'
ON CONFLICT (category_id, flow_stage_id) DO UPDATE SET behavior = EXCLUDED.behavior;

-- HR: approval where hr_finance=1 (Loan), else skip
INSERT INTO requisition_category_stage (category_id, flow_stage_id, behavior)
SELECT c.id, fs.id,
  CASE WHEN fs.stage_key = 'hr' THEN
    CASE WHEN c.hr_finance = 1 THEN 'approval' ELSE 'skip' END
  ELSE NULL END
FROM requisition_category c
CROSS JOIN requisition_flow_stage fs
WHERE fs.stage_key = 'hr'
ON CONFLICT (category_id, flow_stage_id) DO UPDATE SET behavior = EXCLUDED.behavior;

-- Committee: approval where committee_review=1 or final_committee=1, else skip
INSERT INTO requisition_category_stage (category_id, flow_stage_id, behavior)
SELECT c.id, fs.id,
  CASE WHEN fs.stage_key = 'committee' THEN
    CASE WHEN (c.committee_review = 1 OR c.final_committee = 1) THEN 'approval' ELSE 'skip' END
  ELSE NULL END
FROM requisition_category c
CROSS JOIN requisition_flow_stage fs
WHERE fs.stage_key = 'committee'
ON CONFLICT (category_id, flow_stage_id) DO UPDATE SET behavior = EXCLUDED.behavior;

-- CEO: approval where ceo_approve=1, else skip
INSERT INTO requisition_category_stage (category_id, flow_stage_id, behavior)
SELECT c.id, fs.id,
  CASE WHEN fs.stage_key = 'ceo' THEN
    CASE WHEN c.ceo_approve = 1 THEN 'approval' ELSE 'skip' END
  ELSE NULL END
FROM requisition_category c
CROSS JOIN requisition_flow_stage fs
WHERE fs.stage_key = 'ceo'
ON CONFLICT (category_id, flow_stage_id) DO UPDATE SET behavior = EXCLUDED.behavior;

-- Procurement & Finance: always approval (required in flow)
INSERT INTO requisition_category_stage (category_id, flow_stage_id, behavior)
SELECT c.id, fs.id, 'approval'
FROM requisition_category c
CROSS JOIN requisition_flow_stage fs
WHERE fs.stage_key IN ('procurement', 'finance')
ON CONFLICT (category_id, flow_stage_id) DO UPDATE SET behavior = 'approval';

SELECT 'All category flows (1.csv) applied for HOD, HR, Committee, CEO, Procurement, Finance.' AS message;
