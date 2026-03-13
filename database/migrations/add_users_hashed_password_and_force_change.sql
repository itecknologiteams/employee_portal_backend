-- Add hashed_password: store bcrypt hash here; password column keeps plain (e.g. last 4 of phone for technicians).
-- Add force_password_change: when true, technician must change password on first portal login.
-- Run once: psql -U postgres -d employee_portal -f database/migrations/add_users_hashed_password_and_force_change.sql

ALTER TABLE users ADD COLUMN IF NOT EXISTS hashed_password VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS force_password_change BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN users.password IS 'Plain password (e.g. last 4 digits of phone for technicians).';
COMMENT ON COLUMN users.hashed_password IS 'Bcrypt hash used for verification; when set, login checks this.';
COMMENT ON COLUMN users.force_password_change IS 'When true, technician must change password before using portal.';
