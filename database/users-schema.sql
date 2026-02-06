-- Users table for portal authentication
-- Run after employees table exists (main schema)
-- PostgreSQL

CREATE TABLE IF NOT EXISTS users (
    user_id SERIAL PRIMARY KEY,
    username VARCHAR(25) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    user_type VARCHAR(20) NOT NULL CHECK (user_type IN ('Admin', 'SuperAdmin', 'Staff', 'User')),
    emp_id INTEGER NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
    UNIQUE(emp_id)
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_emp_id ON users(emp_id);

SELECT 'Users table created successfully.' AS message;
