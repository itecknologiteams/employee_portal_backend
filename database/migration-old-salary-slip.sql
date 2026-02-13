-- Migration: old_salary_slip table for legacy salary slips imported from SQL Server.
-- Run on existing DB: psql -U postgres -d employee_portal -f database/migration-old-salary-slip.sql
-- This table only holds old/historical slip data; new slips come from payroll_slip.

CREATE TABLE IF NOT EXISTS old_salary_slip (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
    pay_month DATE NOT NULL,
    period_label VARCHAR(100),
    basic_salary DECIMAL(18,2) DEFAULT 0,
    gross_salary DECIMAL(18,2) DEFAULT 0,
    total_allowances DECIMAL(18,2) DEFAULT 0,
    total_deductions DECIMAL(18,2) DEFAULT 0,
    net_salary DECIMAL(18,2) NOT NULL,
    status VARCHAR(50) DEFAULT 'Paid',
    remarks TEXT,
    source_employee_code VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_old_salary_slip_employee ON old_salary_slip(employee_id);
CREATE INDEX IF NOT EXISTS idx_old_salary_slip_pay_month ON old_salary_slip(pay_month);

SELECT 'old_salary_slip table created.' AS message;
