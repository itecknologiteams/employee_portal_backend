-- Migration: Add "Manager of Finance" workflow stage for Loan & Advance Salary requisitions.
--
-- Flow change:
--   Before: Finance approve  -> hr_check
--   After:  Finance approve  -> manager_finance -> hr_check
--
-- The Manager of Finance has three actions:
--   1. Start Progress      (sets req_manager_finance_status = 'in_progress')
--   2. Progress Completed  (sets req_manager_finance_status = 'completed')
--   3. Hand Over to HR     (moves stage to 'hr_check')

-- 1) New employee_type row so admins can assign employees to "Manager of Finance".
INSERT INTO employee_type (emp_type_name)
SELECT 'Manager of Finance'
WHERE NOT EXISTS (
  SELECT 1 FROM employee_type WHERE LOWER(emp_type_name) = LOWER('Manager of Finance')
);

-- 2) New columns on requisition tracking the manager-of-finance sub-workflow.
ALTER TABLE requisition
  ADD COLUMN IF NOT EXISTS req_manager_finance_status VARCHAR(20) NULL,
  ADD COLUMN IF NOT EXISTS req_manager_finance_started_by INTEGER NULL,
  ADD COLUMN IF NOT EXISTS req_manager_finance_started_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS req_manager_finance_completed_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS req_manager_finance_handover_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS req_loan_form_pdf_url TEXT NULL;

COMMENT ON COLUMN requisition.req_manager_finance_status IS 'Sub-status while at manager_finance stage: NULL | in_progress | completed';
COMMENT ON COLUMN requisition.req_manager_finance_started_by IS 'Employee id who clicked Start Progress';
COMMENT ON COLUMN requisition.req_manager_finance_started_at IS 'When Manager of Finance clicked Start Progress';
COMMENT ON COLUMN requisition.req_manager_finance_completed_at IS 'When Manager of Finance clicked Progress Completed';
COMMENT ON COLUMN requisition.req_manager_finance_handover_at IS 'When Manager of Finance clicked Hand Over to HR';
COMMENT ON COLUMN requisition.req_loan_form_pdf_url IS 'Base64 data-URL of the loan form PDF captured at Finance approval; reused for emails to Payable / Receivable.';

-- 3) Backfill: any loan/advance requisition already sitting at hr_check goes back to manager_finance.
--    These are existing approved loans that pre-date this feature.
UPDATE requisition
   SET req_current_stage_key = 'manager_finance'
 WHERE req_current_stage_key = 'hr_check'
   AND (
         LOWER(COALESCE(req_category, '')) LIKE '%loan%'
      OR LOWER(COALESCE(req_category, '')) LIKE '%advance%'
      OR LOWER(COALESCE(loan_advance_type, '')) IN ('loan', 'advance')
   );
