-- Add profile fields to employees for HR-approved profile updates
-- Run once on PostgreSQL. Safe to re-run: uses DO block to ignore "column already exists".

DO $$
BEGIN
  ALTER TABLE employees ADD COLUMN date_of_birth DATE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TABLE employees ADD COLUMN father_name VARCHAR(100);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TABLE employees ADD COLUMN gender VARCHAR(20);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TABLE employees ADD COLUMN marital_status VARCHAR(20);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TABLE employees ADD COLUMN religion VARCHAR(50);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TABLE employees ADD COLUMN grade VARCHAR(50);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TABLE employees ADD COLUMN cnic_number VARCHAR(30);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TABLE employees ADD COLUMN cnic_issue_date DATE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TABLE employees ADD COLUMN cnic_expiry_date DATE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TABLE employees ADD COLUMN emergency_contact_number VARCHAR(20);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TABLE employees ADD COLUMN employee_extension VARCHAR(20);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TABLE employees ADD COLUMN personal_cell_number VARCHAR(20);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TABLE employees ADD COLUMN region VARCHAR(100);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

SELECT 'Employees profile fields migration completed.' AS message;
