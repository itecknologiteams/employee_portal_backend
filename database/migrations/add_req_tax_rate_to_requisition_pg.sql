-- Link a requisition to the sales tax rate applied at save time (going-forward only).
-- req_tax_rate_id: FK to the sales_tax_rate history row used.
-- req_tax_rate_percent: snapshot of that rate (percent) for easy display without a join.
ALTER TABLE requisition
  ADD COLUMN IF NOT EXISTS req_tax_rate_id INTEGER REFERENCES sales_tax_rate(id);

ALTER TABLE requisition
  ADD COLUMN IF NOT EXISTS req_tax_rate_percent NUMERIC(5,2);

COMMENT ON COLUMN requisition.req_tax_rate_id IS
  'sales_tax_rate row applied to this requisition''s IT Equipment items (NULL for non-IT or pre-feature).';
COMMENT ON COLUMN requisition.req_tax_rate_percent IS
  'Snapshot of the applied sales tax rate (percent) for display, e.g. 18.00.';

SELECT 'requisition tax-rate columns added.' AS message;
