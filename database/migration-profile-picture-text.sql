-- profile_picture VARCHAR(500) is too small for Base64 images; use TEXT.
-- PostgreSQL

ALTER TABLE employees ALTER COLUMN profile_picture TYPE TEXT;

SELECT 'employees.profile_picture altered to TEXT.' AS message;
