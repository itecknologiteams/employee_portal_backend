-- Income Tax Slab: separate table so payroll mixed up na ho. Multiple versions (e.g. FY2025-26) support.
-- Run: psql -U postgres -d your_db -f database/migration-income-tax-slab-pg.sql

-- 1) Table: tax slab version (name + which one is active)
CREATE TABLE IF NOT EXISTS income_tax_slab_version (
  id SERIAL PRIMARY KEY,
  version_name VARCHAR(100) NOT NULL UNIQUE,
  effective_from DATE,
  is_active BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2) Table: slab rows (min, max, taxable amount at start of bracket, percent) – per version
CREATE TABLE IF NOT EXISTS income_tax_slab (
  id SERIAL PRIMARY KEY,
  slab_version_id INTEGER NOT NULL REFERENCES income_tax_slab_version(id) ON DELETE CASCADE,
  min_amt DECIMAL(18,2) NOT NULL,
  max_amt DECIMAL(18,2) NOT NULL,
  taxable_amt DECIMAL(18,2) NOT NULL DEFAULT 0,
  tax_percent DECIMAL(8,2) NOT NULL DEFAULT 0,
  display_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_income_tax_slab_version ON income_tax_slab(slab_version_id);

-- 3) Only one active version
CREATE UNIQUE INDEX IF NOT EXISTS idx_income_tax_slab_version_active
  ON income_tax_slab_version(id) WHERE is_active = true;

-- 4) Insert default version (latest Pakistan slab you provided)
INSERT INTO income_tax_slab_version (version_name, effective_from, is_active)
SELECT 'FY2025-26', CURRENT_DATE, true
WHERE NOT EXISTS (SELECT 1 FROM income_tax_slab_version WHERE version_name = 'FY2025-26');

-- 5) Insert default slabs for FY2025-26 (only if no slabs for this version yet)
INSERT INTO income_tax_slab (slab_version_id, min_amt, max_amt, taxable_amt, tax_percent, display_order)
SELECT v.id, s.min_amt, s.max_amt, s.taxable_amt, s.tax_percent, s.display_order
FROM income_tax_slab_version v
CROSS JOIN (VALUES
  (0::decimal, 600000::decimal, 0::decimal, 0::decimal, 1),
  (600001, 1200000, 0, 1, 2),
  (1200001, 2200000, 6000, 11, 3),
  (2200001, 3200000, 116000, 23, 4),
  (3200001, 4100000, 346000, 30, 5),
  (4100001, 999999999, 616000, 35, 6)
) AS s(min_amt, max_amt, taxable_amt, tax_percent, display_order)
WHERE v.version_name = 'FY2025-26'
AND NOT EXISTS (SELECT 1 FROM income_tax_slab s2 WHERE s2.slab_version_id = v.id);

-- 6) Add income_tax column to payroll_slip if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'payroll_slip' AND column_name = 'income_tax') THEN
    ALTER TABLE payroll_slip ADD COLUMN income_tax DECIMAL(18,2) DEFAULT 0;
  END IF;
END $$;

SELECT 'Income tax slab tables and payroll_slip.income_tax applied.' AS message;
