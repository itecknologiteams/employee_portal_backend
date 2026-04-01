-- Per-employee: when salary_slip_on_hold is true, employee cannot list/view/download salary slips.
-- HR users with view_salary_slips permission bypass this when viewing any employee.
-- Default false = active (slips visible to the employee).

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS salary_slip_on_hold BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN employees.salary_slip_on_hold IS 'If true, employee portal hides salary slips until cleared; HR with view_salary_slips can still view.';
