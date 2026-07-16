-- Tax Certificate Sheet (Employee Portal) — SuperAdmin-uploaded annual income-tax register.
-- One row per employee per fiscal year. HR uploads this; it is the source of truth for the
-- Administration "Tax Certificate Sheet" preview + download. Run against PostgreSQL after backup.

CREATE TABLE IF NOT EXISTS tax_certificate_sheet (
  id SERIAL PRIMARY KEY,
  employee_code TEXT NOT NULL,
  fiscal_year TEXT NOT NULL,
  employee_name TEXT,
  designation TEXT,
  department TEXT,
  cnic TEXT,
  ntn TEXT,
  status TEXT,
  address TEXT,
  total_income NUMERIC(18,2),
  total_tax NUMERIC(18,2),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT uq_tax_cert_sheet_emp_fy UNIQUE (employee_code, fiscal_year)
);

CREATE INDEX IF NOT EXISTS idx_tax_cert_sheet_fy ON tax_certificate_sheet (fiscal_year);
