-- ============================================================================
-- iTecknologi Payroll — separate database, fundamental (reference) tables
-- PostgreSQL. Run the CREATE DATABASE block first (Part A) while connected to
-- another DB (e.g. "postgres"), then run Part B + C inside the new database.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- PART A — create the database (run standalone; cannot run inside a transaction)
-- ---------------------------------------------------------------------------
-- CREATE DATABASE iteck_payroll WITH ENCODING 'UTF8';
-- Then connect to it:  \c iteck_payroll
-- (psql: run the line above; from a GUI, just open a connection to iteck_payroll.)

-- ---------------------------------------------------------------------------
-- PART B — schema (run while connected to iteck_payroll)
-- ---------------------------------------------------------------------------

-- 1) Payroll Month — the 12 fiscal-year months (July → June).
CREATE TABLE IF NOT EXISTS payroll_month (
  mnth_id          SMALLINT     PRIMARY KEY,          -- fiscal sequence (1 = July … 12 = June)
  mnth_no          SMALLINT     NOT NULL,             -- calendar month number (1–12)
  mnth_name        VARCHAR(20)  NOT NULL,
  mnth_short_name  VARCHAR(10)  NOT NULL,
  CONSTRAINT uq_payroll_month_no UNIQUE (mnth_no)
);

-- 2) Payroll Elements — the catalog of pay/deduction/adjust components.
CREATE TABLE IF NOT EXISTS payroll_elements (
  element_id        SMALLINT     PRIMARY KEY,          -- fixed ids (note: 30 is intentionally unused)
  element_name      VARCHAR(100) NOT NULL,
  element_type      VARCHAR(20)  NOT NULL,             -- Allowance | Deduction | Adjust
  element_category  VARCHAR(30)  NOT NULL,             -- Fixed Gross | Additional | Fixed Additional | Adjust
  cal_type          VARCHAR(20)  NOT NULL,             -- Fixed | Calculate | Adjust
  seq_no            SMALLINT     NULL,                 -- display order within its type (NULL for Adjust)
  CONSTRAINT chk_element_type CHECK (element_type IN ('Allowance', 'Deduction', 'Adjust'))
);

-- 3) Payroll Period — one row per (fiscal year, month); tracks finalisation flags.
CREATE TABLE IF NOT EXISTS payroll_period (
  payroll_id      INTEGER   PRIMARY KEY,               -- surrogate id for the FY+month row
  period_id       INTEGER   NOT NULL,                  -- period grouping (per fiscal year)
  fyid            INTEGER   NOT NULL,                  -- fiscal year id (→ future payroll_fiscal_year)
  mnth_id         SMALLINT  NOT NULL REFERENCES payroll_month(mnth_id),
  period_status   SMALLINT  NOT NULL DEFAULT 0,        -- 0 = open, 1 = active/locked
  payroll_final   SMALLINT  NOT NULL DEFAULT 0,        -- 0/1
  paysheet_final  SMALLINT  NOT NULL DEFAULT 0,        -- 0/1
  CONSTRAINT uq_payroll_period_fy_month UNIQUE (fyid, mnth_id)
);
CREATE INDEX IF NOT EXISTS idx_payroll_period_fyid ON payroll_period(fyid);
CREATE INDEX IF NOT EXISTS idx_payroll_period_mnth ON payroll_period(mnth_id);

-- ---------------------------------------------------------------------------
-- PART C — seed data (idempotent: re-running keeps existing rows unchanged)
-- ---------------------------------------------------------------------------

-- Payroll Month
INSERT INTO payroll_month (mnth_id, mnth_no, mnth_name, mnth_short_name) VALUES
  (1,  7,  'July',      'Jul'),
  (2,  8,  'August',    'Aug'),
  (3,  9,  'September', 'Sep'),
  (4,  10, 'October',   'Oct'),
  (5,  11, 'November',  'Nov'),
  (6,  12, 'December',  'Dec'),
  (7,  1,  'January',   'Jan'),
  (8,  2,  'February',  'Feb'),
  (9,  3,  'March',     'Mar'),
  (10, 4,  'April',     'Apr'),
  (11, 5,  'May',       'May'),
  (12, 6,  'June',      'Jun')
ON CONFLICT (mnth_id) DO NOTHING;

