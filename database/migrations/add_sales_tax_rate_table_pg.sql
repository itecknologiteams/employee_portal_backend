-- Append-only sales tax rate history. Active rate = newest row.
CREATE TABLE IF NOT EXISTS sales_tax_rate (
  id           SERIAL PRIMARY KEY,
  rate_percent NUMERIC(5,2) NOT NULL,
  created_by   INTEGER REFERENCES employees(employee_id),
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed the initial rate (18%) only if the table is empty.
INSERT INTO sales_tax_rate (rate_percent)
SELECT 18.00 WHERE NOT EXISTS (SELECT 1 FROM sales_tax_rate);

SELECT 'sales_tax_rate table ready.' AS message;
