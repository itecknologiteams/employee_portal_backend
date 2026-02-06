-- PostgreSQL Database Schema for Employee Portal
-- Database: employee_portal
-- Server: 192.168.20.21

-- Note: First create the database manually:
CREATE DATABASE employee_portal;

-- Connect to the database:
\c employee_portal;

-- Create Departments Table
CREATE TABLE IF NOT EXISTS departments (
    department_id SERIAL PRIMARY KEY,
    department_name VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create Employees Table
CREATE TABLE IF NOT EXISTS employees (
    employee_id SERIAL PRIMARY KEY,
    employee_code VARCHAR(50) UNIQUE,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20),
    address TEXT,
    department_id INTEGER,
    position VARCHAR(100),
    join_date DATE,
    bio TEXT,
    password_hash VARCHAR(255), -- For bcrypt hashed passwords
    password VARCHAR(255), -- For plain text passwords (legacy support)
    profile_picture VARCHAR(500),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    password_updated_at TIMESTAMP,
    FOREIGN KEY (department_id) REFERENCES departments(department_id)
);

-- Create Salary Slips Table
CREATE TABLE IF NOT EXISTS salary_slips (
    salary_slip_id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL,
    month_year DATE NOT NULL,
    basic_salary DECIMAL(18,2) DEFAULT 0,
    allowances DECIMAL(18,2) DEFAULT 0,
    bonuses DECIMAL(18,2) DEFAULT 0,
    deductions DECIMAL(18,2) DEFAULT 0,
    net_salary DECIMAL(18,2) NOT NULL,
    status VARCHAR(50) DEFAULT 'Paid',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(employee_id) ON DELETE CASCADE
);

-- Create Leave Balance Table
CREATE TABLE IF NOT EXISTS leave_balance (
    employee_id INTEGER PRIMARY KEY,
    annual_leave INTEGER DEFAULT 15,
    sick_leave INTEGER DEFAULT 10,
    personal_leave INTEGER DEFAULT 5,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(employee_id) ON DELETE CASCADE
);

-- Create Leave Requests Table
CREATE TABLE IF NOT EXISTS leave_requests (
    leave_request_id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL,
    leave_type VARCHAR(50) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    reason TEXT,
    status VARCHAR(50) DEFAULT 'Pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(employee_id) ON DELETE CASCADE
);

-- Create Feedback Table
CREATE TABLE IF NOT EXISTS feedback (
    feedback_id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL,
    subject VARCHAR(200) NOT NULL,
    category VARCHAR(100),
    message TEXT NOT NULL,
    rating INTEGER,
    status VARCHAR(50) DEFAULT 'Under Review',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(employee_id) ON DELETE CASCADE
);

-- Create Requisitions Table
CREATE TABLE IF NOT EXISTS requisitions (
    requisition_id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL,
    item_name VARCHAR(200) NOT NULL,
    category VARCHAR(100),
    quantity INTEGER NOT NULL,
    description TEXT,
    priority VARCHAR(50) DEFAULT 'Medium',
    status VARCHAR(50) DEFAULT 'Pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(employee_id) ON DELETE CASCADE
);

-- Create Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_employees_email ON employees(email);
CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department_id);
CREATE INDEX IF NOT EXISTS idx_employees_active ON employees(is_active);
CREATE INDEX IF NOT EXISTS idx_salary_slips_employee ON salary_slips(employee_id);
CREATE INDEX IF NOT EXISTS idx_salary_slips_month ON salary_slips(month_year);
CREATE INDEX IF NOT EXISTS idx_leave_requests_employee ON leave_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests(status);
CREATE INDEX IF NOT EXISTS idx_feedback_employee ON feedback(employee_id);
CREATE INDEX IF NOT EXISTS idx_requisitions_employee ON requisitions(employee_id);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for employees table
DROP TRIGGER IF EXISTS update_employees_updated_at ON employees;
CREATE TRIGGER update_employees_updated_at BEFORE UPDATE ON employees
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert sample department
INSERT INTO departments (department_name, description) 
VALUES ('Engineering', 'Software Development and Engineering')
ON CONFLICT DO NOTHING;

-- Note: To insert the user ali.asif@itecknologi.com, use the Node.js script:
-- npm run insert-user
-- Or use the register API endpoint

-- Schema creation complete
SELECT 'Database schema created successfully!' as message;