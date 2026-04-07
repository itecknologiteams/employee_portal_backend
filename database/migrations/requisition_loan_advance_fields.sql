-- Migration: Add Loan & Advance Salary fields to requisition table
-- Created: 2026-04-06

ALTER TABLE requisition
    ADD COLUMN IF NOT EXISTS loan_advance_type VARCHAR(50),
    ADD COLUMN IF NOT EXISTS loan_advance_amount DECIMAL(15, 2),
    ADD COLUMN IF NOT EXISTS loan_advance_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_requisition_loan_advance
    ON requisition(loan_advance_type)
    WHERE loan_advance_type IS NOT NULL;
