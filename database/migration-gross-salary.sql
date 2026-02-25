-- Gross salaries: one stored gross amount per employee (used for list + to derive salary structure).
-- Run once: psql -U postgres -d employee_portal -f database/migration-gross-salary.sql

CREATE TABLE IF NOT EXISTS employee_gross_salary (
    employee_id INTEGER NOT NULL PRIMARY KEY REFERENCES employees(employee_id) ON DELETE CASCADE,
    gross_salary DECIMAL(18,2) NOT NULL CHECK (gross_salary >= 0),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_employee_gross_salary_updated ON employee_gross_salary(updated_at);

COMMENT ON TABLE employee_gross_salary IS 'Stored gross salary per employee; used for Gross Salaries list and to derive employee_salary_structure (basic/medical/hra/utility by join-date rules).';
