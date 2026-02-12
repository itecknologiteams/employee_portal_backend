-- Migration: Employee HOD departments (many-to-many: one employee can be HOD of multiple departments).
-- Run on existing DB: psql -U postgres -d employee_portal -f database/migration-employee-hod-departments.sql

CREATE TABLE IF NOT EXISTS employee_hod_departments (
    employee_id INTEGER NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
    department_id INTEGER NOT NULL REFERENCES departments(department_id) ON DELETE CASCADE,
    PRIMARY KEY (employee_id, department_id)
);
CREATE INDEX IF NOT EXISTS idx_employee_hod_departments_department ON employee_hod_departments(department_id);
CREATE INDEX IF NOT EXISTS idx_employee_hod_departments_employee ON employee_hod_departments(employee_id);

SELECT 'employee_hod_departments table created.' AS message;
