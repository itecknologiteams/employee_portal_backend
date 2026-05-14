-- Migration: Add approver tracking columns for Committee and CEO
-- Run once against your PostgreSQL database.

ALTER TABLE requisition ADD COLUMN IF NOT EXISTS req_committee_approved_by INTEGER REFERENCES employees(employee_id);
ALTER TABLE requisition ADD COLUMN IF NOT EXISTS req_ceo_approved_by INTEGER REFERENCES employees(employee_id);
