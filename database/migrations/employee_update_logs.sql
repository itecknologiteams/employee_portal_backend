-- Migration: Employee Update Logs Table
-- Tracks all official information changes: salary increments, department transfers, designation changes
-- Created: 2026-04-06

CREATE TABLE IF NOT EXISTS employee_update_logs (
  id              SERIAL PRIMARY KEY,
  employee_id     INTEGER NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
  change_type     VARCHAR(50) NOT NULL,
  -- Valid values: 'salary_increment' | 'department_transfer' | 'designation_change' | 'general_info'
  field_changed   VARCHAR(100),
  old_value       TEXT,
  new_value       TEXT,
  remarks         TEXT,
  effective_date  DATE,
  updated_by      INTEGER REFERENCES employees(employee_id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_employee_update_logs_emp ON employee_update_logs(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_update_logs_type ON employee_update_logs(change_type);
CREATE INDEX IF NOT EXISTS idx_employee_update_logs_created ON employee_update_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_employee_update_logs_effective ON employee_update_logs(effective_date DESC);

-- Comments for documentation
COMMENT ON TABLE employee_update_logs IS 'Audit trail for all employee official information changes including salary, department, designation updates';
COMMENT ON COLUMN employee_update_logs.change_type IS 'Type of change: salary_increment, department_transfer, designation_change, or general_info';
COMMENT ON COLUMN employee_update_logs.field_changed IS 'Specific field that was modified (e.g., department_id, designation_id, gross_salary)';
COMMENT ON COLUMN employee_update_logs.old_value IS 'Previous value before the change';
COMMENT ON COLUMN employee_update_logs.new_value IS 'New value after the change';
COMMENT ON COLUMN employee_update_logs.effective_date IS 'When the change takes effect (for salary increments, transfers)';
COMMENT ON COLUMN employee_update_logs.updated_by IS 'Employee ID of the admin who made the change';

-- Verify the table was created
SELECT 
    column_name, 
    data_type,
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'employee_update_logs'
ORDER BY ordinal_position;
