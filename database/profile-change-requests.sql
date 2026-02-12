-- HR bucket: pending profile change requests (employee submits -> HR approves -> then employees updated)
-- PostgreSQL

CREATE TABLE IF NOT EXISTS profile_change_requests (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
  requested_data JSONB NOT NULL DEFAULT '{}',
  status VARCHAR(20) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected')),
  requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMP,
  reviewed_by_employee_id INTEGER REFERENCES employees(employee_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_profile_change_requests_employee_id ON profile_change_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_profile_change_requests_status ON profile_change_requests(status);

-- One pending request per employee: application will UPDATE existing Pending row or INSERT
COMMENT ON TABLE profile_change_requests IS 'Employee profile update requests; applied to employees only when HR approves';

SELECT 'profile_change_requests table created successfully.' AS message;
