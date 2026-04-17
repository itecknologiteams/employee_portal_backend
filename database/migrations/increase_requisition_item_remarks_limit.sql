-- Migration: Increase item_remarks character limit from 100 to 500
-- Created: 2026-04-16

-- Increase the character limit for item_remarks column in requisition_items table
ALTER TABLE requisition_items ALTER COLUMN item_remarks TYPE VARCHAR(500);

-- Add a comment to document the change
COMMENT ON COLUMN requisition_items.item_remarks IS 'Item remarks/specifications (max 500 characters)';
