-- Employee Record History Table Migration
-- Tracks salary changes, department transfers, promotions, and employment lifecycle
-- Run this after existing employees schema is in place

-- ========== 1. Employee Record History Table ==========
-- Tracks all significant changes to employee records for audit and reporting
CREATE TABLE IF NOT EXISTS employee_record_history (
    record_id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,

    -- Record Classification
    record_type VARCHAR(50) NOT NULL CHECK (record_type IN (
        'salary_change',           -- Gross salary adjustment
        'department_change',         -- Department transfer
        'designation_change',        -- Promotion/demotion
        'employee_type_change',      -- Employee type change (HOD, Committee, etc.)
        'confirmation',             -- Employee confirmation after probation
        'joining',                  -- Initial joining date record
        'last_working_date',        -- Exit/separation date
        'rehire',                   -- Rehire after separation
        'location_change',          -- City/Station change
        'grade_change',             -- Grade level change
        'other'                     -- Other significant changes
    )),

    -- Effective Date (when the change takes effect)
    effective_date DATE NOT NULL,

    -- Old Values (snapshot before change)
    old_gross_salary DECIMAL(18,2),
    old_department_id INTEGER REFERENCES departments(department_id),
    old_designation_id INTEGER,
    old_employee_type_id INTEGER,
    old_location VARCHAR(100),
    old_grade VARCHAR(20),
    old_value TEXT,                 -- Generic old value for other record types

    -- New Values (snapshot after change)
    new_gross_salary DECIMAL(18,2),
    new_department_id INTEGER REFERENCES departments(department_id),
    new_designation_id INTEGER,
    new_employee_type_id INTEGER,
    new_location VARCHAR(100),
    new_grade VARCHAR(20),
    new_value TEXT,                 -- Generic new value for other record types

    -- Change Details
    change_amount DECIMAL(18,2),    -- For salary: difference (new - old)
    change_percentage DECIMAL(5,2), -- For salary: percentage change
    change_reason TEXT,             -- Reason for the change
    reference_no VARCHAR(50),       -- Reference document/approval number

    -- Approval Information
    approved_by INTEGER REFERENCES employees(employee_id),
    approved_at TIMESTAMP,
    approval_status VARCHAR(20) DEFAULT 'approved' CHECK (approval_status IN ('pending', 'approved', 'rejected')),

    -- Metadata
    created_by INTEGER REFERENCES employees(employee_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,                     -- Additional notes/comments

    -- Related Entity (for linking to specific workflows)
    related_entity_type VARCHAR(50), -- e.g., 'requisition', 'payroll', 'hr_request'
    related_entity_id INTEGER       -- ID of the related entity
);

-- ========== 2. Indexes for Performance ==========
-- Primary lookup indexes
CREATE INDEX IF NOT EXISTS idx_emp_history_employee_id ON employee_record_history(employee_id);
CREATE INDEX IF NOT EXISTS idx_emp_history_record_type ON employee_record_history(record_type);
CREATE INDEX IF NOT EXISTS idx_emp_history_effective_date ON employee_record_history(effective_date);

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_emp_history_emp_type ON employee_record_history(employee_id, record_type);
CREATE INDEX IF NOT EXISTS idx_emp_history_emp_effective ON employee_record_history(employee_id, effective_date DESC);
CREATE INDEX IF NOT EXISTS idx_emp_history_salary ON employee_record_history(record_type, effective_date) WHERE record_type = 'salary_change';
CREATE INDEX IF NOT EXISTS idx_emp_history_dept ON employee_record_history(record_type, effective_date) WHERE record_type = 'department_change';

-- Approval status index for pending approvals
CREATE INDEX IF NOT EXISTS idx_emp_history_approval ON employee_record_history(approval_status) WHERE approval_status = 'pending';

-- ========== 3. Triggers for Updated At ==========
CREATE OR REPLACE FUNCTION update_emp_history_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_emp_history_updated_at ON employee_record_history;
CREATE TRIGGER trg_emp_history_updated_at
    BEFORE UPDATE ON employee_record_history
    FOR EACH ROW
    EXECUTE FUNCTION update_emp_history_updated_at();

-- ========== 4. Helper Function to Log Salary Change ==========
CREATE OR REPLACE FUNCTION log_salary_change(
    p_employee_id INTEGER,
    p_old_salary DECIMAL(18,2),
    p_new_salary DECIMAL(18,2),
    p_effective_date DATE,
    p_reason TEXT DEFAULT NULL,
    p_reference_no VARCHAR(50) DEFAULT NULL,
    p_created_by INTEGER DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
    v_record_id INTEGER;
    v_change_amount DECIMAL(18,2);
    v_change_percentage DECIMAL(5,2);
BEGIN
    v_change_amount := p_new_salary - p_old_salary;
    IF p_old_salary > 0 THEN
        v_change_percentage := ROUND((v_change_amount / p_old_salary) * 100, 2);
    ELSE
        v_change_percentage := 0;
    END IF;

    INSERT INTO employee_record_history (
        employee_id, record_type, effective_date,
        old_gross_salary, new_gross_salary,
        change_amount, change_percentage,
        change_reason, reference_no, created_by
    ) VALUES (
        p_employee_id, 'salary_change', p_effective_date,
        p_old_salary, p_new_salary,
        v_change_amount, v_change_percentage,
        p_reason, p_reference_no, p_created_by
    )
    RETURNING record_id INTO v_record_id;

    RETURN v_record_id;
END;
$$ LANGUAGE plpgsql;

-- ========== 5. Helper Function to Log Department Change ==========
CREATE OR REPLACE FUNCTION log_department_change(
    p_employee_id INTEGER,
    p_old_dept_id INTEGER,
    p_new_dept_id INTEGER,
    p_effective_date DATE,
    p_reason TEXT DEFAULT NULL,
    p_reference_no VARCHAR(50) DEFAULT NULL,
    p_created_by INTEGER DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
    v_record_id INTEGER;
BEGIN
    INSERT INTO employee_record_history (
        employee_id, record_type, effective_date,
        old_department_id, new_department_id,
        change_reason, reference_no, created_by
    ) VALUES (
        p_employee_id, 'department_change', p_effective_date,
        p_old_dept_id, p_new_dept_id,
        p_reason, p_reference_no, p_created_by
    )
    RETURNING record_id INTO v_record_id;

    RETURN v_record_id;
END;
$$ LANGUAGE plpgsql;

-- ========== 6. Helper Function to Log Designation/Promotion Change ==========
CREATE OR REPLACE FUNCTION log_designation_change(
    p_employee_id INTEGER,
    p_old_designation_id INTEGER,
    p_new_designation_id INTEGER,
    p_effective_date DATE,
    p_reason TEXT DEFAULT NULL,
    p_reference_no VARCHAR(50) DEFAULT NULL,
    p_created_by INTEGER DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
    v_record_id INTEGER;
BEGIN
    INSERT INTO employee_record_history (
        employee_id, record_type, effective_date,
        old_designation_id, new_designation_id,
        change_reason, reference_no, created_by
    ) VALUES (
        p_employee_id, 'designation_change', p_effective_date,
        p_old_designation_id, p_new_designation_id,
        p_reason, p_reference_no, p_created_by
    )
    RETURNING record_id INTO v_record_id;

    RETURN v_record_id;
END;
$$ LANGUAGE plpgsql;

-- ========== 7. Helper Function to Log Employment Lifecycle Events ==========
CREATE OR REPLACE FUNCTION log_employment_event(
    p_employee_id INTEGER,
    p_record_type VARCHAR(50), -- 'joining', 'confirmation', 'last_working_date', 'rehire'
    p_event_date DATE,
    p_notes TEXT DEFAULT NULL,
    p_reference_no VARCHAR(50) DEFAULT NULL,
    p_created_by INTEGER DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
    v_record_id INTEGER;
BEGIN
    INSERT INTO employee_record_history (
        employee_id, record_type, effective_date,
        change_reason, reference_no, created_by, notes
    ) VALUES (
        p_employee_id, p_record_type, p_event_date,
        p_notes, p_reference_no, p_created_by, p_notes
    )
    RETURNING record_id INTO v_record_id;

    RETURN v_record_id;
END;
$$ LANGUAGE plpgsql;

-- ========== 8. View: Employee Salary History ==========
CREATE OR REPLACE VIEW vw_employee_salary_history AS
SELECT
    erh.record_id,
    erh.employee_id,
    e.employee_code,
    e.first_name || ' ' || e.last_name AS employee_name,
    d.department_name,
    erh.effective_date,
    erh.old_gross_salary,
    erh.new_gross_salary,
    erh.change_amount,
    erh.change_percentage,
    erh.change_reason,
    erh.reference_no,
    erh.approved_by,
    approver.first_name || ' ' || approver.last_name AS approved_by_name,
    erh.created_at
FROM employee_record_history erh
JOIN employees e ON erh.employee_id = e.employee_id
LEFT JOIN departments d ON e.department_id = d.department_id
LEFT JOIN employees approver ON erh.approved_by = approver.employee_id
WHERE erh.record_type = 'salary_change'
ORDER BY erh.employee_id, erh.effective_date DESC;

-- ========== 9. View: Employee Department Transfer History ==========
CREATE OR REPLACE VIEW vw_employee_department_history AS
SELECT
    erh.record_id,
    erh.employee_id,
    e.employee_code,
    e.first_name || ' ' || e.last_name AS employee_name,
    erh.effective_date,
    old_dept.department_name AS old_department,
    new_dept.department_name AS new_department,
    erh.change_reason,
    erh.reference_no,
    erh.created_at
FROM employee_record_history erh
JOIN employees e ON erh.employee_id = e.employee_id
LEFT JOIN departments old_dept ON erh.old_department_id = old_dept.department_id
LEFT JOIN departments new_dept ON erh.new_department_id = new_dept.department_id
WHERE erh.record_type = 'department_change'
ORDER BY erh.employee_id, erh.effective_date DESC;

-- ========== 10. View: Employee Promotion/Designation History ==========
CREATE OR REPLACE VIEW vw_employee_promotion_history AS
SELECT
    erh.record_id,
    erh.employee_id,
    e.employee_code,
    e.first_name || ' ' || e.last_name AS employee_name,
    d.department_name,
    erh.effective_date,
    old_desg.desg_name AS old_designation,
    new_desg.desg_name AS new_designation,
    erh.change_reason,
    erh.reference_no,
    erh.created_at
FROM employee_record_history erh
JOIN employees e ON erh.employee_id = e.employee_id
LEFT JOIN departments d ON e.department_id = d.department_id
LEFT JOIN designation old_desg ON erh.old_designation_id = old_desg.desg_id
LEFT JOIN designation new_desg ON erh.new_designation_id = new_desg.desg_id
WHERE erh.record_type = 'designation_change'
ORDER BY erh.employee_id, erh.effective_date DESC;

-- ========== 11. View: Complete Employee Timeline ==========
CREATE OR REPLACE VIEW vw_employee_timeline AS
SELECT
    erh.record_id,
    erh.employee_id,
    e.employee_code,
    e.first_name || ' ' || e.last_name AS employee_name,
    d.department_name,
    erh.record_type,
    erh.effective_date,
    CASE
        WHEN erh.record_type = 'salary_change' THEN
            'Salary: PKR ' || COALESCE(erh.old_gross_salary::TEXT, '0') || ' → PKR ' || COALESCE(erh.new_gross_salary::TEXT, '0')
        WHEN erh.record_type = 'department_change' THEN
            'Dept: ' || COALESCE(old_dept.department_name, 'N/A') || ' → ' || COALESCE(new_dept.department_name, 'N/A')
        WHEN erh.record_type = 'designation_change' THEN
            'Role: ' || COALESCE(old_desg.desg_name, 'N/A') || ' → ' || COALESCE(new_desg.desg_name, 'N/A')
        WHEN erh.record_type = 'confirmation' THEN
            'Employee Confirmed'
        WHEN erh.record_type = 'joining' THEN
            'Joined Organization'
        WHEN erh.record_type = 'last_working_date' THEN
            'Last Working Day'
        WHEN erh.record_type = 'rehire' THEN
            'Rehired'
        ELSE COALESCE(erh.change_reason, erh.record_type)
    END AS change_summary,
    erh.change_reason,
    erh.reference_no,
    erh.created_at
FROM employee_record_history erh
JOIN employees e ON erh.employee_id = e.employee_id
LEFT JOIN departments d ON e.department_id = d.department_id
LEFT JOIN departments old_dept ON erh.old_department_id = old_dept.department_id
LEFT JOIN departments new_dept ON erh.new_department_id = new_dept.department_id
LEFT JOIN designation old_desg ON erh.old_designation_id = old_desg.desg_id
LEFT JOIN designation new_desg ON erh.new_designation_id = new_desg.desg_id
ORDER BY erh.employee_id, erh.effective_date DESC;

-- ========== 12. Seed: Create Initial Joining Records for Existing Employees ==========
-- This creates baseline records for employees who don't have history yet
DO $$
DECLARE
    v_employee RECORD;
    v_count INTEGER;
BEGIN
    -- Count existing employees without joining records
    SELECT COUNT(*) INTO v_count
    FROM employees e
    WHERE NOT EXISTS (
        SELECT 1 FROM employee_record_history erh
        WHERE erh.employee_id = e.employee_id
        AND erh.record_type = 'joining'
    );

    IF v_count > 0 THEN
        -- Create joining records for employees who have a join_date
        FOR v_employee IN
            SELECT employee_id, join_date, created_at
            FROM employees
            WHERE join_date IS NOT NULL
            AND NOT EXISTS (
                SELECT 1 FROM employee_record_history erh
                WHERE erh.employee_id = employees.employee_id
                AND erh.record_type = 'joining'
            )
        LOOP
            INSERT INTO employee_record_history (
                employee_id, record_type, effective_date,
                change_reason, created_at, notes
            ) VALUES (
                v_employee.employee_id, 'joining', v_employee.join_date,
                'Initial employment record - joined organization', v_employee.created_at,
                'Auto-generated joining record from existing employee data'
            );
        END LOOP;

        -- Create joining records for employees without join_date (use created_at)
        FOR v_employee IN
            SELECT employee_id, created_at
            FROM employees
            WHERE join_date IS NULL
            AND NOT EXISTS (
                SELECT 1 FROM employee_record_history erh
                WHERE erh.employee_id = employees.employee_id
                AND erh.record_type = 'joining'
            )
        LOOP
            INSERT INTO employee_record_history (
                employee_id, record_type, effective_date,
                change_reason, created_at, notes
            ) VALUES (
                v_employee.employee_id, 'joining', v_employee.created_at::DATE,
                'Initial employment record - joined organization', v_employee.created_at,
                'Auto-generated joining record from employee creation date'
            );
        END LOOP;

        RAISE NOTICE 'Created joining records for % existing employees', v_count;
    ELSE
        RAISE NOTICE 'All existing employees already have joining records';
    END IF;
END $$;

-- ========== Migration Complete ==========
SELECT 'Employee Record History table and views created successfully.' AS message;
