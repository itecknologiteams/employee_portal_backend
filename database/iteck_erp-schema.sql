-- =============================================================================
-- SQL Server Schema: iteck_erp (Employee Portal / ERP)
-- Server: 192.168.20.166 | User: tech | DB: iteck_erp
-- Run this script after creating the database: CREATE DATABASE iteck_erp;
-- =============================================================================

USE iteck_erp;
GO

-- =============================================================================
-- 1. departments
-- =============================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'departments' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
    CREATE TABLE dbo.departments (
        department_id   INT IDENTITY(1,1) PRIMARY KEY,
        department_name NVARCHAR(100) NOT NULL,
        description     NVARCHAR(500),
        created_at      DATETIME2 DEFAULT GETDATE()
    );
END
GO

-- =============================================================================
-- 2. department (requisition lookup)
-- =============================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'department' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
    CREATE TABLE dbo.department (
        dep_id   INT IDENTITY(1,1) PRIMARY KEY,
        dep_name NVARCHAR(50) NOT NULL UNIQUE
    );
    INSERT INTO dbo.department (dep_name) SELECT department_name FROM dbo.departments WHERE NOT EXISTS (SELECT 1 FROM dbo.department);
END
GO

-- =============================================================================
-- 3. designation
-- =============================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'designation' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
    CREATE TABLE dbo.designation (
        desg_id   INT IDENTITY(1,1) PRIMARY KEY,
        desg_name NVARCHAR(25) NOT NULL UNIQUE
    );
    INSERT INTO dbo.designation (desg_name) VALUES
        ('Employee'), ('Senior Employee'), ('Team Lead'), ('Manager'), ('HOD'), ('Director'), ('CEO');
END
GO

-- =============================================================================
-- 4. employee_type
-- =============================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'employee_type' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
    CREATE TABLE dbo.employee_type (
        emp_type_id   INT IDENTITY(1,1) PRIMARY KEY,
        emp_type_name NVARCHAR(15) NOT NULL UNIQUE
    );
    INSERT INTO dbo.employee_type (emp_type_name) VALUES
        ('Employee'), ('HOD'), ('Committee'), ('CEO'), ('Procurement'), ('Finance');
END
GO

-- =============================================================================
-- 5. employees
-- =============================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'employees' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
    CREATE TABLE dbo.employees (
        employee_id       INT IDENTITY(1,1) PRIMARY KEY,
        employee_code     NVARCHAR(50) UNIQUE,
        first_name        NVARCHAR(100) NOT NULL,
        last_name         NVARCHAR(100) NOT NULL,
        email             NVARCHAR(255) UNIQUE NOT NULL,
        phone             NVARCHAR(20),
        address           NVARCHAR(500),
        department_id     INT NULL REFERENCES dbo.departments(department_id),
        designation_id    INT NULL REFERENCES dbo.designation(desg_id),
        employee_type_id  INT NULL REFERENCES dbo.employee_type(emp_type_id),
        position          NVARCHAR(100),
        join_date         DATE NULL,
        bio               NVARCHAR(1000),
        password_hash     NVARCHAR(255),
        password          NVARCHAR(255),
        profile_picture   NVARCHAR(500),
        is_active         BIT DEFAULT 1,
        created_at       DATETIME2 DEFAULT GETDATE(),
        updated_at       DATETIME2 DEFAULT GETDATE(),
        password_updated_at DATETIME2 NULL
    );
END
GO

-- =============================================================================
-- 6. users (portal login)
-- =============================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'users' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
    CREATE TABLE dbo.users (
        user_id   INT IDENTITY(1,1) PRIMARY KEY,
        username  NVARCHAR(25) NOT NULL UNIQUE,
        password  NVARCHAR(255) NOT NULL,
        user_type NVARCHAR(20) NOT NULL CHECK (user_type IN ('Admin', 'SuperAdmin', 'Staff', 'User')),
        emp_id    INT NOT NULL UNIQUE REFERENCES dbo.employees(employee_id) ON DELETE CASCADE
    );
    CREATE INDEX IX_users_username ON dbo.users(username);
    CREATE INDEX IX_users_emp_id   ON dbo.users(emp_id);
