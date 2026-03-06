-- Migration: Add overtime_allowance to employee_salary_structure (for payroll sheet "Over Time" column and slip breakdown)
-- Run: psql -U postgres -d employee_portal -f database/migration-overtime-allowance.sql

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'employee_salary_structure' AND column_name = 'overtime_allowance') THEN
        ALTER TABLE employee_salary_structure ADD COLUMN overtime_allowance DECIMAL(18,2) DEFAULT 0;
    END IF;
END $$;

SELECT 'overtime_allowance added to employee_salary_structure.' AS message;
