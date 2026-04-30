-- Add 3 supporting document URL columns to the requisition table
-- Run once: psql -U your_user -d your_db -f add_support_docs_to_requisition.sql

ALTER TABLE requisition
  ADD COLUMN IF NOT EXISTS req_support_doc_1_url TEXT,
  ADD COLUMN IF NOT EXISTS req_support_doc_2_url TEXT,
  ADD COLUMN IF NOT EXISTS req_support_doc_3_url TEXT;
