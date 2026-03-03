-- DB-driven requisition flow: stages and per-category behavior
-- Run after requisition_category table and req_category column exist

-- 1) Flow stages: order and which employee type can act
CREATE TABLE IF NOT EXISTS requisition_flow_stage (
  id SERIAL PRIMARY KEY,
  stage_key VARCHAR(50) NOT NULL UNIQUE,
  stage_label VARCHAR(100) NOT NULL,
  sequence_order INT NOT NULL,
  employee_type_name VARCHAR(80) NOT NULL,
  designation_name VARCHAR(80) NULL,
  filter_by_department SMALLINT NOT NULL DEFAULT 0 CHECK (filter_by_department IN (0, 1)),
  requisition_done_column VARCHAR(80) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_flow_stage_order ON requisition_flow_stage(sequence_order);

COMMENT ON TABLE requisition_flow_stage IS 'Requisition flow stages: order and which employee type/designation can act. filter_by_department=1 for HOD (dept-specific).';

-- Seed default flow (HOD -> Committee -> CEO -> Procurement -> Finance)
INSERT INTO requisition_flow_stage (stage_key, stage_label, sequence_order, employee_type_name, designation_name, filter_by_department, requisition_done_column)
VALUES
  ('hod', 'HOD', 1, 'HOD', 'HOD', 1, 'req_hod_approval'),
  ('committee', 'Committee', 2, 'Committee', 'Committee', 0, 'req_committee_approval'),
  ('ceo', 'CEO', 3, 'CEO', 'CEO', 0, 'req_ceo_approval'),
  ('procurement', 'Procurement', 4, 'Procurement', 'Procurement', 0, 'req_procurement_ack'),
  ('finance', 'Finance', 5, 'Finance', 'Finance', 0, 'req_finance_approval')
ON CONFLICT (stage_key) DO NOTHING;

-- 2) Per-category, per-stage: approval | for_info | skip
CREATE TABLE IF NOT EXISTS requisition_category_stage (
  id SERIAL PRIMARY KEY,
  category_id INT NOT NULL REFERENCES requisition_category(id) ON DELETE CASCADE,
  flow_stage_id INT NOT NULL REFERENCES requisition_flow_stage(id) ON DELETE CASCADE,
  behavior VARCHAR(20) NOT NULL CHECK (behavior IN ('approval', 'for_info', 'skip')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(category_id, flow_stage_id)
);

CREATE INDEX IF NOT EXISTS idx_category_stage_category ON requisition_category_stage(category_id);
CREATE INDEX IF NOT EXISTS idx_category_stage_flow ON requisition_category_stage(flow_stage_id);

COMMENT ON TABLE requisition_category_stage IS 'Per category, per stage: approval (must approve), for_info (auto-advance), skip (skip stage).';

-- Seed from existing requisition_category flags (map columns to stage_key)
INSERT INTO requisition_category_stage (category_id, flow_stage_id, behavior)
SELECT c.id, fs.id,
  CASE fs.stage_key
    WHEN 'hod' THEN
      CASE WHEN c.hod_approval = 1 THEN 'approval' WHEN c.hod_for_info = 1 THEN 'for_info' ELSE 'skip' END
    WHEN 'committee' THEN CASE WHEN c.committee_review = 1 OR c.final_committee = 1 THEN 'approval' ELSE 'skip' END
    WHEN 'ceo' THEN CASE WHEN c.ceo_approve = 1 THEN 'approval' ELSE 'skip' END
    WHEN 'procurement' THEN 'approval'
    WHEN 'finance' THEN 'approval'
    ELSE 'skip'
  END
FROM requisition_category c
CROSS JOIN requisition_flow_stage fs
ON CONFLICT (category_id, flow_stage_id) DO NOTHING;

-- 3) Current stage on requisition (denormalized for fast pending lists)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'requisition' AND column_name = 'req_current_stage_key') THEN
    ALTER TABLE requisition ADD COLUMN req_current_stage_key VARCHAR(50);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_requisition_current_stage ON requisition(req_current_stage_key);

COMMENT ON COLUMN requisition.req_current_stage_key IS 'Current flow stage (hod, committee, ceo, procurement, finance). NULL when completed or rejected.';

-- Backfill req_current_stage_key from existing columns (best-effort)
UPDATE requisition r
SET req_current_stage_key = CASE
  WHEN COALESCE(r.req_is_rejected, 0) = 1 THEN NULL
  WHEN COALESCE(r.req_finance_approval, 0) = 1 THEN NULL
  WHEN COALESCE(r.req_handed_to_finance, 0) = 1 AND COALESCE(r.req_finance_approval, 0) = 0 THEN 'finance'
  WHEN COALESCE(r.req_ceo_approval, 0) = 1 AND (COALESCE(r.req_procurement_ack, 0) = 0 OR COALESCE(r.req_handed_to_finance, 0) = 0) THEN 'procurement'
  WHEN COALESCE(r.req_committee_approval, 0) = 1 AND COALESCE(r.req_ceo_approval, 0) = 0 THEN 'ceo'
  WHEN COALESCE(r.req_hod_approval, 0) = 1 AND COALESCE(r.req_committee_approval, 0) = 0 THEN 'committee'
  ELSE 'hod'
END
WHERE r.req_current_stage_key IS NULL AND COALESCE(r.req_is_rejected, 0) = 0;

SELECT 'Requisition DB-driven flow tables and column added.' AS message;
