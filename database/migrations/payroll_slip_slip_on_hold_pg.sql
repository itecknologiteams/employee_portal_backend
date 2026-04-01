-- Per slip per month: when slip_on_hold is true, employee portal hides this period's slip only.
-- HR (View Salary Slips) still sees all. Default false = visible to employee.

ALTER TABLE payroll_slip
  ADD COLUMN IF NOT EXISTS slip_on_hold BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN payroll_slip.slip_on_hold IS 'If true, employee cannot see this month slip until cleared; payroll UI can toggle.';
