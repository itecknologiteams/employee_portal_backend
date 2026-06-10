-- HR Section 3 (Loan & Advance Salary) — persist the fields that previously had no columns.
-- These are filled by HR in the LoanAdvanceViewModal "Section 3" and must survive close/reopen,
-- independent of the approval action. The other three Section 3 fields already exist:
--   req_hr_approved_amount, req_employment_status, req_hr_approved_installments.

ALTER TABLE requisition ADD COLUMN IF NOT EXISTS req_hr_outstanding_loan NUMERIC(14,2);
ALTER TABLE requisition ADD COLUMN IF NOT EXISTS req_hr_loan_status VARCHAR(20);          -- 'approved' | 'not_approved'
ALTER TABLE requisition ADD COLUMN IF NOT EXISTS req_hr_installment_start_date DATE;
