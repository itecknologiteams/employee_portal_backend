-- Adds employees.ntn (National Tax Number) used on the FBR income tax
-- deduction certificate (rule 42). Optional per FBR form ("if any") — the
-- certificate prints it blank when not set. PostgreSQL.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS ntn VARCHAR(30);

COMMENT ON COLUMN employees.ntn IS 'National Tax Number (FBR) — shown on the income tax deduction certificate';
