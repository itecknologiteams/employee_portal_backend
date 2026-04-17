-- Migration: Create leave_types table and update leave_requests to use leave_type_id
-- Created: 2026-04-16

-- Create leave_types table
CREATE TABLE IF NOT EXISTS leave_types (
    leave_type_id SERIAL PRIMARY KEY,
    leave_type_name VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index on leave_type_name for faster lookups
CREATE INDEX IF NOT EXISTS idx_leave_types_name ON leave_types(leave_type_name);

-- Insert default leave types
INSERT INTO leave_types (leave_type_id, leave_type_name, description, is_active) VALUES
    (1, 'Casual', 'Casual leave for personal matters', true),
    (2, 'Sick', 'Sick leave for medical reasons', true),
    (3, 'Annual', 'Annual leave entitlement', true),
    (4, 'Marriage', 'Marriage leave', true),
    (5, 'Maternity', 'Maternity leave for female employees', true),
    (6, 'Paternal', 'Paternal leave for male employees', true),
    (7, 'Pilgrimage', 'Leave for religious pilgrimage', true)
ON CONFLICT (leave_type_id) DO UPDATE SET
    leave_type_name = EXCLUDED.leave_type_name,
    description = EXCLUDED.description,
    is_active = EXCLUDED.is_active;

-- Reset the sequence to start after the inserted values
SELECT setval('leave_types_leave_type_id_seq', (SELECT MAX(leave_type_id) FROM leave_types));

-- Add leave_type_id column to leave_requests table (nullable initially for migration)
ALTER TABLE leave_requests 
ADD COLUMN IF NOT EXISTS leave_type_id INTEGER;

-- Add foreign key constraint
ALTER TABLE leave_requests 
ADD CONSTRAINT fk_leave_requests_leave_type_id 
FOREIGN KEY (leave_type_id) REFERENCES leave_types(leave_type_id) ON DELETE RESTRICT;

-- Create index on leave_type_id for better performance
CREATE INDEX IF NOT EXISTS idx_leave_requests_type_id ON leave_requests(leave_type_id);

-- Migrate existing data: Map leave_type varchar to leave_type_id
UPDATE leave_requests lr
SET leave_type_id = lt.leave_type_id
FROM leave_types lt
WHERE LOWER(TRIM(lr.leave_type)) = LOWER(TRIM(lt.leave_type_name));

-- Handle special cases (e.g., 'Annual Leave' -> 'Annual', 'Paternity' -> 'Paternal')
UPDATE leave_requests lr
SET leave_type_id = lt.leave_type_id
FROM leave_types lt
WHERE lr.leave_type_id IS NULL 
  AND (
    LOWER(TRIM(lr.leave_type)) LIKE '%annual%' AND lt.leave_type_name = 'Annual'
    OR LOWER(TRIM(lr.leave_type)) LIKE '%marriage%' AND lt.leave_type_name = 'Marriage'
    OR LOWER(TRIM(lr.leave_type)) LIKE '%maternity%' AND lt.leave_type_name = 'Maternity'
    OR (LOWER(TRIM(lr.leave_type)) LIKE '%paternal%' OR LOWER(TRIM(lr.leave_type)) LIKE '%paternity%') AND lt.leave_type_name = 'Paternal'
    OR LOWER(TRIM(lr.leave_type)) LIKE '%pilgrimage%' AND lt.leave_type_name = 'Pilgrimage'
  );

-- Make leave_type_id NOT NULL after migration (optional - uncomment if needed)
-- ALTER TABLE leave_requests ALTER COLUMN leave_type_id SET NOT NULL;

-- Create function to update updated_at timestamp for leave_types
CREATE OR REPLACE FUNCTION update_leave_types_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for leave_types table
DROP TRIGGER IF EXISTS update_leave_types_updated_at ON leave_types;
CREATE TRIGGER update_leave_types_updated_at BEFORE UPDATE ON leave_types
    FOR EACH ROW EXECUTE FUNCTION update_leave_types_updated_at_column();

-- Add comment explaining the migration
COMMENT ON TABLE leave_types IS 'Master table for all leave types. Use leave_type_id for referencing in leave_requests.';

-- Create a view for easier querying that joins leave_requests with leave_types
CREATE OR REPLACE VIEW leave_requests_view AS
SELECT 
    lr.leave_request_id,
    lr.employee_id,
    lr.leave_type_id,
    lt.leave_type_name,
    lr.start_date,
    lr.end_date,
    (lr.end_date - lr.start_date + 1) as days,
    lr.reason,
    lr.status,
    lr.created_at,
    lr.annual_days_deducted
FROM leave_requests lr
LEFT JOIN leave_types lt ON lr.leave_type_id = lt.leave_type_id;

-- Grant select on the view (adjust as per your database user permissions)
-- GRANT SELECT ON leave_requests_view TO your_app_user;

SELECT 'Leave types table created and leave_requests updated successfully!' as message;
