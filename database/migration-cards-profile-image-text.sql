-- employee_cards DB: profile_image must hold base64 data URLs (no URL/path dependency).
-- Run this against database: employee_cards (not the main portal DB).

ALTER TABLE employees ALTER COLUMN profile_image TYPE TEXT;

SELECT 'employee_cards.employees.profile_image altered to TEXT.' AS message;