END
GO

-- =============================================================================
-- 7. salary_slips
-- =============================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'salary_slips' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
    CREATE TABLE dbo.salary_slips (
        salary_slip_id INT IDENTITY(1,1) PRIMARY KEY,
        employee_id    INT NOT NULL REFERENCES dbo.employees(employee_id) ON DELETE CASCADE,
        month_year     DATE NOT NULL,
        basic_salary   DECIMAL(18,2) DEFAULT 0,
        allowances     DECIMAL(18,2) DEFAULT 0,
        bonuses        DECIMAL(18,2) DEFAULT 0,
        deductions     DECIMAL(18,2) DEFAULT 0,
        net_salary     DECIMAL(18,2) NOT NULL,
        status         NVARCHAR(50) DEFAULT 'Paid',
        created_at     DATETIME2 DEFAULT GETDATE()
    );
    CREATE INDEX IX_salary_slips_employee ON dbo.salary_slips(employee_id);
    CREATE INDEX IX_salary_slips_month   ON dbo.salary_slips(month_year);
END
GO

-- =============================================================================
-- 8. leave_balance
-- =============================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'leave_balance' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
    CREATE TABLE dbo.leave_balance (
        employee_id    INT PRIMARY KEY REFERENCES dbo.employees(employee_id) ON DELETE CASCADE,
        annual_leave   INT DEFAULT 15,
        sick_leave     INT DEFAULT 10,
        personal_leave INT DEFAULT 5,
        updated_at     DATETIME2 DEFAULT GETDATE()
    );
END
GO

-- =============================================================================
-- 9. leave_requests
-- =============================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'leave_requests' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
    CREATE TABLE dbo.leave_requests (
        leave_request_id INT IDENTITY(1,1) PRIMARY KEY,
        employee_id      INT NOT NULL REFERENCES dbo.employees(employee_id) ON DELETE CASCADE,
        leave_type       NVARCHAR(50) NOT NULL,
        start_date       DATE NOT NULL,
        end_date         DATE NOT NULL,
        reason           NVARCHAR(500),
        status           NVARCHAR(50) DEFAULT 'Pending',
        created_at       DATETIME2 DEFAULT GETDATE()
    );
    CREATE INDEX IX_leave_requests_employee ON dbo.leave_requests(employee_id);
    CREATE INDEX IX_leave_requests_status  ON dbo.leave_requests(status);
END
GO

-- =============================================================================
-- 10. feedback
-- =============================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'feedback' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
    CREATE TABLE dbo.feedback (
        feedback_id INT IDENTITY(1,1) PRIMARY KEY,
        employee_id INT NOT NULL REFERENCES dbo.employees(employee_id) ON DELETE CASCADE,
        subject     NVARCHAR(200) NOT NULL,
        category    NVARCHAR(100),
        message     NVARCHAR(2000) NOT NULL,
        rating      INT NULL,
        status      NVARCHAR(50) DEFAULT 'Under Review',
        created_at  DATETIME2 DEFAULT GETDATE()
    );
    CREATE INDEX IX_feedback_employee ON dbo.feedback(employee_id);
END
GO

