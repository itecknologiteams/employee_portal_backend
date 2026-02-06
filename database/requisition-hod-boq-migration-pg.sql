-- HOD BOQ (Bill of Quantities): size, quantity, est cost per item when HOD approves
-- Only HOD can set these; they indicate what is being sent forward to Committee.
ALTER TABLE requisition_items
  ADD COLUMN IF NOT EXISTS hod_item_size VARCHAR(25),
  ADD COLUMN IF NOT EXISTS hod_item_qty INTEGER,
  ADD COLUMN IF NOT EXISTS hod_item_est_cost VARCHAR(50),
  ADD COLUMN IF NOT EXISTS hod_item_brand VARCHAR(25);

COMMENT ON COLUMN requisition_items.hod_item_size IS 'Size specified by HOD in BOQ when approving.';
COMMENT ON COLUMN requisition_items.hod_item_qty IS 'Quantity specified by HOD in BOQ when approving.';
COMMENT ON COLUMN requisition_items.hod_item_est_cost IS 'Est. cost specified by HOD in BOQ when approving.';
