-- Holiday Delegate Access Links: SuperAdmin-issued, OTP-gated, time-limited scoped access.
CREATE TABLE IF NOT EXISTS delegate_access_link (
  id            SERIAL PRIMARY KEY,
  token_hash    VARCHAR(64) NOT NULL UNIQUE,
  employee_id   INTEGER NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
  pages         JSONB NOT NULL,
  landing_page  VARCHAR(120) NOT NULL,
  expires_at    TIMESTAMP WITH TIME ZONE NOT NULL,
  created_by    INTEGER NOT NULL,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  revoked_at    TIMESTAMP WITH TIME ZONE,
  revoked_by    INTEGER,
  last_used_at  TIMESTAMP WITH TIME ZONE
);
CREATE INDEX IF NOT EXISTS idx_delegate_link_employee ON delegate_access_link(employee_id);
CREATE INDEX IF NOT EXISTS idx_delegate_link_expires ON delegate_access_link(expires_at);

CREATE TABLE IF NOT EXISTS delegate_access_event (
  id          SERIAL PRIMARY KEY,
  link_id     INTEGER NOT NULL REFERENCES delegate_access_link(id) ON DELETE CASCADE,
  event_type  VARCHAR(24) NOT NULL,
  ip          VARCHAR(64),
  user_agent  TEXT,
  detail      TEXT,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_delegate_event_link ON delegate_access_event(link_id);

SELECT 'delegate_access tables ready' AS message;
