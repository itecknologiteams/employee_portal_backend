-- Add Committee approved quantity per item (mandatory when Committee approves)
-- Run this on PostgreSQL after requisition_items exists.

ALTER TABLE requisition_items
  ADD COLUMN IF NOT EXISTS committee_approved_qty INTEGER;

COMMENT ON COLUMN requisition_items.committee_approved_qty IS 'Quantity approved by Committee for this line item; set when Committee approves the requisition.';
