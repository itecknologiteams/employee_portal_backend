-- Technicians now authenticate using their employee_code as password (plain text, no bcrypt).
-- Clear hashed_password (no longer used) and disable force_password_change for all technician users.

UPDATE users
SET hashed_password = NULL,
    force_password_change = false
WHERE user_type = 'Technician';
