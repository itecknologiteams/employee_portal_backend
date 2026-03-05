-- Requisition flows — set per user specification (all categories)
-- Run after: requisition-categories-table-pg.sql, requisition-flow-db-driven-pg.sql, requisition-hr-and-admin-pg.sql, requisition-flows-user-spec-pg.sql (so all stages and category_stage rows exist)
-- This script sets category_stage behaviors and execution flags to match the exact flows below.

-- =============================================================================
-- FLOWS (user spec):
-- Stationary: Employee -> HOD (For Info) -> Admin (Execution) -> Acknowledgment
-- Vehicle Maintenance: same
-- Vehicle & Other Repairs: Employee -> HOD (Approval) -> Committee -> Procurement -> Finance -> CEO -> Admin (Execution) -> Acknowledgment
-- Loan <50K: Employee -> HOD -> HR -> Finance (Execution) -> Acknowledgment
-- Loan >=50K: Employee -> HOD -> HR -> Finance (Approval) -> CEO -> Finance (Execution) -> Acknowledgment
-- Specialized Projects: Employee -> Committee -> Procurement -> Finance -> CEO -> Procurement (Execution) -> Acknowledgment
-- IT Equipment: Employee -> HOD (Items & Approval) -> Committee -> Procurement -> Finance -> CEO -> Procurement (Execution) -> Acknowledgment
-- General Procurements Grocery & Others: same as Specialized (Committee first)
-- General Procurements Electric Appliances: same
-- Devices / Accessories: Employee -> Committee -> Finance -> CEO -> Procurement (Execution) -> Acknowledgment
-- =============================================================================

-- 1) Stage order: hod=1, hr=2, committee=3, procurement=4, finance=5, ceo=6, admin=7
UPDATE requisition_flow_stage SET sequence_order = 1 WHERE stage_key = 'hod';
UPDATE requisition_flow_stage SET sequence_order = 2 WHERE stage_key = 'hr';
UPDATE requisition_flow_stage SET sequence_order = 3 WHERE stage_key = 'committee';
UPDATE requisition_flow_stage SET sequence_order = 4 WHERE stage_key = 'procurement';
UPDATE requisition_flow_stage SET sequence_order = 5 WHERE stage_key = 'finance';
UPDATE requisition_flow_stage SET sequence_order = 6 WHERE stage_key = 'ceo';
UPDATE requisition_flow_stage SET sequence_order = 7 WHERE stage_key = 'admin';

-- 2) Ensure all category-stage rows exist (skip by default), then we overwrite below
INSERT INTO requisition_category_stage (category_id, flow_stage_id, behavior)
SELECT c.id, fs.id, 'skip' FROM requisition_category c CROSS JOIN requisition_flow_stage fs
ON CONFLICT (category_id, flow_stage_id) DO NOTHING;

-- 3) Stationary: HOD (For Info) -> Admin (Execution) -> Acknowledgment
UPDATE requisition_category_stage cs SET behavior = 'for_info'
FROM requisition_category c, requisition_flow_stage fs
WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name = 'Stationary' AND fs.stage_key = 'hod';
UPDATE requisition_category_stage cs SET behavior = 'approval'
FROM requisition_category c, requisition_flow_stage fs
WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name = 'Stationary' AND fs.stage_key = 'admin';
UPDATE requisition_category_stage cs SET behavior = 'skip'
FROM requisition_category c JOIN requisition_flow_stage fs ON fs.stage_key IN ('hr','committee','procurement','finance','ceo')
WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name = 'Stationary';

-- 4) Vehicle Maintenance: same as Stationary
UPDATE requisition_category_stage cs SET behavior = 'for_info'
FROM requisition_category c, requisition_flow_stage fs
WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name = 'Vehicle Maintenance' AND fs.stage_key = 'hod';
UPDATE requisition_category_stage cs SET behavior = 'approval'
FROM requisition_category c, requisition_flow_stage fs
WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name = 'Vehicle Maintenance' AND fs.stage_key = 'admin';
UPDATE requisition_category_stage cs SET behavior = 'skip'
FROM requisition_category c JOIN requisition_flow_stage fs ON fs.stage_key IN ('hr','committee','procurement','finance','ceo')
WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name = 'Vehicle Maintenance';

-- 5) Vehicle Repair & Other Repair & Maintenance: HOD (Approval) -> Committee -> Procurement -> Finance -> CEO -> Admin (Execution)
UPDATE requisition_category_stage cs SET behavior = 'approval'
FROM requisition_category c, requisition_flow_stage fs
WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name IN ('Vehicle Repair','Other Repair & Maintenance') AND fs.stage_key IN ('hod','committee','procurement','finance','ceo','admin');
UPDATE requisition_category_stage cs SET behavior = 'skip'
FROM requisition_category c, requisition_flow_stage fs
WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name IN ('Vehicle Repair','Other Repair & Maintenance') AND fs.stage_key = 'hr';

