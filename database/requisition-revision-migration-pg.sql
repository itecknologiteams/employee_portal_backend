-- Revise Requisition: link a revised requisition to its original + widen reference for -REV- suffix. Safe to re-run.
ALTER TABLE requisition ADD COLUMN IF NOT EXISTS req_revision_of INTEGER;
CREATE INDEX IF NOT EXISTS idx_requisition_revision_of ON requisition(req_revision_of);
COMMENT ON COLUMN requisition.req_revision_of IS 'If set, this requisition is a revision of the referenced original req_id.';
-- Revised reference (REQ-XXXXXXXX-XXXXX-REV-XXXXXXXX-XXX) needs more than the original 25 chars.
ALTER TABLE requisition ALTER COLUMN req_reference_no TYPE VARCHAR(64);
