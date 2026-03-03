-- Requisition categories table: one row per category, flow flags as 0/1 (SMALLINT)
-- Columns match CSV: HOD (For Info vs Approval), HR/Finance, Committee, Department, Quotations, Final Committee, CEO, Execution

CREATE TABLE IF NOT EXISTS requisition_category (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL UNIQUE,
  hod_for_info SMALLINT NOT NULL DEFAULT 0 CHECK (hod_for_info IN (0, 1)),
  hod_approval SMALLINT NOT NULL DEFAULT 0 CHECK (hod_approval IN (0, 1)),
  hr_finance SMALLINT NOT NULL DEFAULT 0 CHECK (hr_finance IN (0, 1)),
  committee_review SMALLINT NOT NULL DEFAULT 0 CHECK (committee_review IN (0, 1)),
  department_admin SMALLINT NOT NULL DEFAULT 0 CHECK (department_admin IN (0, 1)),
  department_finance SMALLINT NOT NULL DEFAULT 0 CHECK (department_finance IN (0, 1)),
  department_procurement SMALLINT NOT NULL DEFAULT 0 CHECK (department_procurement IN (0, 1)),
  quotations SMALLINT NOT NULL DEFAULT 0 CHECK (quotations IN (0, 1)),
  final_committee SMALLINT NOT NULL DEFAULT 0 CHECK (final_committee IN (0, 1)),
  ceo_approve SMALLINT NOT NULL DEFAULT 0 CHECK (ceo_approve IN (0, 1)),
  execution_admin SMALLINT NOT NULL DEFAULT 0 CHECK (execution_admin IN (0, 1)),
  execution_finance SMALLINT NOT NULL DEFAULT 0 CHECK (execution_finance IN (0, 1)),
  execution_procurement SMALLINT NOT NULL DEFAULT 0 CHECK (execution_procurement IN (0, 1)),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_requisition_category_name ON requisition_category(name);

COMMENT ON TABLE requisition_category IS 'Requisition categories and their flow flags (from CSV). Used for routing and display.';

-- Seed from CSV (1.csv)
INSERT INTO requisition_category (name, hod_for_info, hod_approval, hr_finance, committee_review, department_admin, department_finance, department_procurement, quotations, final_committee, ceo_approve, execution_admin, execution_finance, execution_procurement)
VALUES
  ('Stationary', 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0),
  ('Vehicle Maintenance', 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0),
  ('Vehicle Repair', 1, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 0, 0),
  ('Other Repair & Maintenance', 1, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 0, 0),
  ('Loan & Advance Salary', 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0),
  ('Event', 0, 1, 0, 0, 0, 0, 1, 1, 0, 1, 0, 0, 1),
  ('Specialized Projects', 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1),
  ('IT Equipments', 0, 0, 0, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1),
  ('General Procurements Grocerry & Others', 0, 0, 0, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1),
  ('General Procurements Electric Appliances', 0, 0, 0, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1),
  ('Devices / Accessories', 0, 0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1)
ON CONFLICT (name) DO NOTHING;

-- Optional: add FK from requisition to category (by name) – requisition already has req_category VARCHAR; we can keep it and join on name
-- No schema change to requisition needed if req_category stores the category name.

SELECT 'Requisition categories table created and seeded.' AS message;
