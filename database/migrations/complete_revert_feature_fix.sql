-- Complete Revert Feature Fix
-- This script ensures the revert feature works properly by:
-- 1. Adding any missing columns
-- 2. Updating the clear_approvals function
-- 3. Fixing existing reverted requisitions
-- 4. Adding debug verification

-- Step 1: Ensure all revert columns exist
DO $$
BEGIN
    -- Add has_been_reverted if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'requisition' AND column_name = 'has_been_reverted') THEN
        ALTER TABLE requisition ADD COLUMN has_been_reverted SMALLINT DEFAULT 0 CHECK (has_been_reverted IN (0, 1));
    END IF;

    -- Add reverted_from_stage if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'requisition' AND column_name = 'reverted_from_stage') THEN
        ALTER TABLE requisition ADD COLUMN reverted_from_stage VARCHAR(20);
    END IF;

    -- Add reverted_to_stage if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'requisition' AND column_name = 'reverted_to_stage') THEN
        ALTER TABLE requisition ADD COLUMN reverted_to_stage VARCHAR(20) DEFAULT 'hod';
    END IF;

    -- Add reverted_by_employee_id if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'requisition' AND column_name = 'reverted_by_employee_id') THEN
        ALTER TABLE requisition ADD COLUMN reverted_by_employee_id INTEGER REFERENCES employees(employee_id);
    END IF;

    -- Add reverted_at if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'requisition' AND column_name = 'reverted_at') THEN
        ALTER TABLE requisition ADD COLUMN reverted_at TIMESTAMP;
    END IF;

    -- Add revert_comment if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'requisition' AND column_name = 'revert_comment') THEN
        ALTER TABLE requisition ADD COLUMN revert_comment TEXT;
    END IF;

    -- Add revert_resolved_at if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'requisition' AND column_name = 'revert_resolved_at') THEN
        ALTER TABLE requisition ADD COLUMN revert_resolved_at TIMESTAMP;
    END IF;

    -- Add resubmit_skip_stages if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'requisition' AND column_name = 'resubmit_skip_stages') THEN
        ALTER TABLE requisition ADD COLUMN resubmit_skip_stages BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

-- Step 2: Create or replace the function to clear approvals (with HOD approval clear)
CREATE OR REPLACE FUNCTION clear_approvals_after_stage(p_req_id INTEGER, p_stage VARCHAR(20))
RETURNS VOID AS $$
BEGIN
    CASE p_stage
        WHEN 'procurement' THEN
            UPDATE requisition SET
                req_hod_approval = 0,
                req_hod_approval_date = NULL,
                req_hod_approved_by = NULL,
                req_procurement_ack = 0,
                req_procurement_ack_date = NULL,
                req_procurement_ack_by = NULL,
                req_finance_approval = 0,
                req_finance_approval_date = NULL,
                req_finance_approved_by = NULL,
                req_admin_approval = 0,
                req_admin_approval_date = NULL,
                req_purchase_completed = 0,
                req_purchase_completed_date = NULL,
                req_hod_acknowledged = 0
            WHERE req_id = p_req_id;

        WHEN 'finance' THEN
            UPDATE requisition SET
                req_hod_approval = 0,
                req_hod_approval_date = NULL,
                req_hod_approved_by = NULL,
                req_finance_approval = 0,
                req_finance_approval_date = NULL,
                req_finance_approved_by = NULL,
                req_admin_approval = 0,
                req_admin_approval_date = NULL,
                req_purchase_completed = 0,
                req_purchase_completed_date = NULL,
                req_hod_acknowledged = 0
            WHERE req_id = p_req_id;

        WHEN 'admin' THEN
            UPDATE requisition SET
                req_hod_approval = 0,
                req_hod_approval_date = NULL,
                req_hod_approved_by = NULL,
                req_admin_approval = 0,
                req_admin_approval_date = NULL,
                req_purchase_completed = 0,
                req_purchase_completed_date = NULL,
                req_hod_acknowledged = 0
            WHERE req_id = p_req_id;

        WHEN 'ceo' THEN
            UPDATE requisition SET
                req_hod_approval = 0,
                req_hod_approval_date = NULL,
                req_hod_approved_by = NULL,
                req_ceo_approval = 0,
                req_ceo_approval_date = NULL,
                req_procurement_ack = 0,
                req_procurement_ack_date = NULL,
                req_procurement_ack_by = NULL,
                req_finance_approval = 0,
                req_finance_approval_date = NULL,
                req_finance_approved_by = NULL,
                req_admin_approval = 0,
                req_admin_approval_date = NULL,
                req_purchase_completed = 0,
                req_purchase_completed_date = NULL,
                req_hod_acknowledged = 0
            WHERE req_id = p_req_id;

        WHEN 'committee' THEN
            UPDATE requisition SET
                req_hod_approval = 0,
                req_hod_approval_date = NULL,
                req_hod_approved_by = NULL,
                req_committee_approval = 0,
                req_committee_approval_date = NULL,
                req_ceo_approval = 0,
                req_ceo_approval_date = NULL,
                req_procurement_ack = 0,
                req_procurement_ack_date = NULL,
                req_procurement_ack_by = NULL,
                req_finance_approval = 0,
                req_finance_approval_date = NULL,
                req_finance_approved_by = NULL,
                req_admin_approval = 0,
                req_admin_approval_date = NULL,
                req_purchase_completed = 0,
                req_purchase_completed_date = NULL,
                req_hod_acknowledged = 0
            WHERE req_id = p_req_id;

        WHEN 'hr' THEN
            UPDATE requisition SET
                req_hod_approval = 0,
                req_hod_approval_date = NULL,
                req_hod_approved_by = NULL,
                req_hr_approval = 0,
                req_hr_approval_date = NULL,
                req_committee_approval = 0,
                req_committee_approval_date = NULL,
                req_ceo_approval = 0,
                req_ceo_approval_date = NULL,
                req_procurement_ack = 0,
                req_procurement_ack_date = NULL,
                req_procurement_ack_by = NULL,
                req_finance_approval = 0,
                req_finance_approval_date = NULL,
                req_finance_approved_by = NULL,
                req_admin_approval = 0,
                req_admin_approval_date = NULL,
                req_purchase_completed = 0,
                req_purchase_completed_date = NULL,
                req_hod_acknowledged = 0
            WHERE req_id = p_req_id;

        ELSE
            UPDATE requisition SET
                req_hod_approval = 0,
                req_hod_approval_date = NULL,
                req_hod_approved_by = NULL,
                req_procurement_ack = 0,
                req_procurement_ack_date = NULL,
                req_procurement_ack_by = NULL,
                req_finance_approval = 0,
                req_finance_approval_date = NULL,
                req_finance_approved_by = NULL,
                req_admin_approval = 0,
                req_admin_approval_date = NULL,
                req_purchase_completed = 0,
                req_purchase_completed_date = NULL,
                req_hod_acknowledged = 0
            WHERE req_id = p_req_id;
    END CASE;
