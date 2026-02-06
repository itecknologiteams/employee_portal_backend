-- SQL Server Database Schema for Employee Portal
-- Database: ATS_HRMS

-- Create Departments Table
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[Departments]') AND type in (N'U'))
BEGIN
    CREATE TABLE Departments (
        DepartmentID INT PRIMARY KEY IDENTITY(1,1),
        DepartmentName NVARCHAR(100) NOT NULL,
        Description NVARCHAR(500),
        CreatedDate DATETIME DEFAULT GETDATE()
    );
END

-- Create Employees Table
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[Employees]') AND type in (N'U'))
BEGIN
    CREATE TABLE Employees (
        EmployeeID INT PRIMARY KEY IDENTITY(1,1),
        EmployeeCode NVARCHAR(50) UNIQUE,
        FirstName NVARCHAR(100) NOT NULL,
        LastName NVARCHAR(100) NOT NULL,
        Email NVARCHAR(255) UNIQUE NOT NULL,
        Phone NVARCHAR(20),
        Address NVARCHAR(500),
        DepartmentID INT,
        Position NVARCHAR(100),
        JoinDate DATETIME,
        Bio NVARCHAR(1000),
        PasswordHash NVARCHAR(255), -- For bcrypt hashed passwords
        Password NVARCHAR(255), -- For plain text passwords (legacy support)
        ProfilePicture NVARCHAR(500),
        IsActive BIT DEFAULT 1,
        CreatedDate DATETIME DEFAULT GETDATE(),
        UpdatedDate DATETIME,
        PasswordUpdatedDate DATETIME,
        FOREIGN KEY (DepartmentID) REFERENCES Departments(DepartmentID)
    );
END

-- Create SalarySlips Table
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[SalarySlips]') AND type in (N'U'))
BEGIN
    CREATE TABLE SalarySlips (
        SalarySlipID INT PRIMARY KEY IDENTITY(1,1),
        EmployeeID INT NOT NULL,
        MonthYear DATETIME NOT NULL,
        BasicSalary DECIMAL(18,2) DEFAULT 0,
        Allowances DECIMAL(18,2) DEFAULT 0,
        Bonuses DECIMAL(18,2) DEFAULT 0,
        Deductions DECIMAL(18,2) DEFAULT 0,
        NetSalary DECIMAL(18,2) NOT NULL,
        Status NVARCHAR(50) DEFAULT 'Paid',
        CreatedDate DATETIME DEFAULT GETDATE(),
        FOREIGN KEY (EmployeeID) REFERENCES Employees(EmployeeID)
    );
END

-- Create LeaveBalance Table
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[LeaveBalance]') AND type in (N'U'))
BEGIN
    CREATE TABLE LeaveBalance (
        EmployeeID INT PRIMARY KEY,
        AnnualLeave INT DEFAULT 15,
        SickLeave INT DEFAULT 10,
        PersonalLeave INT DEFAULT 5,
        UpdatedDate DATETIME DEFAULT GETDATE(),
        FOREIGN KEY (EmployeeID) REFERENCES Employees(EmployeeID)
    );
END

-- Create LeaveRequests Table
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[LeaveRequests]') AND type in (N'U'))
BEGIN
    CREATE TABLE LeaveRequests (
        LeaveRequestID INT PRIMARY KEY IDENTITY(1,1),
        EmployeeID INT NOT NULL,
        LeaveType NVARCHAR(50) NOT NULL,
        StartDate DATETIME NOT NULL,
        EndDate DATETIME NOT NULL,
        Reason NVARCHAR(500),
        Status NVARCHAR(50) DEFAULT 'Pending',
        CreatedDate DATETIME DEFAULT GETDATE(),
        FOREIGN KEY (EmployeeID) REFERENCES Employees(EmployeeID)
    );
END

-- Create Feedback Table
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[Feedback]') AND type in (N'U'))
BEGIN
    CREATE TABLE Feedback (
        FeedbackID INT PRIMARY KEY IDENTITY(1,1),
        EmployeeID INT NOT NULL,
        Subject NVARCHAR(200) NOT NULL,
        Category NVARCHAR(100),
        Message NVARCHAR(2000) NOT NULL,
        Rating INT,
        Status NVARCHAR(50) DEFAULT 'Under Review',
        CreatedDate DATETIME DEFAULT GETDATE(),
        FOREIGN KEY (EmployeeID) REFERENCES Employees(EmployeeID)
    );
END

-- Create Requisitions Table
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[Requisitions]') AND type in (N'U'))
BEGIN
    CREATE TABLE Requisitions (
        RequisitionID INT PRIMARY KEY IDENTITY(1,1),
        EmployeeID INT NOT NULL,
        ItemName NVARCHAR(200) NOT NULL,
        Category NVARCHAR(100),
        Quantity INT NOT NULL,
        Description NVARCHAR(1000),
        Priority NVARCHAR(50) DEFAULT 'Medium',
        Status NVARCHAR(50) DEFAULT 'Pending',
        CreatedDate DATETIME DEFAULT GETDATE(),
        FOREIGN KEY (EmployeeID) REFERENCES Employees(EmployeeID)
    );
END

-- Create Indexes
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Employees_Email' AND object_id = OBJECT_ID('Employees'))
    CREATE INDEX IX_Employees_Email ON Employees(Email);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Employees_DepartmentID' AND object_id = OBJECT_ID('Employees'))
    CREATE INDEX IX_Employees_DepartmentID ON Employees(DepartmentID);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Employees_IsActive' AND object_id = OBJECT_ID('Employees'))
    CREATE INDEX IX_Employees_IsActive ON Employees(IsActive);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_SalarySlips_EmployeeID' AND object_id = OBJECT_ID('SalarySlips'))
    CREATE INDEX IX_SalarySlips_EmployeeID ON SalarySlips(EmployeeID);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_SalarySlips_MonthYear' AND object_id = OBJECT_ID('SalarySlips'))
    CREATE INDEX IX_SalarySlips_MonthYear ON SalarySlips(MonthYear);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_LeaveRequests_EmployeeID' AND object_id = OBJECT_ID('LeaveRequests'))
    CREATE INDEX IX_LeaveRequests_EmployeeID ON LeaveRequests(EmployeeID);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_LeaveRequests_Status' AND object_id = OBJECT_ID('LeaveRequests'))
    CREATE INDEX IX_LeaveRequests_Status ON LeaveRequests(Status);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Feedback_EmployeeID' AND object_id = OBJECT_ID('Feedback'))
    CREATE INDEX IX_Feedback_EmployeeID ON Feedback(EmployeeID);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Requisitions_EmployeeID' AND object_id = OBJECT_ID('Requisitions'))
    CREATE INDEX IX_Requisitions_EmployeeID ON Requisitions(EmployeeID);

-- Insert sample department if it doesn't exist
IF NOT EXISTS (SELECT * FROM Departments WHERE DepartmentName = 'Engineering')
    INSERT INTO Departments (DepartmentName, Description)
    VALUES ('Engineering', 'Software Development and Engineering');

PRINT 'Database schema created successfully!';