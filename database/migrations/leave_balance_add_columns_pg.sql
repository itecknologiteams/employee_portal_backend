BEGIN;

-- Add employee_code column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'leave_balance' AND column_name = 'employee_code') THEN
        ALTER TABLE leave_balance ADD COLUMN employee_code VARCHAR(20);
        
        -- Populate employee_code from employees table
        UPDATE leave_balance lb
        SET employee_code = e.employee_code
        FROM employees e
        WHERE lb.employee_id = e.employee_id;
        
        -- Create unique index
        CREATE UNIQUE INDEX idx_leave_balance_employee_code ON leave_balance(employee_code);
        
        -- Add foreign key constraint
        ALTER TABLE leave_balance 
        ADD CONSTRAINT leave_balance_employee_code_fkey 
        FOREIGN KEY (employee_code) REFERENCES employees(employee_code) 
        ON DELETE CASCADE ON UPDATE CASCADE;
        
        -- Make NOT NULL if all populated
        ALTER TABLE leave_balance ALTER COLUMN employee_code SET NOT NULL;
    END IF;
END $$;

-- Add carried_forward column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'leave_balance' AND column_name = 'carried_forward') THEN
        ALTER TABLE leave_balance ADD COLUMN carried_forward INTEGER DEFAULT 0;
    END IF;
END $$;

-- Add marriage_leave column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'leave_balance' AND column_name = 'marriage_leave') THEN
        ALTER TABLE leave_balance ADD COLUMN marriage_leave INTEGER DEFAULT 10;
    END IF;
END $$;

-- Add maternity_leave column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'leave_balance' AND column_name = 'maternity_leave') THEN
        ALTER TABLE leave_balance ADD COLUMN maternity_leave INTEGER DEFAULT 90;
    END IF;
END $$;

-- Add paternal_leave column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'leave_balance' AND column_name = 'paternal_leave') THEN
        ALTER TABLE leave_balance ADD COLUMN paternal_leave INTEGER DEFAULT 7;
    END IF;
END $$;

-- Add pilgrimage_leave column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'leave_balance' AND column_name = 'pilgrimage_leave') THEN
        ALTER TABLE leave_balance ADD COLUMN pilgrimage_leave INTEGER DEFAULT 20;
    END IF;
END $$;

COMMIT;
