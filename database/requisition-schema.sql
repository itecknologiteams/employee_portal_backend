-- Requisition Schema: Department, Designation, Employee Type, Requisition, Requisition Items
-- PostgreSQL - run after existing schema (departments, employees exist)

-- ========== 1. Department Table (user spec: Dep_ID, Dep_Name) ==========
CREATE TABLE IF NOT EXISTS department (
    dep_id SERIAL PRIMARY KEY,
    dep_name VARCHAR(50) NOT NULL UNIQUE
);

-- Sync existing departments (optional: keeps department in sync with departments)
INSERT INTO department (dep_name)
SELECT d.department_name FROM departments d
ON CONFLICT (dep_name) DO NOTHING;

-- ========== 2. Designation Table ==========
CREATE TABLE IF NOT EXISTS designation (
    desg_id SERIAL PRIMARY KEY,
    desg_name VARCHAR(25) NOT NULL UNIQUE
);

-- Seed common designations
INSERT INTO designation (desg_name) VALUES
    ('Employee'), ('Senior Employee'), ('Team Lead'), ('Manager'), ('HOD'), ('Director'), ('CEO')
ON CONFLICT (desg_name) DO NOTHING;

-- ========== 3. Employee Type Table (includes Committee for approval flow) ==========
CREATE TABLE IF NOT EXISTS employee_type (
    emp_type_id SERIAL PRIMARY KEY,
    emp_type_name VARCHAR(15) NOT NULL UNIQUE
);

-- Seed: Employee, HOD (same department head), Committee, CEO, Procurement
INSERT INTO employee_type (emp_type_name) VALUES
    ('Employee'), ('HOD'), ('Committee'), ('CEO'), ('Procurement')
ON CONFLICT (emp_type_name) DO NOTHING;

-- ========== 4. Add FK columns to employees (Emp_Desg, Emp_Type_Id) ==========
-- employees already has department_id (Emp_Dep) - link to department.dep_id if desired
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'designation_id') THEN
        ALTER TABLE employees ADD COLUMN designation_id INTEGER REFERENCES designation(desg_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'employee_type_id') THEN
        ALTER TABLE employees ADD COLUMN employee_type_id INTEGER REFERENCES employee_type(emp_type_id);
    END IF;
END $$;

-- Optional: ensure department exists and employees.department_id matches department.dep_id
-- (existing departments table remains; department is a copy for requisition spec)

-- ========== 5. Drop old requisitions table and create new Requisition Table ==========
DROP TABLE IF EXISTS requisition_items;
DROP TABLE IF EXISTS requisitions;

CREATE TABLE requisition (
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
    req_is_rejected SMALLINT DEFAULT 0 CHECK (req_is_rejected IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_requisition_emp ON requisition(req_emp_id);
CREATE INDEX IF NOT EXISTS idx_requisition_created ON requisition(req_created_at);
CREATE INDEX IF NOT EXISTS idx_requisition_ref ON requisition(req_reference_no);

-- ========== 6. Requisition Items Table ==========
CREATE TABLE requisition_items (
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

-- ========== Generate req_reference_no trigger ==========
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

SELECT 'Requisition schema created successfully.' AS message;
