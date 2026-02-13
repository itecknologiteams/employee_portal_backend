-- Migration: Add SQL Server Pay Sheet columns to old_salary_slip (full structure).
-- Run after migration-old-salary-slip.sql: psql -U postgres -d employee_portal -f database/migration-old-salary-slip-paysheet-columns.sql

DO $$
BEGIN
  -- Source/reference from SQL Server
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'source_slip_id') THEN
    ALTER TABLE old_salary_slip ADD COLUMN source_slip_id INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'payroll_id') THEN
    ALTER TABLE old_salary_slip ADD COLUMN payroll_id INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'hr_emp_id') THEN
    ALTER TABLE old_salary_slip ADD COLUMN hr_emp_id INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'co_id') THEN
    ALTER TABLE old_salary_slip ADD COLUMN co_id INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'dept_id') THEN
    ALTER TABLE old_salary_slip ADD COLUMN dept_id INTEGER;
  END IF;
  -- Days
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'm_days') THEN
    ALTER TABLE old_salary_slip ADD COLUMN m_days INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'w_days') THEN
    ALTER TABLE old_salary_slip ADD COLUMN w_days INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'a_days') THEN
    ALTER TABLE old_salary_slip ADD COLUMN a_days INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'j_l_days') THEN
    ALTER TABLE old_salary_slip ADD COLUMN j_l_days INTEGER;
  END IF;
  -- Allowances (numbered as in SQL Server)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'basic_salary_1') THEN
    ALTER TABLE old_salary_slip ADD COLUMN basic_salary_1 DECIMAL(18,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'medical_allowance_2') THEN
    ALTER TABLE old_salary_slip ADD COLUMN medical_allowance_2 DECIMAL(18,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'conveyance_fixed_allowance_3') THEN
    ALTER TABLE old_salary_slip ADD COLUMN conveyance_fixed_allowance_3 DECIMAL(18,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'overtime_allowance_4') THEN
    ALTER TABLE old_salary_slip ADD COLUMN overtime_allowance_4 DECIMAL(18,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'house_rent_allowance_5') THEN
    ALTER TABLE old_salary_slip ADD COLUMN house_rent_allowance_5 DECIMAL(18,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'utilities_allowance_6') THEN
    ALTER TABLE old_salary_slip ADD COLUMN utilities_allowance_6 DECIMAL(18,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'meal_allowance_7') THEN
    ALTER TABLE old_salary_slip ADD COLUMN meal_allowance_7 DECIMAL(18,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'arrears_8') THEN
    ALTER TABLE old_salary_slip ADD COLUMN arrears_8 DECIMAL(18,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'bike_maintainence_9') THEN
    ALTER TABLE old_salary_slip ADD COLUMN bike_maintainence_9 DECIMAL(18,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'incentives_tech_10') THEN
    ALTER TABLE old_salary_slip ADD COLUMN incentives_tech_10 DECIMAL(18,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'device_reimbursment_11') THEN
    ALTER TABLE old_salary_slip ADD COLUMN device_reimbursment_11 DECIMAL(18,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'communication_12') THEN
    ALTER TABLE old_salary_slip ADD COLUMN communication_12 DECIMAL(18,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'incentives_kpi_13') THEN
    ALTER TABLE old_salary_slip ADD COLUMN incentives_kpi_13 DECIMAL(18,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'other_allowance_14') THEN
    ALTER TABLE old_salary_slip ADD COLUMN other_allowance_14 DECIMAL(18,2);
  END IF;
  -- Deductions
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'loan_15') THEN
    ALTER TABLE old_salary_slip ADD COLUMN loan_15 DECIMAL(18,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'advance_salary_16') THEN
    ALTER TABLE old_salary_slip ADD COLUMN advance_salary_16 DECIMAL(18,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'eobi_17') THEN
    ALTER TABLE old_salary_slip ADD COLUMN eobi_17 DECIMAL(18,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'income_tax_18') THEN
    ALTER TABLE old_salary_slip ADD COLUMN income_tax_18 DECIMAL(18,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'absent_days_19') THEN
    ALTER TABLE old_salary_slip ADD COLUMN absent_days_19 DECIMAL(18,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'device_deduction_20') THEN
    ALTER TABLE old_salary_slip ADD COLUMN device_deduction_20 DECIMAL(18,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'over_utilization_mobile_21') THEN
    ALTER TABLE old_salary_slip ADD COLUMN over_utilization_mobile_21 DECIMAL(18,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'vehicle_fuel_deduction_22') THEN
    ALTER TABLE old_salary_slip ADD COLUMN vehicle_fuel_deduction_22 DECIMAL(18,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'pandamic_deduction_23') THEN
    ALTER TABLE old_salary_slip ADD COLUMN pandamic_deduction_23 DECIMAL(18,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'late_days_24') THEN
    ALTER TABLE old_salary_slip ADD COLUMN late_days_24 DECIMAL(18,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'other_deduction_25') THEN
    ALTER TABLE old_salary_slip ADD COLUMN other_deduction_25 DECIMAL(18,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'mobile_installment_26') THEN
    ALTER TABLE old_salary_slip ADD COLUMN mobile_installment_26 DECIMAL(18,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'food_panda_27') THEN
    ALTER TABLE old_salary_slip ADD COLUMN food_panda_27 DECIMAL(18,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'conveyance_liters_allowance_28') THEN
    ALTER TABLE old_salary_slip ADD COLUMN conveyance_liters_allowance_28 DECIMAL(18,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'leaves_29') THEN
    ALTER TABLE old_salary_slip ADD COLUMN leaves_29 DECIMAL(18,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'incremental_arrears_31') THEN
    ALTER TABLE old_salary_slip ADD COLUMN incremental_arrears_31 DECIMAL(18,2);
  END IF;
  -- Totals (SQL Server names)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'tot_gross_salary') THEN
    ALTER TABLE old_salary_slip ADD COLUMN tot_gross_salary DECIMAL(18,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'tot_allowances') THEN
    ALTER TABLE old_salary_slip ADD COLUMN tot_allowances DECIMAL(18,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'tot_net_gross_allowances') THEN
    ALTER TABLE old_salary_slip ADD COLUMN tot_net_gross_allowances DECIMAL(18,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'tot_deductions') THEN
    ALTER TABLE old_salary_slip ADD COLUMN tot_deductions DECIMAL(18,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'tot_ac_to_wd') THEN
    ALTER TABLE old_salary_slip ADD COLUMN tot_ac_to_wd DECIMAL(18,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'tot_net_salary') THEN
    ALTER TABLE old_salary_slip ADD COLUMN tot_net_salary DECIMAL(18,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'old_salary_slip' AND column_name = 'salary_status') THEN
    ALTER TABLE old_salary_slip ADD COLUMN salary_status VARCHAR(50);
  END IF;
END $$;

SELECT 'old_salary_slip Pay Sheet columns applied.' AS message;
