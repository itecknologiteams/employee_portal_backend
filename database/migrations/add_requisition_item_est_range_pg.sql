-- PostgreSQL: optional min/max PKR per line (range pricing). Run once on employee_portal DB.

ALTER TABLE requisition_items
  ADD COLUMN IF NOT EXISTS item_est_min NUMERIC(15, 2),
  ADD COLUMN IF NOT EXISTS item_est_max NUMERIC(15, 2);

COMMENT ON COLUMN requisition_items.item_est_min IS 'Optional lower bound PKR per unit (range mode)';
COMMENT ON COLUMN requisition_items.item_est_max IS 'Optional upper bound PKR per unit (range mode)';
