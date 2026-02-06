-- Insert user: Ali Asif
-- Email: ali.asif@itecknologi.com
-- Password: Sheikh@1364 (will be hashed by application)

-- Note: This SQL script inserts with plain text password
-- For production, use the Node.js script (npm run insert-user) which hashes the password

-- First, ensure the department exists (if needed)
IF NOT EXISTS (SELECT * FROM Departments WHERE DepartmentName = 'Engineering')
    INSERT INTO Departments (DepartmentName, Description)
    VALUES ('Engineering', 'Software Development and Engineering');

-- Insert the employee
-- Note: Password will be stored as plain text initially
-- Use the Node.js script for bcrypt hashing: npm run insert-user
IF NOT EXISTS (SELECT * FROM Employees WHERE Email = 'ali.asif@itecknologi.com')
BEGIN
    INSERT INTO Employees (
        EmployeeCode,
        FirstName,
        LastName,
        Email,
        Password,
        IsActive,
        JoinDate,
        CreatedDate
    )
    VALUES (
        'EMP-ALI-001',
        'Ali',
        'Asif',
        'ali.asif@itecknologi.com',
        'Sheikh@1364',
        1,
        GETDATE(),
        GETDATE()
    );
    
    -- Initialize leave balance
    INSERT INTO LeaveBalance (EmployeeID, AnnualLeave, SickLeave, PersonalLeave)
    SELECT EmployeeID, 15, 10, 5 
    FROM Employees 
    WHERE Email = 'ali.asif@itecknologi.com';
    
    PRINT 'User ali.asif@itecknologi.com created successfully!';
END
ELSE
BEGIN
    PRINT 'User already exists with email: ali.asif@itecknologi.com';
END