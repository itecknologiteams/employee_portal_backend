-- Remove optional min/max columns (range mode removed; amounts are numeric-only).
ALTER TABLE requisition_items
  DROP COLUMN IF EXISTS item_est_min,
  DROP COLUMN IF EXISTS item_est_max;
