-- Widen requisition_items text columns so longer (but reasonable) product names, sizes and
-- brands no longer overflow and throw mid-insert. Product descriptions are commonly long for
-- IT equipment; item_desc was varchar(100) while the sibling item_product_description is 255.
-- Widening varchar in PostgreSQL is a metadata-only change (instant, no table rewrite).

ALTER TABLE requisition_items ALTER COLUMN item_desc  TYPE varchar(255);
ALTER TABLE requisition_items ALTER COLUMN item_size  TYPE varchar(100);
ALTER TABLE requisition_items ALTER COLUMN item_brand TYPE varchar(100);
