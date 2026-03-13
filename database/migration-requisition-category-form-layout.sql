-- Add form_layout JSONB to requisition_category for customizable form field order per category.
-- form_layout: array of { "id": "location"|"material"|"requiredByDate"|"category"|"items", "label": "...", "required": true|false, "order": number }
-- If NULL, use default order: category, location, material, requiredByDate, items.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'requisition_category' AND column_name = 'form_layout') THEN
    ALTER TABLE requisition_category ADD COLUMN form_layout JSONB DEFAULT NULL;
  END IF;
END $$;

COMMENT ON COLUMN requisition_category.form_layout IS 'Optional JSON array of form field configs for this category: order and visibility. e.g. [{"id":"category","label":"Category","required":true,"order":0},{"id":"location",...}]';

SELECT 'requisition_category.form_layout added.' AS message;
