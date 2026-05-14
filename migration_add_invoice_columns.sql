-- Migration: Add invoice tracking columns to requisition table
-- Run once against your PostgreSQL database.

ALTER TABLE requisition ADD COLUMN IF NOT EXISTS req_invoice_url TEXT;
ALTER TABLE requisition ADD COLUMN IF NOT EXISTS req_invoice_uploaded_at TIMESTAMP;
ALTER TABLE requisition ADD COLUMN IF NOT EXISTS req_invoice_uploaded_by INTEGER REFERENCES employees(employee_id);

ALTER TABLE requisition ADD COLUMN IF NOT EXISTS req_forwarded_to_payable_at TIMESTAMP;
ALTER TABLE requisition ADD COLUMN IF NOT EXISTS req_forwarded_to_payable_by INTEGER REFERENCES employees(employee_id);
