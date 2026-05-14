-- 1) Allow new event types (probation lifecycle was missing in original CHECK)
ALTER TABLE employee_record_history DROP CONSTRAINT IF EXISTS employee_record_history_record_type_check;
ALTER TABLE employee_record_history ADD CONSTRAINT employee_record_history_record_type_check
  CHECK (record_type IN (
    'salary_change','department_change','designation_change','employee_type_change',
    'confirmation','probation_start','probation_extended',
    'joining','last_working_date','rehire','location_change','grade_change','other'
  ));

-- 2) Soft-delete + edit metadata (audit-trail safe — nothing is hard-deleted)
ALTER TABLE employee_record_history ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE employee_record_history ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE employee_record_history ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES employees(employee_id);
ALTER TABLE employee_record_history ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP;
ALTER TABLE employee_record_history ADD COLUMN IF NOT EXISTS edited_by INTEGER REFERENCES employees(employee_id);

-- 3) Approver name + designation as free text (approver may be CEO, an external auditor, etc., not always an employees row)
ALTER TABLE employee_record_history ADD COLUMN IF NOT EXISTS approver_name VARCHAR(200);
ALTER TABLE employee_record_history ADD COLUMN IF NOT EXISTS approver_designation VARCHAR(200);

-- 4) Useful index for timeline queries
CREATE INDEX IF NOT EXISTS idx_emp_history_not_deleted
  ON employee_record_history(employee_id, effective_date DESC)
  WHERE is_deleted = FALSE;
