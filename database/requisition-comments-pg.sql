-- Requisition approval comments: optional comments at each approval stage, visible to the next approver.
-- PostgreSQL

CREATE TABLE IF NOT EXISTS requisition_comments (
  id SERIAL PRIMARY KEY,
  req_id INTEGER NOT NULL REFERENCES requisition(req_id) ON DELETE CASCADE,
  stage_key VARCHAR(50) NOT NULL,
  comment_text TEXT NOT NULL,
  added_by_employee_id INTEGER REFERENCES employees(employee_id) ON DELETE SET NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_requisition_comments_req_id ON requisition_comments(req_id);

COMMENT ON TABLE requisition_comments IS 'Optional comments added by approvers (HOD, HR, Committee, CEO, Finance, Admin); shown to the next approval stage.';
