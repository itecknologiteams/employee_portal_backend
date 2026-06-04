-- Procurement "item unavailable" + Committee review + audit trail
-- Adds per-item review status to requisition_items and an append-only audit table.
-- Safe to run multiple times.

-- 1. Per-item review state on requisition_items
ALTER TABLE requisition_items ADD COLUMN IF NOT EXISTS item_review_status   VARCHAR(20) DEFAULT 'active';
ALTER TABLE requisition_items ADD COLUMN IF NOT EXISTS item_unavailable_reason VARCHAR(255);
ALTER TABLE requisition_items ADD COLUMN IF NOT EXISTS item_flagged_by       INTEGER;
ALTER TABLE requisition_items ADD COLUMN IF NOT EXISTS item_flagged_at       TIMESTAMP;
ALTER TABLE requisition_items ADD COLUMN IF NOT EXISTS item_reviewed_by      INTEGER;
ALTER TABLE requisition_items ADD COLUMN IF NOT EXISTS item_reviewed_at      TIMESTAMP;

-- Backfill any NULLs to the default state
UPDATE requisition_items SET item_review_status = 'active' WHERE item_review_status IS NULL;

COMMENT ON COLUMN requisition_items.item_review_status IS 'active | pending_review (flagged unavailable by Procurement) | dropped (committee: not required)';
COMMENT ON COLUMN requisition_items.item_unavailable_reason IS 'Procurement reason when flagging the item as unavailable at vendor.';

-- 2. Append-only audit trail for every item-review action
CREATE TABLE IF NOT EXISTS requisition_item_events (
    id                SERIAL PRIMARY KEY,
    req_id            INTEGER NOT NULL,
    item_id           INTEGER NOT NULL,
    event_type        VARCHAR(32) NOT NULL, -- flagged_unavailable | restored | committee_required | committee_not_required
    reason            VARCHAR(255),
    amount_before     NUMERIC,
    amount_after      NUMERIC,
    ceo_required      BOOLEAN DEFAULT FALSE,
    actor_employee_id INTEGER,
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_requisition_item_events_req ON requisition_item_events(req_id);
CREATE INDEX IF NOT EXISTS idx_requisition_item_events_item ON requisition_item_events(item_id);
