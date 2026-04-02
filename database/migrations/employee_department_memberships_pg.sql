-- Multiple primary departments per employee (Admin UI multi-select).
-- employees.department_id remains the canonical primary (min selected id) for legacy joins.
CREATE TABLE IF NOT EXISTS employee_department_memberships (
  employee_id INTEGER NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
  department_id INTEGER NOT NULL REFERENCES departments(department_id) ON DELETE CASCADE,
  PRIMARY KEY (employee_id, department_id)
);
CREATE INDEX IF NOT EXISTS idx_employee_dept_mem_department ON employee_department_memberships(department_id);
CREATE INDEX IF NOT EXISTS idx_employee_dept_mem_employee ON employee_department_memberships(employee_id);

INSERT INTO employee_department_memberships (employee_id, department_id)
SELECT e.employee_id, e.department_id
FROM employees e
WHERE e.department_id IS NOT NULL
ON CONFLICT (employee_id, department_id) DO NOTHING;
