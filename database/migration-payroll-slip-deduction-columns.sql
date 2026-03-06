-- Migration: Add separate deduction columns to payroll_slip so Loan, Salary Advance, Late, etc. show on slip (not lumped in other_deduction)
-- Run: psql -U postgres -d employee_portal -f database/migration-payroll-slip-deduction-columns.sql

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'payroll_slip' AND column_name = 'loan_deduction') THEN
    ALTER TABLE payroll_slip ADD COLUMN loan_deduction DECIMAL(18,2) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'payroll_slip' AND column_name = 'salary_advance_deduction') THEN
    ALTER TABLE payroll_slip ADD COLUMN salary_advance_deduction DECIMAL(18,2) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'payroll_slip' AND column_name = 'late_deduction') THEN
    ALTER TABLE payroll_slip ADD COLUMN late_deduction DECIMAL(18,2) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'payroll_slip' AND column_name = 'device_deduction') THEN
    ALTER TABLE payroll_slip ADD COLUMN device_deduction DECIMAL(18,2) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'payroll_slip' AND column_name = 'cellphone_installment_deduction') THEN
    ALTER TABLE payroll_slip ADD COLUMN cellphone_installment_deduction DECIMAL(18,2) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'payroll_slip' AND column_name = 'foodpanda_deduction') THEN
    ALTER TABLE payroll_slip ADD COLUMN foodpanda_deduction DECIMAL(18,2) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'payroll_slip' AND column_name = 'fuel_overusage_deduction') THEN
    ALTER TABLE payroll_slip ADD COLUMN fuel_overusage_deduction DECIMAL(18,2) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'payroll_slip' AND column_name = 'over_utilization_mobile_deduction') THEN
    ALTER TABLE payroll_slip ADD COLUMN over_utilization_mobile_deduction DECIMAL(18,2) DEFAULT 0;
  END IF;
END $$;

SELECT 'payroll_slip deduction columns added.' AS message;
