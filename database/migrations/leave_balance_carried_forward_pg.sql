-- Carried forward leaves: can be used to supplement annual leave when request days exceed annual balance
-- Logic: total available = annual_leave + carried_forward
-- On approval: deduct from annual_leave first, then from carried_forward if annual is exhausted

ALTER TABLE leave_balance ADD COLUMN IF NOT EXISTS carried_forward INTEGER DEFAULT 0;

COMMENT ON COLUMN leave_balance.carried_forward IS 'Carried forward leave days from previous year; used to supplement annual leave when needed.';

-- Initialize carried_forward to 0 for existing rows
UPDATE leave_balance SET carried_forward = COALESCE(carried_forward, 0) WHERE employee_id IS NOT NULL;
