-- Migration: Add 4 new leave types (Marriage, Maternity, Paternal, Pilgrimage)
-- Created: 2026-04-13

-- Add new columns to leave_balance table
ALTER TABLE leave_balance 
ADD COLUMN IF NOT EXISTS marriage_leave INTEGER DEFAULT 10,
ADD COLUMN IF NOT EXISTS maternity_leave INTEGER DEFAULT 90,
ADD COLUMN IF NOT EXISTS paternal_leave INTEGER DEFAULT 7,
ADD COLUMN IF NOT EXISTS pilgrimage_leave INTEGER DEFAULT 20;

-- Create index on the new columns for better performance
CREATE INDEX IF NOT EXISTS idx_leave_balance_marriage ON leave_balance(marriage_leave);
CREATE INDEX IF NOT EXISTS idx_leave_balance_maternity ON leave_balance(maternity_leave);
CREATE INDEX IF NOT EXISTS idx_leave_balance_paternal ON leave_balance(paternal_leave);
CREATE INDEX IF NOT EXISTS idx_leave_balance_pilgrimage ON leave_balance(pilgrimage_leave);

-- Update existing rows to have default values for new columns
UPDATE leave_balance 
SET marriage_leave = 10,
    maternity_leave = 90,
    paternal_leave = 7,
    pilgrimage_leave = 20
WHERE marriage_leave IS NULL 
   OR maternity_leave IS NULL 
   OR paternal_leave IS NULL 
   OR pilgrimage_leave IS NULL;

-- Note: leave_requests.leave_type is VARCHAR(50) which should be sufficient for new types
-- New leave types: 'Marriage Leave', 'Maternity Leave', 'Paternal Leave', 'Pilgrimage Leave'

-- Note: leave_deduction_log.leave_type check constraint needs to be updated separately
-- This will be handled in application code for flexibility

SELECT 'New leave types migration completed successfully!' as message;