-- 6) Loan & Advance Salary: HOD -> HR -> Finance (and CEO for >=50K). Committee, Procurement, Admin = skip.
UPDATE requisition_category_stage cs SET behavior = 'approval'
FROM requisition_category c, requisition_flow_stage fs
WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name = 'Loan & Advance Salary' AND fs.stage_key IN ('hod','hr','finance','ceo');
UPDATE requisition_category_stage cs SET behavior = 'skip'
FROM requisition_category c, requisition_flow_stage fs
WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name = 'Loan & Advance Salary' AND fs.stage_key IN ('committee','procurement','admin');

-- 7) Specialized Projects: Committee -> Procurement -> Finance -> CEO -> Procurement (Execution). First stage = Committee.
UPDATE requisition_category_stage cs SET behavior = 'skip'
FROM requisition_category c, requisition_flow_stage fs
WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name = 'Specialized Projects' AND fs.stage_key IN ('hod','hr','admin');
UPDATE requisition_category_stage cs SET behavior = 'approval'
FROM requisition_category c, requisition_flow_stage fs
WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name = 'Specialized Projects' AND fs.stage_key IN ('committee','procurement','finance','ceo');

-- 8) IT Equipments: HOD (Items & Approval) -> Committee -> Procurement -> Finance -> CEO -> Procurement (Execution)
UPDATE requisition_category_stage cs SET behavior = 'approval'
FROM requisition_category c, requisition_flow_stage fs
WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name = 'IT Equipments' AND fs.stage_key IN ('hod','committee','procurement','finance','ceo');
UPDATE requisition_category_stage cs SET behavior = 'skip'
FROM requisition_category c, requisition_flow_stage fs
WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name = 'IT Equipments' AND fs.stage_key IN ('hr','admin');

-- 9) General Procurements Grocerry & Others: Committee first (same as Specialized)
UPDATE requisition_category_stage cs SET behavior = 'skip'
FROM requisition_category c, requisition_flow_stage fs
WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name = 'General Procurements Grocerry & Others' AND fs.stage_key IN ('hod','hr','admin');
UPDATE requisition_category_stage cs SET behavior = 'approval'
FROM requisition_category c, requisition_flow_stage fs
WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name = 'General Procurements Grocerry & Others' AND fs.stage_key IN ('committee','procurement','finance','ceo');

-- 10) General Procurements Electric Appliances: same
UPDATE requisition_category_stage cs SET behavior = 'skip'
FROM requisition_category c, requisition_flow_stage fs
WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name = 'General Procurements Electric Appliances' AND fs.stage_key IN ('hod','hr','admin');
UPDATE requisition_category_stage cs SET behavior = 'approval'
FROM requisition_category c, requisition_flow_stage fs
WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name = 'General Procurements Electric Appliances' AND fs.stage_key IN ('committee','procurement','finance','ceo');

-- 11) Devices / Accessories: Committee -> Finance -> CEO -> Procurement (Execution). No Procurement approval in path.
UPDATE requisition_category_stage cs SET behavior = 'skip'
FROM requisition_category c, requisition_flow_stage fs
WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name = 'Devices / Accessories' AND fs.stage_key IN ('hod','hr','procurement','admin');
UPDATE requisition_category_stage cs SET behavior = 'approval'
FROM requisition_category c, requisition_flow_stage fs
WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name = 'Devices / Accessories' AND fs.stage_key IN ('committee','finance','ceo');

-- 12) Category table: sync hod_for_info / hod_approval for createRequisition auto-advance (Stationary / Vehicle Maintenance = for info only)
UPDATE requisition_category SET hod_for_info = 1, hod_approval = 0 WHERE name IN ('Stationary','Vehicle Maintenance');
UPDATE requisition_category SET hod_for_info = 0, hod_approval = 1 WHERE name IN ('Vehicle Repair','Other Repair & Maintenance','Loan & Advance Salary','IT Equipments');

-- 13) Execution flags: who does execution after last approval
-- Admin execution: Stationary, Vehicle Maintenance, Vehicle Repair, Other Repair & Maintenance
UPDATE requisition_category SET execution_admin = 1, execution_finance = 0, execution_procurement = 0
WHERE name IN ('Stationary','Vehicle Maintenance','Vehicle Repair','Other Repair & Maintenance');
-- Finance execution: Loan & Advance Salary
UPDATE requisition_category SET execution_admin = 0, execution_finance = 1, execution_procurement = 0
WHERE name = 'Loan & Advance Salary';
-- Procurement execution: Specialized, IT, General Proc Grocery, General Proc Electric, Devices
UPDATE requisition_category SET execution_admin = 0, execution_finance = 0, execution_procurement = 1
WHERE name IN ('Specialized Projects','IT Equipments','General Procurements Grocerry & Others','General Procurements Electric Appliances','Devices / Accessories');

SELECT 'Requisition flows set per user specification.' AS message;
