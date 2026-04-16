-- Migration: Add loan and advance salary columns to requisition table
-- Created: 2026-04-15

-- Add loan_advance_type column
ALTER TABLE requisition 
ADD COLUMN IF NOT EXISTS loan_advance_type VARCHAR(20);

-- Add loan_advance_amount column
ALTER TABLE requisition 
ADD COLUMN IF NOT EXISTS loan_advance_amount NUMERIC(12, 2);

-- Add loan_advance_reason column
ALTER TABLE requisition 
ADD COLUMN IF NOT EXISTS loan_advance_reason TEXT;

-- Add loan_installment_months column
ALTER TABLE requisition 
ADD COLUMN IF NOT EXISTS loan_installment_months INTEGER;

-- Add comments for documentation
COMMENT ON COLUMN requisition.loan_advance_type IS 'Type of request: loan or advance';
COMMENT ON COLUMN requisition.loan_advance_amount IS 'Amount requested for loan or advance salary';
COMMENT ON COLUMN requisition.loan_advance_reason IS 'Reason/Purpose for the loan or advance request';
COMMENT ON COLUMN requisition.loan_installment_months IS 'Number of months for loan repayment (1-10)';
