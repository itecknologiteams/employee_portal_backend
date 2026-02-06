-- =============================================================================
-- PostgreSQL Full Schema for Employee Portal
-- Run on a fresh database after: CREATE DATABASE employee_portal;
-- Then: \c employee_portal
-- Then: \i postgresql-full-schema.sql
-- Or: psql -U postgres -d employee_portal -f postgresql-full-schema.sql
-- =============================================================================

-- ========== 1. Departments ==========
CREATE TABLE IF NOT EXISTS departments (
    department_id SERIAL PRIMARY KEY,
    department_name VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ========== 2. Designation ==========
CREATE TABLE IF NOT EXISTS designation (
    desg_id SERIAL PRIMARY KEY,
    desg_name VARCHAR(25) NOT NULL UNIQUE
);
INSERT INTO designation (desg_name) VALUES
    ('Employee'), ('Senior Employee'), ('Team Lead'), ('Manager'), ('HOD'), ('Director'), ('CEO')
ON CONFLICT (desg_name) DO NOTHING;

-- ========== 3. Employee Type ==========
CREATE TABLE IF NOT EXISTS employee_type (
    emp_type_id SERIAL PRIMARY KEY,
    emp_type_name VARCHAR(15) NOT NULL UNIQUE
);
INSERT INTO employee_type (emp_type_name) VALUES
    ('Employee'), ('HOD'), ('Committee'), ('CEO'), ('Procurement'), ('Finance')
ON CONFLICT (emp_type_name) DO NOTHING;

-- ========== 4a. Station (primary – employees are assigned to a station) ==========
CREATE TABLE IF NOT EXISTS station (
    station_id SERIAL PRIMARY KEY,
    station_name VARCHAR(100) NOT NULL
);

-- ========== 4b. City (identified by station – multiple cities can be assigned to one station) ==========
CREATE TABLE IF NOT EXISTS city (
    city_id SERIAL PRIMARY KEY,
    city_name VARCHAR(100) NOT NULL,
    station_id INTEGER NOT NULL REFERENCES station(station_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_city_station ON city(station_id);

-- ========== 4. Employees ==========
CREATE TABLE IF NOT EXISTS employees (
    employee_id SERIAL PRIMARY KEY,
    employee_code VARCHAR(50) UNIQUE,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20),
    address TEXT,
    department_id INTEGER REFERENCES departments(department_id),
    designation_id INTEGER REFERENCES designation(desg_id),
    employee_type_id INTEGER REFERENCES employee_type(emp_type_id),
    station_id INTEGER REFERENCES station(station_id) ON DELETE SET NULL,
    position VARCHAR(100),
    join_date DATE,
    bio TEXT,
    password_hash VARCHAR(255),
    password VARCHAR(255),
    profile_picture VARCHAR(500),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    password_updated_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_employees_email ON employees(email);
CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department_id);
CREATE INDEX IF NOT EXISTS idx_employees_station ON employees(station_id);
CREATE INDEX IF NOT EXISTS idx_employees_active ON employees(is_active);

-- ========== 5. Users (portal login) ==========
CREATE TABLE IF NOT EXISTS users (
    user_id SERIAL PRIMARY KEY,
    username VARCHAR(25) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    user_type VARCHAR(20) NOT NULL CHECK (user_type IN ('Admin', 'SuperAdmin', 'Staff', 'User')),
    emp_id INTEGER NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
    UNIQUE(emp_id)
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_emp_id ON users(emp_id);

-- ========== 6. Leave Balance ==========
CREATE TABLE IF NOT EXISTS leave_balance (
    employee_id INTEGER PRIMARY KEY REFERENCES employees(employee_id) ON DELETE CASCADE,
    annual_leave INTEGER DEFAULT 15,
    sick_leave INTEGER DEFAULT 10,
    personal_leave INTEGER DEFAULT 5,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ========== 7. Leave Requests ==========
CREATE TABLE IF NOT EXISTS leave_requests (
    leave_request_id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
    leave_type VARCHAR(50) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    reason TEXT,
    status VARCHAR(50) DEFAULT 'Pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_leave_requests_employee ON leave_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests(status);

-- ========== 8. Feedback ==========
CREATE TABLE IF NOT EXISTS feedback (
    feedback_id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
    subject VARCHAR(200) NOT NULL,
    category VARCHAR(100),
    message TEXT NOT NULL,
    rating INTEGER,
    status VARCHAR(50) DEFAULT 'Under Review',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_feedback_employee ON feedback(employee_id);

-- ========== 9. Salary Slips ==========
CREATE TABLE IF NOT EXISTS salary_slips (
    salary_slip_id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
    month_year DATE NOT NULL,
    basic_salary DECIMAL(18,2) DEFAULT 0,
    allowances DECIMAL(18,2) DEFAULT 0,
    bonuses DECIMAL(18,2) DEFAULT 0,
    deductions DECIMAL(18,2) DEFAULT 0,
    net_salary DECIMAL(18,2) NOT NULL,
    status VARCHAR(50) DEFAULT 'Paid',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_salary_slips_employee ON salary_slips(employee_id);
CREATE INDEX IF NOT EXISTS idx_salary_slips_month ON salary_slips(month_year);

-- ========== 10. Requisition ==========
CREATE TABLE IF NOT EXISTS requisition (
    req_id SERIAL PRIMARY KEY,
    req_reference_no VARCHAR(25) UNIQUE,
    req_emp_id INTEGER NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
    req_location VARCHAR(20),
    req_material TEXT,
    req_required_by_date DATE,
    req_business VARCHAR(100) DEFAULT 'iTecknologi Tracking Pvt. Ltd',
    req_hod_approval SMALLINT DEFAULT 0 CHECK (req_hod_approval IN (0, 1)),
    req_hod_approval_date TIMESTAMP,
    req_committee_approval SMALLINT DEFAULT 0 CHECK (req_committee_approval IN (0, 1)),
    req_committee_approval_date TIMESTAMP,
    req_ceo_approval SMALLINT DEFAULT 0 CHECK (req_ceo_approval IN (0, 1)),
    req_ceo_approval_date TIMESTAMP,
    req_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    req_is_rejected SMALLINT DEFAULT 0 CHECK (req_is_rejected IN (0, 1)),
    req_procurement_ack SMALLINT DEFAULT 0 CHECK (req_procurement_ack IN (0, 1)),
    req_procurement_ack_date TIMESTAMP,
    req_procurement_ack_by INTEGER REFERENCES employees(employee_id),
    req_quotation_1_url VARCHAR(500),
    req_quotation_2_url VARCHAR(500),
    req_quotation_3_url VARCHAR(500),
    req_handed_to_finance SMALLINT DEFAULT 0 CHECK (req_handed_to_finance IN (0, 1)),
    req_handed_to_finance_date TIMESTAMP,
    req_finance_approval SMALLINT DEFAULT 0 CHECK (req_finance_approval IN (0, 1)),
    req_finance_approval_date TIMESTAMP,
    req_finance_approved_by INTEGER REFERENCES employees(employee_id),
    req_approved_quotation_index SMALLINT CHECK (req_approved_quotation_index IN (1, 2, 3)),
    req_expected_handover_date DATE
);

CREATE INDEX IF NOT EXISTS idx_requisition_emp ON requisition(req_emp_id);
CREATE INDEX IF NOT EXISTS idx_requisition_created ON requisition(req_created_at);
CREATE INDEX IF NOT EXISTS idx_requisition_ref ON requisition(req_reference_no);

-- ========== 11. Requisition Items ==========
CREATE TABLE IF NOT EXISTS requisition_items (
    item_id SERIAL PRIMARY KEY,
    req_id INTEGER NOT NULL REFERENCES requisition(req_id) ON DELETE CASCADE,
    item_desc VARCHAR(100),
    item_size VARCHAR(25),
    item_brand VARCHAR(25),
    item_qty INTEGER DEFAULT 1,
    item_est_cost VARCHAR(50),
    item_remarks VARCHAR(100)
);
CREATE INDEX IF NOT EXISTS idx_requisition_items_req ON requisition_items(req_id);

-- ========== 12. Triggers ==========
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_employees_updated_at ON employees;
CREATE TRIGGER update_employees_updated_at BEFORE UPDATE ON employees
    FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE SEQUENCE IF NOT EXISTS req_ref_seq;

CREATE OR REPLACE FUNCTION generate_req_reference_no()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.req_reference_no IS NULL OR NEW.req_reference_no = '' THEN
        NEW.req_reference_no := 'REQ-' || TO_CHAR(CURRENT_TIMESTAMP, 'YYYYMMDD') || '-' || LPAD(NEXTVAL('req_ref_seq')::TEXT, 5, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_requisition_reference ON requisition;
CREATE TRIGGER trg_requisition_reference
    BEFORE INSERT ON requisition
    FOR EACH ROW
    EXECUTE PROCEDURE generate_req_reference_no();

-- ========== 13. Optional: legacy department table (dep_id, dep_name) for compatibility ==========
CREATE TABLE IF NOT EXISTS department (
    dep_id SERIAL PRIMARY KEY,
    dep_name VARCHAR(50) NOT NULL UNIQUE
);
INSERT INTO department (dep_name)
SELECT d.department_name FROM departments d
ON CONFLICT (dep_name) DO NOTHING;

-- ========== Done ==========
SELECT 'PostgreSQL full schema created successfully.' AS message;
