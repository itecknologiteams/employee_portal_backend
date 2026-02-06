-- Migration: Station (primary), City (identified by station), employees.station_id
-- Run on existing DB: psql -U postgres -d employee_portal -f database/migration-city-station.sql

-- Station first (primary entity)
CREATE TABLE IF NOT EXISTS station (
    station_id SERIAL PRIMARY KEY,
    station_name VARCHAR(100) NOT NULL
);

-- City is identified by station (multiple cities can be assigned to one station)
CREATE TABLE IF NOT EXISTS city (
    city_id SERIAL PRIMARY KEY,
    city_name VARCHAR(100) NOT NULL,
    station_id INTEGER NOT NULL REFERENCES station(station_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_city_station ON city(station_id);

-- If city already existed with UNIQUE(station_id), drop it so multiple cities per station are allowed
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'city_station_id_key' AND conrelid = 'city'::regclass) THEN
        ALTER TABLE city DROP CONSTRAINT city_station_id_key;
    END IF;
END $$;

-- Add station_id to employees if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'employees' AND column_name = 'station_id'
    ) THEN
        ALTER TABLE employees ADD COLUMN station_id INTEGER REFERENCES station(station_id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_employees_station ON employees(station_id);
    END IF;
END $$;

SELECT 'Station, City (by station), employees.station_id applied.' AS message;
