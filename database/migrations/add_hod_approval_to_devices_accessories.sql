-- Migration: Add HOD approval requirement for Devices / Accessories category
-- Date: 2026-04-16
-- Description: Changes the flow from "Employee -> Committee -> Finance -> CEO -> Procurement"
-- to "Employee -> HOD (Approval) -> Committee -> Finance -> CEO -> Procurement"

-- 1) Update category table: Enable HOD approval flag for Devices / Accessories
UPDATE requisition_category
SET hod_approval = 1, hod_for_info = 0
WHERE name = 'Devices / Accessories';

-- 2) Update category stage behavior: Enable HOD as approval stage
UPDATE requisition_category_stage cs
SET behavior = 'approval'
FROM requisition_category c, requisition_flow_stage fs
WHERE cs.category_id = c.id 
  AND cs.flow_stage_id = fs.id 
  AND c.name = 'Devices / Accessories' 
  AND fs.stage_key = 'hod';

-- 3) Ensure HR stage remains skipped for this category (no change needed for other stages)
-- Committee, Finance, CEO should already be 'approval' from previous setup
-- Procurement and Admin should remain 'skip' (execution is done by procurement)

-- 4) Verify the update
SELECT 
    c.name AS category,
    c.hod_approval,
    c.hod_for_info,
    fs.stage_key,
    cs.behavior
FROM requisition_category c
JOIN requisition_category_stage cs ON cs.category_id = c.id
JOIN requisition_flow_stage fs ON fs.id = cs.flow_stage_id
WHERE c.name = 'Devices / Accessories'
ORDER BY fs.sequence_order;
