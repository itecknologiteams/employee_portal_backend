-- Annual leave yearly allocation tracking. Safe to re-run.
ALTER TABLE leave_balance ADD COLUMN IF NOT EXISTS annual_proration_granted_at DATE;
ALTER TABLE leave_balance ADD COLUMN IF NOT EXISTS annual_last_allocated_year INTEGER;
COMMENT ON COLUMN leave_balance.annual_proration_granted_at IS 'Date the one-time 1-year-anniversary proration was granted (NULL = not yet).';
COMMENT ON COLUMN leave_balance.annual_last_allocated_year IS 'Last calendar year the January full-14 annual allocation was applied (idempotency).';
