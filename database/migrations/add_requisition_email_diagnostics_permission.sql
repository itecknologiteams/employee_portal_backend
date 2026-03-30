-- Optional: register new permission for role_permissions UI (defaults off for all roles).
-- Safe to run once; ON CONFLICT skips if your DB uses a different pattern.

INSERT INTO role_permissions (role_name, permission_key, allowed)
VALUES
  ('Admin', 'requisition_email_diagnostics', false),
  ('Staff', 'requisition_email_diagnostics', false),
  ('User', 'requisition_email_diagnostics', false),
  ('Technician', 'requisition_email_diagnostics', false)
ON CONFLICT (role_name, permission_key) DO NOTHING;
