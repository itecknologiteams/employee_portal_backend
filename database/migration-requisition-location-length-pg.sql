-- req_location was VARCHAR(20); extend for longer addresses/locations.
-- Run once on PostgreSQL: psql -U your_user -d your_db -f migration-requisition-location-length-pg.sql

ALTER TABLE requisition ALTER COLUMN req_location TYPE VARCHAR(255);

SELECT 'Requisition req_location extended to VARCHAR(255).' AS message;
