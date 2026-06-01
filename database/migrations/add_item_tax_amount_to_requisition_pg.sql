-- Add per-item sales tax amount (PKR) for IT Equipment requisition items.
-- NULL for non-IT-Equipment items and IT items with no priced cost yet.
ALTER TABLE requisition_items
  ADD COLUMN IF NOT EXISTS item_tax_amount NUMERIC(14,2);

COMMENT ON COLUMN requisition_items.item_tax_amount IS
  'Sales tax (PKR) = round(effective unit price x effective qty x 0.18). Populated for IT Equipments category only; NULL otherwise.';

SELECT 'item_tax_amount column added to requisition_items.' AS message;
