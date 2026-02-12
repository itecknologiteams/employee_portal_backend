-- Migration: Payroll overrides (loan, salary_advance) and salary structure (conveyance liters, communication, arrears, etc.)
-- Run on existing DB: psql -U postgres -d employee_portal -f database/migration-payroll-fields.sql

-- Overrides: loan and salary advance per employee per period
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'payroll_period_employee_override' AND column_name = 'loan') THEN
        ALTER TABLE payroll_period_employee_override ADD COLUMN loan DECIMAL(18,2) DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'payroll_period_employee_override' AND column_name = 'salary_advance') THEN
        ALTER TABLE payroll_period_employee_override ADD COLUMN salary_advance DECIMAL(18,2) DEFAULT 0;
    END IF;
END $$;

-- Salary structure: new allowance fields (aligned with Excel / Payroll.jsx)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employee_salary_structure' AND column_name = 'conveyance_liters_allowance') THEN
        ALTER TABLE employee_salary_structure ADD COLUMN conveyance_liters_allowance DECIMAL(18,2) DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employee_salary_structure' AND column_name = 'communication_allowance') THEN
        ALTER TABLE employee_salary_structure ADD COLUMN communication_allowance DECIMAL(18,2) DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employee_salary_structure' AND column_name = 'arrears') THEN
        ALTER TABLE employee_salary_structure ADD COLUMN arrears DECIMAL(18,2) DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employee_salary_structure' AND column_name = 'incremental_arrears') THEN
        ALTER TABLE employee_salary_structure ADD COLUMN incremental_arrears DECIMAL(18,2) DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employee_salary_structure' AND column_name = 'bike_maintenance_allowance') THEN
        ALTER TABLE employee_salary_structure ADD COLUMN bike_maintenance_allowance DECIMAL(18,2) DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employee_salary_structure' AND column_name = 'incentives') THEN
        ALTER TABLE employee_salary_structure ADD COLUMN incentives DECIMAL(18,2) DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employee_salary_structure' AND column_name = 'device_reimbursement') THEN
        ALTER TABLE employee_salary_structure ADD COLUMN device_reimbursement DECIMAL(18,2) DEFAULT 0;
    END IF;
END $$;

SELECT 'Payroll overrides and salary structure fields applied.' AS message;
