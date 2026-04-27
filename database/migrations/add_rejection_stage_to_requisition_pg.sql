-- Migration: Add rejection_stage column to track which stage a requisition was rejected at
ALTER TABLE requisition ADD COLUMN IF NOT EXISTS req_rejection_stage VARCHAR(30) NULL;

COMMENT ON COLUMN requisition.req_rejection_stage IS 'Stage key where requisition was rejected (hod, hr, committee, ceo, finance, procurement, admin, hr_check)';
