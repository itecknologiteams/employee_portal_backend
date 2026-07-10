-- ============================================================================
-- iTecknologi Payroll — per-period manual element values (allowance/deduction sheets)
-- PostgreSQL. Run inside iteck_payroll, AFTER 01-03.
--
-- Holds the MANUALLY-entered, month-specific amounts that HR uploads via the
-- Allowance / Deduction sheets (overtime, incentives, arrears, late, fuel, etc.).
-- These are NOT part of the standing structure (employee_payroll_element) and NOT
-- the auto/derived ones (Basic/Medical/House/Utilities from gross, Income Tax, EOBI,
-- Loan/Advance). Slip generation merges: structure + period elements + loan installments
-- + auto income tax.
-- ============================================================================

CREATE TABLE IF NOT EXISTS payroll_period_element (
  id           BIGSERIAL     PRIMARY KEY,
  payroll_id   INTEGER       NOT NULL REFERENCES payroll_period(payroll_id),
  employee_id  INTEGER       NOT NULL,          -- portal employees.employee_id (no cross-DB FK)
  element_id   SMALLINT      NOT NULL REFERENCES payroll_elements(element_id),
  amount       NUMERIC(18,2) NOT NULL DEFAULT 0,
  updated_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_period_element UNIQUE (payroll_id, employee_id, element_id)
);
CREATE INDEX IF NOT EXISTS idx_period_element_period ON payroll_period_element(payroll_id);
CREATE INDEX IF NOT EXISTS idx_period_element_emp    ON payroll_period_element(payroll_id, employee_id);
