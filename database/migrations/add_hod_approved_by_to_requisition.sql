-- Migration: Add req_hod_approved_by column to track which HOD approved the requisition
-- Date: 2026-04-17
-- Description: Adds a foreign key column to store the employee_id of the HOD who approved the requisition

-- Add the column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'requisition' AND column_name = 'req_hod_approved_by'
    ) THEN
        ALTER TABLE requisition
        ADD COLUMN req_hod_approved_by INTEGER REFERENCES employees(employee_id);
    END IF;
END $$;

-- Create an index for faster lookups by HOD approver
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE indexname = 'idx_requisition_hod_approved_by'
    ) THEN
        CREATE INDEX idx_requisition_hod_approved_by ON requisition(req_hod_approved_by)
        WHERE req_hod_approved_by IS NOT NULL;
    END IF;
END $$;

-- Populate existing HOD-approved requisitions with the current HOD of the creator's department
-- This is a best-effort migration to set the approver for historical records
UPDATE requisition r
SET req_hod_approved_by = hod.employee_id
FROM employees e
JOIN departments d ON e.department_id = d.department_id
JOIN employees hod ON d.hod_id = hod.employee_id
WHERE r.req_emp_id = e.employee_id
  AND r.req_hod_approval = 1
  AND r.req_hod_approved_by IS NULL;

-- For any remaining HOD-approved records where we couldn't determine the HOD
-- (e.g., department has no HOD assigned), set a flag by leaving them NULL
-- The frontend will show these in a separate "Legacy Approvals" section or hide them
