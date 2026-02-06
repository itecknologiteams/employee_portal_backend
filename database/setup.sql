-- Quick Setup Script for Employee Portal
-- Run this after creating the database

-- Create a simple employee with password: 'password123'
-- Note: You'll need to hash the password using bcrypt in your application
-- For testing, you can use this hash: $2a$10$rOzJqJqJqJqJqJqJqJqJqOqJqJqJqJqJqJqJqJqJqJqJqJqJqJqJq

-- First, create the schema (run schema.sql first)
-- Then run this to create a test employee

-- Insert test employee (password will be hashed by the application)
-- Use the /api/auth/register endpoint or hash password manually

-- Example: To create an employee with password 'password123'
-- The password hash should be generated using bcrypt in Node.js
-- For now, use the register endpoint or manually insert with hashed password