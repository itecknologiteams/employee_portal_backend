-- Grade lookup table (synced from SQL Server hr_grade).
-- Run after station/city exist. Then run sync_grade_station_city_from_sqlserver.py to populate and set employees.

CREATE TABLE IF NOT EXISTS grade (
    grade_id INTEGER PRIMARY KEY,
    grade_name VARCHAR(100) NOT NULL
);

-- Optional: FK on employees so we can store grade_id from SQL Server
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'employees' AND column_name = 'grade_id'
    ) THEN
        ALTER TABLE employees ADD COLUMN grade_id INTEGER REFERENCES grade(grade_id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_employees_grade ON employees(grade_id);
    END IF;
END $$;

SELECT 'Grade table and employees.grade_id (if missing) applied.' AS message;
