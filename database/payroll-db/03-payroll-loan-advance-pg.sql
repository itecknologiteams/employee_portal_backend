-- ============================================================================
-- iTecknologi Payroll — Loan & Advance Salary + installment schedule
-- PostgreSQL. Run inside iteck_payroll, AFTER 01 and 02.
--
-- Covers BOTH kinds of recoverable advances (distinguished by element_id):
--   element_id 15 = Loan, element_id 16 = Advance Salary  (already in payroll_elements).
-- A loan/advance is disbursed once, then recovered as a monthly DEDUCTION element on
-- the payroll slip across several periods. The installment rows are the recovery
-- schedule; each links to the payroll_period it is deducted in (and, once run, to the slip).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 8) Loan / Advance header — one row per disbursed loan or advance.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payroll_loan (
  loan_id             BIGSERIAL     PRIMARY KEY,
  source_req_id       INTEGER       NULL,               -- originating employee_portal.requisition.req_id (for idempotent sync)
  employee_id         INTEGER       NOT NULL,           -- portal employees.employee_id (no cross-DB FK)
  element_id          SMALLINT      NOT NULL REFERENCES payroll_elements(element_id),  -- 15 Loan | 16 Advance
  principal_amount    NUMERIC(18,2) NOT NULL,           -- total disbursed / to be recovered
  installment_amount  NUMERIC(18,2) NOT NULL,           -- standard per-month recovery
  total_installments  SMALLINT      NOT NULL,           -- number of scheduled installments
  start_payroll_id    INTEGER       NOT NULL REFERENCES payroll_period(payroll_id),  -- first recovery period
  status              VARCHAR(20)   NOT NULL DEFAULT 'Active',  -- Active | Completed | Cancelled
  disbursed_on        DATE          NULL,
  remarks             TEXT,
  created_at          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_loan_element     CHECK (element_id IN (15, 16)),
  CONSTRAINT chk_loan_principal   CHECK (principal_amount > 0),
  CONSTRAINT chk_loan_installment CHECK (installment_amount > 0),
  -- Employee may request up to 10 installments; HR may raise it to 20 (exceptional, with reason).
  -- 20 is the hard ceiling for both Loan and Advance Salary.
  CONSTRAINT chk_loan_count       CHECK (total_installments BETWEEN 1 AND 20),
  CONSTRAINT chk_loan_status      CHECK (status IN ('Active', 'Completed', 'Cancelled'))
);
CREATE INDEX IF NOT EXISTS idx_payroll_loan_employee ON payroll_loan(employee_id);
CREATE INDEX IF NOT EXISTS idx_payroll_loan_status   ON payroll_loan(status);
-- One payroll_loan per source requisition (idempotent sync from the requisition flow).
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_loan_source_req
  ON payroll_loan(source_req_id) WHERE source_req_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 9) Loan / Advance installment — the recovery schedule (one row per installment).
--    amount = scheduled; deducted_amount = what payroll actually took (partial/skip aware).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payroll_loan_installment (
  installment_id    BIGSERIAL     PRIMARY KEY,
  loan_id           BIGINT        NOT NULL REFERENCES payroll_loan(loan_id) ON DELETE CASCADE,
  payroll_id        INTEGER       NOT NULL REFERENCES payroll_period(payroll_id),  -- month it is due
  installment_no    SMALLINT      NOT NULL,
  amount            NUMERIC(18,2) NOT NULL,             -- scheduled amount for this month
  deducted_amount   NUMERIC(18,2) NOT NULL DEFAULT 0,   -- actually recovered when payroll ran
  status            VARCHAR(20)   NOT NULL DEFAULT 'Pending',  -- Pending | Deducted | Skipped | Waived
  slip_id           BIGINT        NULL REFERENCES payroll_slip(slip_id) ON DELETE SET NULL,  -- slip it was deducted on
  created_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_loan_installment_no  UNIQUE (loan_id, installment_no),
  CONSTRAINT chk_installment_status  CHECK (status IN ('Pending', 'Deducted', 'Skipped', 'Waived')),
  CONSTRAINT chk_installment_amount  CHECK (amount >= 0)
);
CREATE INDEX IF NOT EXISTS idx_loan_installment_loan    ON payroll_loan_installment(loan_id);
CREATE INDEX IF NOT EXISTS idx_loan_installment_payroll ON payroll_loan_installment(payroll_id);
CREATE INDEX IF NOT EXISTS idx_loan_installment_status  ON payroll_loan_installment(status);

-- ---------------------------------------------------------------------------
-- Outstanding balance per loan = principal − total recovered so far.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_payroll_loan_balance AS
SELECT
  l.loan_id,
  l.employee_id,
  l.element_id,
  l.principal_amount,
  COALESCE(SUM(i.deducted_amount), 0)                          AS recovered_amount,
  l.principal_amount - COALESCE(SUM(i.deducted_amount), 0)     AS outstanding_amount,
  COUNT(i.installment_id) FILTER (WHERE i.status = 'Pending')  AS pending_installments,
  l.status
FROM payroll_loan l
LEFT JOIN payroll_loan_installment i ON i.loan_id = l.loan_id
GROUP BY l.loan_id, l.employee_id, l.element_id, l.principal_amount, l.status;
