-- Migration: Add HR Check approval tracking columns to requisition table
-- These columns track who approved the HR Check stage (post-Finance, loan flow)

ALTER TABLE requisition
  ADD COLUMN IF NOT EXISTS req_hr_check_approved_by INTEGER REFERENCES employees(employee_id),
  ADD COLUMN IF NOT EXISTS req_hr_check_approved_at TIMESTAMP NULL;

COMMENT ON COLUMN requisition.req_hr_check_approved_by IS 'Employee who approved the HR Check stage (loan flow, after Finance)';
COMMENT ON COLUMN requisition.req_hr_check_approved_at IS 'Timestamp of HR Check approval';
