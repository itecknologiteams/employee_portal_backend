BEGIN;

-- Add employee_code column to leave_balance table if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'leave_balance' AND column_name = 'employee_code') THEN
        ALTER TABLE leave_balance ADD COLUMN employee_code VARCHAR(20);
    END IF;
END $$;

-- Create unique index on employee_code if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes 
                   WHERE indexname = 'idx_leave_balance_employee_code') THEN
        CREATE UNIQUE INDEX idx_leave_balance_employee_code ON leave_balance(employee_code);
    END IF;
END $$;

-- Add foreign key constraint for employee_code if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                   WHERE constraint_name = 'leave_balance_employee_code_fkey' 
                   AND table_name = 'leave_balance') THEN
        ALTER TABLE leave_balance 
        ADD CONSTRAINT leave_balance_employee_code_fkey 
        FOREIGN KEY (employee_code) REFERENCES employees(employee_code) 
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Populate employee_code from employees table where it's null
UPDATE leave_balance lb
SET employee_code = e.employee_code
FROM employees e
WHERE lb.employee_id = e.employee_id
AND lb.employee_code IS NULL;

-- Make employee_code NOT NULL after population
DO $$
BEGIN
    -- Only enforce NOT NULL if all rows have employee_code
    IF NOT EXISTS (SELECT 1 FROM leave_balance WHERE employee_code IS NULL) THEN
        ALTER TABLE leave_balance ALTER COLUMN employee_code SET NOT NULL;
    END IF;
END $$;

COMMIT;
