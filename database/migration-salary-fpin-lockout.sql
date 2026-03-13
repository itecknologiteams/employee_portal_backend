-- FPIN: failed attempts and lockout (5 attempts -> lock 3 min)
-- Run after migration-salary-fpin.sql

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'salary_fpin' AND column_name = 'failed_attempts') THEN
    ALTER TABLE salary_fpin ADD COLUMN failed_attempts SMALLINT NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'salary_fpin' AND column_name = 'locked_until') THEN
    ALTER TABLE salary_fpin ADD COLUMN locked_until TIMESTAMP WITH TIME ZONE NULL;
  END IF;
END $$;

SELECT 'salary_fpin lockout columns added.' AS message;
