-- Requisition flows — final setup per user specification
-- Run after: requisition-categories-table-pg.sql, requisition-flow-db-driven-pg.sql, requisition-hr-and-admin-pg.sql, requisition-flows-user-spec-pg.sql
-- This script corrects category behaviors and category table flags to match the exact flows below.

-- =============================================================================
-- FLOWS (user spec):
-- Stationary: Employee -> HOD (For Info) -> Admin (Execution) -> Acknowledgment
-- Vehicle Maintenance: same
-- Vehicle & Other Repairs: Employee -> HOD (Approval) -> Committee -> Procurement (Quotations) -> Finance -> CEO -> Admin (Execution) -> Acknowledgment
-- Loan <50K: Employee -> HOD -> HR -> Finance (Execution) -> Acknowledgment
-- Loan >=50K: Employee -> HOD -> HR -> Finance -> CEO -> Finance (Execution) -> Acknowledgment
-- Specialized Projects: Employee -> Committee -> Procurement -> Finance -> CEO -> Procurement (Execution) -> Acknowledgment
-- IT Equipment / General Proc Grocery / General Proc Electric: same as Specialized
-- Devices / Accessories: Employee -> Committee -> Finance -> CEO -> Procurement (Execution) -> Acknowledgment
-- =============================================================================

-- 1) Category table: Vehicle Repair & Other Repair — HOD = Approval (not For Info)
UPDATE requisition_category
SET hod_for_info = 0, hod_approval = 1
WHERE name IN ('Vehicle Repair', 'Other Repair & Maintenance');

-- 2) Stage order (ensure): hod=1, hr=2, committee=3, procurement=4, finance=5, ceo=6, admin=7
UPDATE requisition_flow_stage SET sequence_order = 1 WHERE stage_key = 'hod';
UPDATE requisition_flow_stage SET sequence_order = 2 WHERE stage_key = 'hr';
UPDATE requisition_flow_stage SET sequence_order = 3 WHERE stage_key = 'committee';
UPDATE requisition_flow_stage SET sequence_order = 4 WHERE stage_key = 'procurement';
UPDATE requisition_flow_stage SET sequence_order = 5 WHERE stage_key = 'finance';
UPDATE requisition_flow_stage SET sequence_order = 6 WHERE stage_key = 'ceo';
UPDATE requisition_flow_stage SET sequence_order = 7 WHERE stage_key = 'admin';

-- 3) Stationary & Vehicle Maintenance: hod=for_info, admin=approval, rest=skip (unchanged)
UPDATE requisition_category_stage cs SET behavior = 'for_info'
FROM requisition_category c, requisition_flow_stage fs
WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name IN ('Stationary','Vehicle Maintenance') AND fs.stage_key = 'hod';
UPDATE requisition_category_stage cs SET behavior = 'approval'
FROM requisition_category c, requisition_flow_stage fs
WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name IN ('Stationary','Vehicle Maintenance') AND fs.stage_key = 'admin';
UPDATE requisition_category_stage cs SET behavior = 'skip'
FROM requisition_category c JOIN requisition_flow_stage fs ON fs.stage_key IN ('hr','committee','procurement','finance','ceo')
WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name IN ('Stationary','Vehicle Maintenance');

-- 4) Vehicle Repair & Other Repair & Maintenance: HOD = Approval (not for_info), then Committee -> Procurement -> Finance -> CEO -> Admin
UPDATE requisition_category_stage cs SET behavior = 'approval'
FROM requisition_category c, requisition_flow_stage fs
WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name IN ('Vehicle Repair','Other Repair & Maintenance') AND fs.stage_key = 'hod';
UPDATE requisition_category_stage cs SET behavior = 'skip'
FROM requisition_category c, requisition_flow_stage fs
WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name IN ('Vehicle Repair','Other Repair & Maintenance') AND fs.stage_key = 'hr';
UPDATE requisition_category_stage cs SET behavior = 'approval'
FROM requisition_category c, requisition_flow_stage fs
WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name IN ('Vehicle Repair','Other Repair & Maintenance') AND fs.stage_key IN ('committee','procurement','finance','ceo','admin');

