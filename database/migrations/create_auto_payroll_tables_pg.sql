-- Automated Payroll System — schema migration
-- Three new tables sit alongside the existing payroll_period / payroll_slip /
-- payroll_period_employee_override tables so the new automated flow can be
-- developed and tested in isolation. Once validated, the legacy tables can
-- be deprecated.

-- 1) Period (one row per payroll month)
CREATE TABLE IF NOT EXISTS auto_payroll_period (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  working_days INTEGER NOT NULL CHECK (working_days > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','processing','processed','published','closed')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by INTEGER,
  processed_at TIMESTAMP,
  published_at TIMESTAMP,
  closed_at TIMESTAMP,
  UNIQUE (start_date, end_date)
);
COMMENT ON COLUMN auto_payroll_period.status IS 'draft → processing → processed → published → closed';

-- 2) Variable monthly entries (allowances + deductions per employee per period)
-- One row per (period, employee, entry_subtype) — UPSERT on conflict.
CREATE TABLE IF NOT EXISTS payroll_entry (
  id SERIAL PRIMARY KEY,
  period_id INTEGER NOT NULL REFERENCES auto_payroll_period(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL,
  entry_type VARCHAR(15) NOT NULL CHECK (entry_type IN ('allowance','deduction')),
  entry_subtype VARCHAR(60) NOT NULL,
  amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  source VARCHAR(40) DEFAULT 'manual',
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by INTEGER,
  UNIQUE (period_id, employee_id, entry_subtype)
);
CREATE INDEX IF NOT EXISTS idx_payroll_entry_period ON payroll_entry(period_id);
CREATE INDEX IF NOT EXISTS idx_payroll_entry_emp ON payroll_entry(employee_id);
COMMENT ON COLUMN payroll_entry.entry_subtype IS
  'For allowances: overtime, incentives_kpi, arrears, incremental_arrears, meal_extra, etc. '
  'For deductions: foodpanda, fuel_overusage, cellphone_installment, device_deduction, '
  'over_utilization_mobile, pandemic, leaves, other_deduction, income_tax';
COMMENT ON COLUMN payroll_entry.source IS
  'manual / excel / loan_req:<reqId> (so loan-installment rows are traceable)';

-- 3) Generated slips (one per employee per period)
CREATE TABLE IF NOT EXISTS auto_payroll_slip (
  id SERIAL PRIMARY KEY,
  period_id INTEGER NOT NULL REFERENCES auto_payroll_period(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL,
  -- Day counts
  effective_working_days INTEGER NOT NULL,
  paid_days INTEGER NOT NULL,
  absent_days INTEGER NOT NULL DEFAULT 0,
  late_count INTEGER NOT NULL DEFAULT 0,
  late_absent_equivalent INTEGER NOT NULL DEFAULT 0,
  unpaid_leave_days INTEGER NOT NULL DEFAULT 0,
  joined_in_period BOOLEAN DEFAULT FALSE,
  left_in_period BOOLEAN DEFAULT FALSE,
  -- Earnings (16 elements)
  basic_salary DECIMAL(18,2) DEFAULT 0,
  medical_allowance DECIMAL(18,2) DEFAULT 0,
  conveyance_fixed DECIMAL(18,2) DEFAULT 0,
  conveyance_liters DECIMAL(18,2) DEFAULT 0,
  communication DECIMAL(18,2) DEFAULT 0,
  house_rent DECIMAL(18,2) DEFAULT 0,
  utilities DECIMAL(18,2) DEFAULT 0,
  overtime DECIMAL(18,2) DEFAULT 0,
  meal_allowance DECIMAL(18,2) DEFAULT 0,
  arrears DECIMAL(18,2) DEFAULT 0,
  incremental_arrears DECIMAL(18,2) DEFAULT 0,
  bike_maintenance DECIMAL(18,2) DEFAULT 0,
  incentives_tech DECIMAL(18,2) DEFAULT 0,
  device_reimbursement DECIMAL(18,2) DEFAULT 0,
  incentives_kpi DECIMAL(18,2) DEFAULT 0,
  other_allowance DECIMAL(18,2) DEFAULT 0,
  -- Deductions (14 elements)
  income_tax DECIMAL(18,2) DEFAULT 0,
  loan DECIMAL(18,2) DEFAULT 0,
  salary_advance DECIMAL(18,2) DEFAULT 0,
  other_deduction DECIMAL(18,2) DEFAULT 0,
  eobi DECIMAL(18,2) DEFAULT 130,
  late_deduction DECIMAL(18,2) DEFAULT 0,
  absent_deduction DECIMAL(18,2) DEFAULT 0,
  device_deduction DECIMAL(18,2) DEFAULT 0,
  cellphone_installment DECIMAL(18,2) DEFAULT 0,
  foodpanda_deduction DECIMAL(18,2) DEFAULT 0,
  fuel_overusage_deduction DECIMAL(18,2) DEFAULT 0,
  over_utilization_mobile DECIMAL(18,2) DEFAULT 0,
  pandemic_deduction DECIMAL(18,2) DEFAULT 0,
  leaves_deduction DECIMAL(18,2) DEFAULT 0,
  -- Totals
  tot_gross DECIMAL(18,2) DEFAULT 0,
  tot_allowances DECIMAL(18,2) DEFAULT 0,
  tot_deductions DECIMAL(18,2) DEFAULT 0,
  tot_net DECIMAL(18,2) DEFAULT 0,
  -- Status & audit
  status VARCHAR(15) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','overridden','published')),
  remarks TEXT,
  audit_log JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (period_id, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_auto_slip_period ON auto_payroll_slip(period_id);
CREATE INDEX IF NOT EXISTS idx_auto_slip_emp ON auto_payroll_slip(employee_id);

-- Trigger to maintain updated_at on slip
CREATE OR REPLACE FUNCTION trg_auto_payroll_slip_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS auto_payroll_slip_updated_at ON auto_payroll_slip;
CREATE TRIGGER auto_payroll_slip_updated_at
  BEFORE UPDATE ON auto_payroll_slip
  FOR EACH ROW EXECUTE FUNCTION trg_auto_payroll_slip_updated_at();

SELECT 'Auto payroll tables created.' AS message;
