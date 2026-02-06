-- Store quotation images as base64 (data URLs) in DB. VARCHAR(500) is too small; use TEXT.
-- Run once on PostgreSQL: psql -U your_user -d your_db -f migration-quotation-columns-text.sql

ALTER TABLE requisition ALTER COLUMN req_quotation_1_url TYPE TEXT;
ALTER TABLE requisition ALTER COLUMN req_quotation_2_url TYPE TEXT;
ALTER TABLE requisition ALTER COLUMN req_quotation_3_url TYPE TEXT;

SELECT 'Quotation columns altered to TEXT for base64 storage.' AS message;