-- 5) Loan & Advance Salary: hod/hr/finance/ceo=approval, committee/procurement/admin=skip (amount routing in app: <50K -> finance, >=50K -> ceo -> finance)
UPDATE requisition_category_stage cs SET behavior = 'approval'
FROM requisition_category c, requisition_flow_stage fs
WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name = 'Loan & Advance Salary' AND fs.stage_key IN ('hod','hr','finance','ceo');
UPDATE requisition_category_stage cs SET behavior = 'skip'
FROM requisition_category c, requisition_flow_stage fs
WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name = 'Loan & Advance Salary' AND fs.stage_key IN ('committee','procurement','admin');

-- 6) Specialized Projects: Committee -> Procurement -> Finance -> CEO -> Procurement (Execution). First stage = Committee.
UPDATE requisition_category_stage cs SET behavior = 'skip'
FROM requisition_category c, requisition_flow_stage fs
WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name = 'Specialized Projects' AND fs.stage_key IN ('hod','hr','admin');
UPDATE requisition_category_stage cs SET behavior = 'approval'
FROM requisition_category c, requisition_flow_stage fs
WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name = 'Specialized Projects' AND fs.stage_key IN ('committee','procurement','finance','ceo');

-- 7) IT Equipments, General Procurements Grocerry & Others, General Procurements Electric Appliances: Committee -> Procurement -> Finance -> CEO -> Procurement (Execution)
UPDATE requisition_category_stage cs SET behavior = 'skip'
FROM requisition_category c, requisition_flow_stage fs
WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name IN ('IT Equipments','General Procurements Grocerry & Others','General Procurements Electric Appliances') AND fs.stage_key IN ('hod','hr','admin');
UPDATE requisition_category_stage cs SET behavior = 'approval'
FROM requisition_category c, requisition_flow_stage fs
WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name IN ('IT Equipments','General Procurements Grocerry & Others','General Procurements Electric Appliances') AND fs.stage_key IN ('committee','procurement','finance','ceo');

-- 8) Devices / Accessories: Committee -> Finance -> CEO -> Procurement (Execution). No Procurement quotations in path; procurement=skip so path is Committee->Finance->CEO; after CEO app sends to Procurement.
UPDATE requisition_category_stage cs SET behavior = 'skip'
FROM requisition_category c, requisition_flow_stage fs
WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name = 'Devices / Accessories' AND fs.stage_key IN ('hod','hr','procurement','admin');
UPDATE requisition_category_stage cs SET behavior = 'approval'
FROM requisition_category c, requisition_flow_stage fs
WHERE cs.category_id = c.id AND cs.flow_stage_id = fs.id AND c.name = 'Devices / Accessories' AND fs.stage_key IN ('committee','finance','ceo');

-- 9) Ensure category execution flags match: Devices = Procurement execution (no Admin)
UPDATE requisition_category SET execution_admin = 0, execution_procurement = 1 WHERE name = 'Devices / Accessories';
-- Stationary, Vehicle Maintenance, Vehicle Repair, Other Repair = Admin execution
UPDATE requisition_category SET execution_admin = 1, execution_procurement = 0 WHERE name IN ('Stationary','Vehicle Maintenance','Vehicle Repair','Other Repair & Maintenance');
-- Loan = Finance execution
UPDATE requisition_category SET execution_admin = 0, execution_finance = 1, execution_procurement = 0 WHERE name = 'Loan & Advance Salary';
-- Specialized, IT, General Proc = Procurement execution
UPDATE requisition_category SET execution_admin = 0, execution_procurement = 1 WHERE name IN ('Specialized Projects','IT Equipments','General Procurements Grocerry & Others','General Procurements Electric Appliances');

SELECT 'Requisition flows (final) applied per user spec.' AS message;