-- Payroll Elements
INSERT INTO payroll_elements (element_id, element_name, element_type, element_category, cal_type, seq_no) VALUES
  (1,  'Basic Salary',                'Allowance', 'Fixed Gross',      'Fixed',     1),
  (2,  'Medical Allowance',           'Allowance', 'Fixed Gross',      'Fixed',     2),
  (3,  'Conveyance Fixed Allowance',  'Allowance', 'Fixed Gross',      'Fixed',     3),
  (4,  'Overtime Allowance',          'Allowance', 'Additional',       'Calculate', 8),
  (5,  'House Rent Allowance',        'Allowance', 'Fixed Gross',      'Fixed',     6),
  (6,  'Utilities Allowance',         'Allowance', 'Fixed Gross',      'Fixed',     7),
  (7,  'Meal Allowance',              'Allowance', 'Fixed Additional', 'Calculate', 9),
  (8,  'Arrears',                     'Allowance', 'Additional',       'Fixed',     10),
  (9,  'Bike Maintainence',           'Allowance', 'Fixed Additional', 'Calculate', 12),
  (10, 'Incentives Tech',             'Allowance', 'Additional',       'Fixed',     13),
  (11, 'Device Reimbursment',         'Allowance', 'Additional',       'Fixed',     15),
  (12, 'Communication',               'Allowance', 'Fixed Gross',      'Fixed',     5),
  (13, 'Incentives KPI',              'Allowance', 'Additional',       'Fixed',     14),
  (14, 'Other Allowance',             'Allowance', 'Additional',       'Fixed',     16),
  (15, 'Loan',                        'Deduction', 'Additional',       'Fixed',     3),
  (16, 'Advance Salary',              'Deduction', 'Additional',       'Fixed',     4),
  (17, 'EOBI',                        'Deduction', 'Fixed Gross',      'Fixed',     1),
  (18, 'Income Tax',                  'Deduction', 'Additional',       'Fixed',     2),
  (19, 'Absent Days',                 'Deduction', 'Additional',       'Calculate', 3),
  (20, 'Device Deduction',            'Deduction', 'Additional',       'Fixed',     4),
  (21, 'Over Utilization Mobile',     'Deduction', 'Additional',       'Fixed',     5),
  (22, 'Vehicle Fuel Deduction',      'Deduction', 'Additional',       'Calculate', 6),
  (23, 'Pandamic Deduction',          'Deduction', 'Additional',       'Fixed',     7),
  (24, 'Late Days',                   'Deduction', 'Additional',       'Calculate', 8),
  (25, 'Other Deduction',             'Deduction', 'Additional',       'Fixed',     11),
  (26, 'Mobile Installment',          'Deduction', 'Additional',       'Fixed',     9),
  (27, 'Food Panda',                  'Deduction', 'Additional',       'Fixed',     10),
  (28, 'Conveyance Liters Allowance', 'Allowance', 'Fixed Gross',      'Fixed',     4),
  (29, 'Leaves',                      'Adjust',    'Adjust',           'Adjust',    NULL),
  (31, 'Incremental Arrears',         'Allowance', 'Additional',       'Fixed',     11)
ON CONFLICT (element_id) DO NOTHING;

-- Payroll Period — new system starts at FY 2026-2027 (fyid = 1). Older years are
-- NOT tracked here; that historical data is shown via old_salary_slip in the portal.
-- All 12 months seeded as open/not-final; mark them active/final as payroll is run.
INSERT INTO payroll_period (payroll_id, period_id, fyid, mnth_id, period_status, payroll_final, paysheet_final) VALUES
  (1,  1, 1, 1,  0, 0, 0),   -- July 2026
  (2,  1, 1, 2,  0, 0, 0),   -- August 2026
  (3,  1, 1, 3,  0, 0, 0),   -- September 2026
  (4,  1, 1, 4,  0, 0, 0),   -- October 2026
  (5,  1, 1, 5,  0, 0, 0),   -- November 2026
  (6,  1, 1, 6,  0, 0, 0),   -- December 2026
  (7,  1, 1, 7,  0, 0, 0),   -- January 2027
  (8,  1, 1, 8,  0, 0, 0),   -- February 2027
  (9,  1, 1, 9,  0, 0, 0),   -- March 2027
  (10, 1, 1, 10, 0, 0, 0),   -- April 2027
  (11, 1, 1, 11, 0, 0, 0),   -- May 2027
  (12, 1, 1, 12, 0, 0, 0)    -- June 2027
ON CONFLICT (payroll_id) DO NOTHING;
