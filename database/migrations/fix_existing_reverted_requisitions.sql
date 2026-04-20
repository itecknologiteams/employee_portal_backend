-- Migration: Fix existing reverted requisitions that can't be edited by HOD
-- This clears HOD approval flags for requisitions that were reverted before the fix

-- Step 1: Update the function (in case it wasn't updated properly)
CREATE OR REPLACE FUNCTION clear_approvals_after_stage(p_req_id INTEGER, p_stage VARCHAR(20))
RETURNS VOID AS $$
BEGIN
    -- Clear approvals based on which stage triggered the revert
    -- Also clear HOD approval so HOD can edit items when reverted back
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
            -- Default: clear HOD and all stages after HOD
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

-- Step 2: Fix existing reverted requisitions that haven't been resolved yet
-- Clear HOD approval for requisitions that are reverted to HOD but still have HOD approval flag set
UPDATE requisition SET
    req_hod_approval = 0,
    req_hod_approval_date = NULL,
    req_hod_approved_by = NULL,
    -- Also clear all intermediate stages to be safe
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
  AND revert_resolved_at IS NULL
  AND (req_hod_approval = 1 OR req_committee_approval = 1 OR req_ceo_approval = 1 
       OR req_procurement_ack = 1 OR req_finance_approval = 1 OR req_admin_approval = 1
       OR req_hr_approval = 1);

-- Return count of affected rows
SELECT 
    'Fixed existing reverted requisitions' AS message,
    COUNT(*) AS affected_requisitions
FROM requisition
WHERE has_been_reverted = 1
  AND reverted_to_stage = 'hod'
  AND revert_resolved_at IS NULL;
