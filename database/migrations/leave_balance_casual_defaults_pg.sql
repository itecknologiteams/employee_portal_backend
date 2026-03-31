-- Leave entitlements: Annual 14, Casual 10, Sick 6; no personal leave (column kept as 0).
-- Casual & sick balances are updated by Attendance app via API; annual is updated by portal on approved annual requests.

ALTER TABLE leave_balance ADD COLUMN IF NOT EXISTS casual_leave INTEGER DEFAULT 10;

-- Align defaults for new rows (PostgreSQL)
ALTER TABLE leave_balance ALTER COLUMN annual_leave SET DEFAULT 14;
ALTER TABLE leave_balance ALTER COLUMN sick_leave SET DEFAULT 6;
ALTER TABLE leave_balance ALTER COLUMN personal_leave SET DEFAULT 0;

UPDATE leave_balance SET
  casual_leave = COALESCE(casual_leave, 10),
  annual_leave = 14,
  sick_leave = 6,
  personal_leave = 0
WHERE employee_id IS NOT NULL;

ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS annual_days_deducted INTEGER DEFAULT 0;

COMMENT ON COLUMN leave_balance.casual_leave IS 'Casual leave balance; deducted via Attendance app API, not portal requests.';
COMMENT ON COLUMN leave_requests.annual_days_deducted IS 'Days already deducted from annual_leave when request was approved (idempotency).';