-- =============================================================================
-- 11. requisition (with procurement & finance columns)
-- =============================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'requisition' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
    CREATE TABLE dbo.requisition (
        req_id                      INT IDENTITY(1,1) PRIMARY KEY,
        req_reference_no            NVARCHAR(25) UNIQUE,
        req_emp_id                  INT NOT NULL REFERENCES dbo.employees(employee_id) ON DELETE CASCADE,
        req_location                NVARCHAR(20),
        req_material                NVARCHAR(MAX),
        req_required_by_date        DATE NULL,
        req_business                NVARCHAR(100) DEFAULT 'iTecknologi Tracking Pvt. Ltd',
        req_hod_approval            SMALLINT DEFAULT 0 CHECK (req_hod_approval IN (0, 1)),
        req_hod_approval_date       DATETIME2 NULL,
        req_committee_approval      SMALLINT DEFAULT 0 CHECK (req_committee_approval IN (0, 1)),
        req_committee_approval_date DATETIME2 NULL,
        req_ceo_approval            SMALLINT DEFAULT 0 CHECK (req_ceo_approval IN (0, 1)),
        req_ceo_approval_date       DATETIME2 NULL,
        req_created_at             DATETIME2 DEFAULT GETDATE(),
        req_is_rejected             SMALLINT DEFAULT 0 CHECK (req_is_rejected IN (0, 1)),
        -- Procurement
        req_procurement_ack         SMALLINT DEFAULT 0 CHECK (req_procurement_ack IN (0, 1)),
        req_procurement_ack_date    DATETIME2 NULL,
        req_procurement_ack_by      INT NULL REFERENCES dbo.employees(employee_id),
        req_quotation_1_url         NVARCHAR(500),
        req_quotation_2_url         NVARCHAR(500),
        req_quotation_3_url         NVARCHAR(500),
        req_handed_to_finance       SMALLINT DEFAULT 0 CHECK (req_handed_to_finance IN (0, 1)),
        req_handed_to_finance_date  DATETIME2 NULL,
        -- Finance
        req_finance_approval        SMALLINT DEFAULT 0 CHECK (req_finance_approval IN (0, 1)),
        req_finance_approval_date   DATETIME2 NULL,
        req_finance_approved_by     INT NULL REFERENCES dbo.employees(employee_id),
        req_approved_quotation_index SMALLINT NULL CHECK (req_approved_quotation_index IN (1, 2, 3)),
        req_expected_handover_date  DATE NULL
    );
    CREATE INDEX IX_requisition_emp    ON dbo.requisition(req_emp_id);
    CREATE INDEX IX_requisition_created ON dbo.requisition(req_created_at);
    CREATE INDEX IX_requisition_ref   ON dbo.requisition(req_reference_no);
END
GO

-- =============================================================================
-- 12. requisition_items
-- =============================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'requisition_items' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
    CREATE TABLE dbo.requisition_items (
        item_id      INT IDENTITY(1,1) PRIMARY KEY,
        req_id       INT NOT NULL REFERENCES dbo.requisition(req_id) ON DELETE CASCADE,
        item_desc    NVARCHAR(100),
        item_size    NVARCHAR(25),
        item_brand   NVARCHAR(25),
        item_qty     INT DEFAULT 1,
        item_est_cost NVARCHAR(50),
        item_remarks  NVARCHAR(100)
    );
    CREATE INDEX IX_requisition_items_req ON dbo.requisition_items(req_id);
END
GO

-- =============================================================================
-- Indexes (employees)
-- =============================================================================
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_employees_email' AND object_id = OBJECT_ID('dbo.employees'))
    CREATE INDEX IX_employees_email ON dbo.employees(email);
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_employees_department' AND object_id = OBJECT_ID('dbo.employees'))
    CREATE INDEX IX_employees_department ON dbo.employees(department_id);
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_employees_active' AND object_id = OBJECT_ID('dbo.employees'))
    CREATE INDEX IX_employees_active ON dbo.employees(is_active);
GO

-- =============================================================================
-- Seed: department sync & sample
-- =============================================================================
INSERT INTO dbo.department (dep_name)
SELECT d.department_name FROM dbo.departments d
WHERE NOT EXISTS (SELECT 1 FROM dbo.department dp WHERE dp.dep_name = d.department_name);

IF NOT EXISTS (SELECT 1 FROM dbo.departments WHERE department_name = N'Engineering')
    INSERT INTO dbo.departments (department_name, description) VALUES (N'Engineering', N'Software Development and Engineering');
GO

PRINT 'iteck_erp schema created successfully.';
