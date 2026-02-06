-- Add selected city to employees (PostgreSQL).
-- Run this so /api/administration/employees returns only the selected city in city_name.
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS city_id INTEGER REFERENCES city(city_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_employees_city ON employees(city_id);
