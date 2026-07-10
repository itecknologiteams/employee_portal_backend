-- ============================================================================
-- iTecknologi Payroll — fiscal year + transactional (element-normalized) tables
-- PostgreSQL. Run inside the iteck_payroll database, AFTER 01-payroll-fundamentals-pg.sql.
--
-- Design idea: instead of one wide payroll_slip with a fixed column per element
-- (which breaks whenever a new element is added), every amount is a ROW keyed by
-- element_id. Adding a new pay element = one row in payroll_elements — NO schema
-- change, NO code change to the slip tables. This is what makes automated payroll
-- flexible and future-proof.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 4) Payroll Fiscal Year — parent of payroll_period.fyid (Pakistani FY: Jul 1 – Jun 30)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payroll_fiscal_year (
  fyid        SMALLINT     PRIMARY KEY,
  fy_label    VARCHAR(20)  NOT NULL,      -- e.g. '2024-2025'
  start_date  DATE         NOT NULL,      -- 1 July
  end_date    DATE         NOT NULL,      -- 30 June
  is_closed   SMALLINT     NOT NULL DEFAULT 0,   -- 0 = open, 1 = closed
  CONSTRAINT uq_payroll_fiscal_year_label UNIQUE (fy_label)
);

-- New payroll system starts here: FY 2026-2027 (currently in progress). Older years
-- are shown via old_salary_slip in the portal and are NOT tracked in this DB.
-- Add the next fiscal year as fyid = 2 ('2027-2028'), and so on, when it begins.
INSERT INTO payroll_fiscal_year (fyid, fy_label, start_date, end_date, is_closed) VALUES
  (1, '2026-2027', '2026-07-01', '2027-06-30', 0)
ON CONFLICT (fyid) DO NOTHING;

-- Wire payroll_period.fyid → payroll_fiscal_year now that the parent exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_payroll_period_fyid' AND table_name = 'payroll_period'
  ) THEN
    ALTER TABLE payroll_period
      ADD CONSTRAINT fk_payroll_period_fyid
      FOREIGN KEY (fyid) REFERENCES payroll_fiscal_year(fyid);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5) Employee salary structure — each employee's standing amount per element.
--    This is the TEMPLATE used to generate a monthly run. One current row per
--    (employee, element). No FK to employees: that table lives in the portal DB.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employee_payroll_element (
  id              BIGSERIAL     PRIMARY KEY,
  employee_id     INTEGER       NOT NULL,           -- portal employees.employee_id (no cross-DB FK)
  element_id      SMALLINT      NOT NULL REFERENCES payroll_elements(element_id),
  amount          NUMERIC(18,2) NOT NULL DEFAULT 0,
  is_active       SMALLINT      NOT NULL DEFAULT 1, -- 0/1
  effective_from  DATE          NULL,
  effective_to    DATE          NULL,
  created_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_emp_element UNIQUE (employee_id, element_id)
);
CREATE INDEX IF NOT EXISTS idx_emp_element_employee ON employee_payroll_element(employee_id);
CREATE INDEX IF NOT EXISTS idx_emp_element_element  ON employee_payroll_element(element_id);

-- ---------------------------------------------------------------------------
-- 6) Payroll Slip (header) — one row per employee per payroll period.
--    Aggregates are stored for fast reads; the source of truth is the line items (7).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payroll_slip (
  slip_id           BIGSERIAL     PRIMARY KEY,
  payroll_id        INTEGER       NOT NULL REFERENCES payroll_period(payroll_id),
  employee_id       INTEGER       NOT NULL,          -- portal employees.employee_id (no cross-DB FK)
  working_days      NUMERIC(5,1)  NOT NULL DEFAULT 0,
  paid_days         NUMERIC(5,1)  NOT NULL DEFAULT 0,
  absent_days       NUMERIC(5,1)  NOT NULL DEFAULT 0,
  gross_salary      NUMERIC(18,2) NOT NULL DEFAULT 0,   -- Σ allowance line items
  total_allowances  NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_deductions  NUMERIC(18,2) NOT NULL DEFAULT 0,   -- Σ deduction line items
  net_salary        NUMERIC(18,2) NOT NULL DEFAULT 0,   -- gross − deductions (± adjust)
  status            VARCHAR(30)   NOT NULL DEFAULT 'Generated',
  slip_on_hold      BOOLEAN       NOT NULL DEFAULT FALSE,
  remarks           TEXT,
  created_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_payroll_slip UNIQUE (payroll_id, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_payroll_slip_payroll  ON payroll_slip(payroll_id);
CREATE INDEX IF NOT EXISTS idx_payroll_slip_employee ON payroll_slip(employee_id);

-- ---------------------------------------------------------------------------
-- 7) Payroll Slip Element (line items) — the actual amount of each element on a slip.
--    THE flexible core: one row per element. New elements need no schema change.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payroll_slip_element (
  id          BIGSERIAL     PRIMARY KEY,
  slip_id     BIGINT        NOT NULL REFERENCES payroll_slip(slip_id) ON DELETE CASCADE,
  element_id  SMALLINT      NOT NULL REFERENCES payroll_elements(element_id),
  amount      NUMERIC(18,2) NOT NULL DEFAULT 0,
  CONSTRAINT uq_slip_element UNIQUE (slip_id, element_id)
);
CREATE INDEX IF NOT EXISTS idx_slip_element_slip    ON payroll_slip_element(slip_id);
CREATE INDEX IF NOT EXISTS idx_slip_element_element ON payroll_slip_element(element_id);

-- ---------------------------------------------------------------------------
-- Helper views (derive totals from the line items — single source of truth)
-- ---------------------------------------------------------------------------

-- Gross / total deductions / net per slip, from the element rows and their type.
CREATE OR REPLACE VIEW v_payroll_slip_totals AS
SELECT
  se.slip_id,
  COALESCE(SUM(se.amount) FILTER (WHERE e.element_type = 'Allowance'), 0) AS gross_salary,
  COALESCE(SUM(se.amount) FILTER (WHERE e.element_type = 'Deduction'), 0) AS total_deductions,
  COALESCE(SUM(se.amount) FILTER (WHERE e.element_type = 'Allowance'), 0)
    - COALESCE(SUM(se.amount) FILTER (WHERE e.element_type = 'Deduction'), 0) AS net_salary
FROM payroll_slip_element se
JOIN payroll_elements e ON e.element_id = se.element_id
GROUP BY se.slip_id;

-- Taxable "Total Income" per slip = the 6 HR-defined elements:
--   Basic(1) + Medical(2) + House Rent(5) + Utilities(6) + Incentives Tech(10) + Incremental Arrears(31).
-- (Kept as an explicit id list to match HR's rule; see note about an is_taxable flag.)
CREATE OR REPLACE VIEW v_payroll_taxable_income AS
SELECT
  se.slip_id,
  COALESCE(SUM(se.amount), 0) AS taxable_income
FROM payroll_slip_element se
WHERE se.element_id IN (1, 2, 5, 6, 10, 31)
GROUP BY se.slip_id;
