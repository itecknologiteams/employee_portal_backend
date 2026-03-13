-- Allow user_type = 'Technician' on users table (portal login for technicians without requisition access).
-- Run once: psql -U postgres -d employee_portal -f database/migrations/add_technician_user_type.sql

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_user_type_check;
ALTER TABLE users ADD CONSTRAINT users_user_type_check
  CHECK (user_type IN ('Admin', 'SuperAdmin', 'Staff', 'User', 'Technician'));
