-- Migration: Add HR-set employment status and approved installments for Loan & Advance Salary
ALTER TABLE requisition
  ADD COLUMN IF NOT EXISTS req_employment_status VARCHAR(30) NULL,
  ADD COLUMN IF NOT EXISTS req_hr_approved_installments INTEGER NULL;

COMMENT ON COLUMN requisition.req_employment_status IS 'Employment status set by HR during loan review (Permanent / Not Confirmed)';
COMMENT ON COLUMN requisition.req_hr_approved_installments IS 'Number of installments approved by HR for loan deduction';
