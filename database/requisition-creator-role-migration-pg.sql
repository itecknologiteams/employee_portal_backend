-- Add req_creator_role column to track whether creator was HOD, Committee, or CEO
-- This allows completed requisitions to return to the appropriate bucket for acknowledgment
-- Run after requisition-complete-hod-ack.sql

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'requisition' AND column_name = 'req_creator_role') THEN
    ALTER TABLE requisition ADD COLUMN req_creator_role VARCHAR(20);
  END IF;
END $$;

-- Add index for faster queries filtering by creator role
CREATE INDEX IF NOT EXISTS idx_requisition_creator_role ON requisition(req_creator_role);

-- Add comment for documentation
COMMENT ON COLUMN requisition.req_creator_role IS 'Role of creator at time of requisition creation: HOD, Committee, CEO, or NULL for regular employee';

SELECT 'Requisition creator role column added successfully.' AS message;
