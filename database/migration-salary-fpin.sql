-- Salary FPIN: store hashed PIN per employee for viewing salary slip.
-- Run against employee_portal (PostgreSQL).

CREATE TABLE IF NOT EXISTS salary_fpin (
  employee_id INTEGER PRIMARY KEY REFERENCES employees(employee_id) ON DELETE CASCADE,
  pin_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_salary_fpin_employee_id ON salary_fpin(employee_id);

SELECT 'salary_fpin table created.' AS message;
