BEGIN;

CREATE TABLE IF NOT EXISTS leave_deduction_log (
  deduction_id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
  leave_type VARCHAR(20) NOT NULL CHECK (leave_type IN ('annual', 'casual', 'sick', 'marriage', 'maternity', 'paternal', 'pilgrimage')),
  days_deducted INTEGER NOT NULL CHECK (days_deducted > 0),
  reason TEXT NOT NULL,
  deducted_by_employee_id INTEGER NOT NULL REFERENCES employees(employee_id) ON DELETE RESTRICT,
  balance_before INTEGER NOT NULL CHECK (balance_before >= 0),
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_leave_deduction_log_employee ON leave_deduction_log(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_deduction_log_hr ON leave_deduction_log(deducted_by_employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_deduction_log_created_at ON leave_deduction_log(created_at DESC);

COMMIT;