END;
$$ LANGUAGE plpgsql;

-- Step 3: Fix ALL existing reverted requisitions that haven't been resolved
-- This clears HOD approval so HOD can edit items
UPDATE requisition SET
    req_hod_approval = 0,
    req_hod_approval_date = NULL,
    req_hod_approved_by = NULL,
    req_committee_approval = 0,
    req_committee_approval_date = NULL,
    req_ceo_approval = 0,
    req_ceo_approval_date = NULL,
    req_procurement_ack = 0,
    req_procurement_ack_date = NULL,
    req_procurement_ack_by = NULL,
    req_finance_approval = 0,
    req_finance_approval_date = NULL,
    req_finance_approved_by = NULL,
    req_admin_approval = 0,
    req_admin_approval_date = NULL,
    req_purchase_completed = 0,
    req_purchase_completed_date = NULL,
    req_hod_acknowledged = 0,
    req_hr_approval = 0,
    req_hr_approval_date = NULL
WHERE has_been_reverted = 1
  AND reverted_to_stage = 'hod'
  AND revert_resolved_at IS NULL;

-- Step 4: Also fix any requisitions where stage is 'hod' but HOD approval is still 1
-- (catches edge cases where revert happened but HOD approval wasn't cleared)
UPDATE requisition SET
    req_hod_approval = 0,
    req_hod_approval_date = NULL,
    req_hod_approved_by = NULL
WHERE req_current_stage_key = 'hod'
  AND req_hod_approval = 1
  AND has_been_reverted = 1
  AND revert_resolved_at IS NULL;

-- Step 5: Create index for better performance if not exists
CREATE INDEX IF NOT EXISTS idx_requisition_reverted ON requisition(has_been_reverted) WHERE has_been_reverted = 1;

-- Step 6: Verification query
SELECT 
    'Verification Results' AS check_type,
    COUNT(*) FILTER (WHERE has_been_reverted = 1 AND reverted_to_stage = 'hod' AND revert_resolved_at IS NULL) AS pending_reverted_count,
    COUNT(*) FILTER (WHERE has_been_reverted = 1 AND reverted_to_stage = 'hod' AND revert_resolved_at IS NULL AND req_hod_approval = 0) AS editable_reverted_count,
    COUNT(*) FILTER (WHERE has_been_reverted = 1 AND reverted_to_stage = 'hod' AND revert_resolved_at IS NULL AND req_hod_approval = 1) AS still_approved_count
FROM requisition;
