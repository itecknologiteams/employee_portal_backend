-- Migration: Add is_hidden column to requisition table for soft-delete functionality
-- Created: 2026-04-16

-- Add is_hidden column (default false = visible)
ALTER TABLE requisition 
ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT FALSE;

-- Create index for performance on filtered queries
CREATE INDEX IF NOT EXISTS idx_requisition_is_hidden ON requisition(is_hidden) WHERE is_hidden = TRUE;

-- Add comment for documentation
COMMENT ON COLUMN requisition.is_hidden IS 'Soft-delete flag: TRUE = hidden (not shown in lists), FALSE = visible (default)';
