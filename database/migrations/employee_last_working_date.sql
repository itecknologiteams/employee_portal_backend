-- Add last_working_date column to employees table
ALTER TABLE employees ADD COLUMN IF NOT EXISTS last_working_date DATE;

-- Index for quick lookup of inactive employees by last working date
CREATE INDEX IF NOT EXISTS idx_employees_last_working_date ON employees(last_working_date) WHERE last_working_date IS NOT NULL;
