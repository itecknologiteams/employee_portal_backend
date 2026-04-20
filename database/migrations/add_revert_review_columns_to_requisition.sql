-- Migration: Add Revert & Review feature columns to requisition table
-- This enables the "Revert for Review" functionality where approvers can send
-- requisitions back to HOD for corrections, and HOD can resubmit skipping intermediate stages

-- Add columns to track revert/review state
ALTER TABLE requisition
ADD COLUMN IF NOT EXISTS has_been_reverted SMALLINT DEFAULT 0 CHECK (has_been_reverted IN (0, 1)),
ADD COLUMN IF NOT EXISTS reverted_from_stage VARCHAR(20),  -- Stage that triggered the revert (e.g., 'procurement', 'finance')
ADD COLUMN IF NOT EXISTS reverted_to_stage VARCHAR(20) DEFAULT 'hod',  -- Always 'hod' for now
ADD COLUMN IF NOT EXISTS reverted_by_employee_id INTEGER REFERENCES employees(employee_id),
ADD COLUMN IF NOT EXISTS reverted_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS revert_comment TEXT,  -- The comment explaining why it was reverted
ADD COLUMN IF NOT EXISTS revert_resolved_at TIMESTAMP,  -- When HOD resubmitted after fixing
ADD COLUMN IF NOT EXISTS resubmit_skip_stages BOOLEAN DEFAULT FALSE;  -- Whether to skip intermediate stages on resubmit

-- Add index for efficient querying of reverted requisitions
CREATE INDEX IF NOT EXISTS idx_requisition_reverted ON requisition(has_been_reverted) WHERE has_been_reverted = 1;
CREATE INDEX IF NOT EXISTS idx_requisition_reverted_from ON requisition(reverted_from_stage) WHERE has_been_reverted = 1;

-- Add comment type to distinguish revert comments from regular comments
-- Note: Using the existing requisition_comments table with a special stage_key prefix

-- Function to get the target stage after HOD resubmits (skips intermediate stages)
CREATE OR REPLACE FUNCTION get_resubmit_target_stage(p_req_id INTEGER)
RETURNS VARCHAR(20) AS $$
DECLARE
    v_reverted_from VARCHAR(20);
    v_category VARCHAR(100);
BEGIN
    -- Get the stage that triggered the revert
    SELECT reverted_from_stage, req_category
    INTO v_reverted_from, v_category
    FROM requisition
    WHERE req_id = p_req_id AND has_been_reverted = 1;

    -- If not reverted, return 'hod' as default
    IF v_reverted_from IS NULL THEN
        RETURN 'hod';
    END IF;

    -- Return the stage that reverted (so we skip everything in between)
    RETURN v_reverted_from;
END;
$$ LANGUAGE plpgsql;

-- Function to clear intermediate approvals when reverting
CREATE OR REPLACE FUNCTION clear_approvals_after_stage(p_req_id INTEGER, p_stage VARCHAR(20))
RETURNS VOID AS $$
BEGIN
    -- Clear approvals based on which stage triggered the revert
    CASE p_stage
        WHEN 'procurement' THEN
            -- Procurement reverted: clear procurement, finance, admin approvals
            UPDATE requisition SET
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
            -- Finance reverted: clear finance, admin approvals
            UPDATE requisition SET
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
            -- Admin reverted: clear admin approval
            UPDATE requisition SET
                req_admin_approval = 0,
                req_admin_approval_date = NULL,
                req_purchase_completed = 0,
                req_purchase_completed_date = NULL,
                req_hod_acknowledged = 0
            WHERE req_id = p_req_id;

        WHEN 'ceo' THEN
            -- CEO reverted: clear CEO, procurement, finance, admin approvals
            UPDATE requisition SET
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
            -- Committee reverted: clear Committee, CEO, procurement, finance, admin approvals
            UPDATE requisition SET
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
            -- HR reverted: clear HR and everything after
            UPDATE requisition SET
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
            -- Default: just clear flags for stages after HOD
            UPDATE requisition SET
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

-- Migration complete
SELECT 'Revert & Review feature columns added successfully' AS message;
