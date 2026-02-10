# Database Setup

## SQL Server (temporary / iteck_erp)

**Connection:** `192.168.20.166` | User: `tech` | DB: `iteck_erp`

1. Create the database on SQL Server:
   ```sql
   CREATE DATABASE iteck_erp;
   ```
2. Run the full schema script (creates all tables, indexes, seeds):
   ```bash
   sqlcmd -S 192.168.20.166 -U tech -P tech -d iteck_erp -i database/iteck_erp-schema.sql
   ```
   Or open `database/iteck_erp-schema.sql` in SSMS and execute against `iteck_erp`.
3. In `server/.env` set:
   ```
   DB_DRIVER=sqlserver
   DB_HOST=192.168.20.166
   DB_DATABASE=iteck_erp
   DB_USER=tech
   DB_PASSWORD=tech
   ```
4. Install dependency and start server: `npm install && npm start`

To switch back to PostgreSQL, set `DB_DRIVER=postgres` (or remove `DB_DRIVER`) and set PostgreSQL `DB_*` vars.

---

## PostgreSQL Database Setup

**Why do tables keep disappearing?** The backend does **not** run migrations or schema on startup. Tables exist only after you run a schema script. If the database is recreated (new machine, restored backup, someone ran `DROP DATABASE`, Docker reset, etc.), you must run the schema again. From the project root run: `npm run db:schema` (or use the psql command below).

### Prerequisites

1. Install PostgreSQL on your system
2. Create a database named `employee_portal`

## Setup Steps

### 1. Create Database

```bash
# Connect to PostgreSQL
psql -U postgres

# Create database
CREATE DATABASE employee_portal;

# Connect to the database
\c employee_portal;
```

### 2. Run Schema Script (single file – all tables)

One schema file creates every table, index, trigger, and seed data:

```bash
# From the project root
psql -U postgres -d employee_portal -f database/schema.sql
```

Or from psql: `\c employee_portal` then `\i database/schema.sql`

**Tables created:** `departments`, `designation`, `employee_type`, `station`, `city`, `employees`, `users`, `leave_balance`, `leave_requests`, `feedback`, `salary_slips`, `requisition`, `requisition_items`, and legacy `department`. No other schema files are required.

### 3. Create Test Employee

You have two options:

#### Option A: Use the Register Endpoint

```bash
POST http://localhost:3001/api/auth/register
Content-Type: application/json

{
  "employeeCode": "EMP-001",
  "firstName": "John",
  "lastName": "Doe",
  "email": "john.doe@company.com",
  "password": "password123",
  "phone": "+1234567890",
  "departmentId": 1,
  "position": "Senior Software Engineer"
}
```

#### Option B: Insert Manually (with hashed password)

First, generate a password hash using Node.js:

```javascript
const bcrypt = require('bcryptjs');
const hash = bcrypt.hashSync('password123', 10);
console.log(hash);
```

Then insert:

```sql
INSERT INTO employees (
    employee_code, 
    first_name, 
    last_name, 
    email, 
    password_hash, 
    is_active
) VALUES (
    'EMP-001', 
    'John', 
    'Doe', 
    'john.doe@company.com', 
    '<generated_hash>', 
    true
);
```

## Environment Variables

Update `server/.env`:

```env
DB_HOST=localhost
DB_DATABASE=employee_portal
DB_USER=postgres
DB_PASSWORD=your_password
DB_PORT=5432
```

## Default Test Credentials

After setup, you can login with:
- **Email**: john.doe@company.com
- **Password**: password123

(Or use the credentials you created)

## Users Table (Portal Authentication)

The `users` table is created by `schema.sql`. It has:

- `user_id` – primary key
- `username` – VARCHAR(25), unique
- `password` – VARCHAR(255), bcrypt hash
- `user_type` – Admin, SuperAdmin, Staff, User
- `emp_id` – FK to employees(employee_id), one user per employee

Login accepts **username** or **email** plus password: if a matching `users` row exists (by username), that is used; otherwise login falls back to `employees` (by email). In Administration → Employees, use the **Portal credentials** section to set username, password, and user type.

## Requisition (HOD → Committee → CEO → Procurement → Finance)

`requisition` and `requisition_items` are in `schema.sql`. To enable the approval flow, set `employee_type_id` on employees:

```sql
-- Example: set employee 1 as HOD of their department
UPDATE employees SET employee_type_id = (SELECT emp_type_id FROM employee_type WHERE emp_type_name = 'HOD') WHERE employee_id = 1;

-- Committee, CEO, Procurement
UPDATE employees SET employee_type_id = (SELECT emp_type_id FROM employee_type WHERE emp_type_name = 'Committee') WHERE employee_id = 2;
UPDATE employees SET employee_type_id = (SELECT emp_type_id FROM employee_type WHERE emp_type_name = 'CEO') WHERE employee_id = 3;
UPDATE employees SET employee_type_id = (SELECT emp_type_id FROM employee_type WHERE emp_type_name = 'Procurement') WHERE employee_id = 4;
```

API endpoints:

- **Create**: `POST /api/requisition/create` – body: `{ employeeId, location?, material?, priority?, items: [{ itemDesc, itemSize?, itemBrand?, itemQty?, itemEstCost?, itemRemarks? }] }`
- **My history**: `GET /api/requisition/history/:employeeId`
- **Pending for HOD**: `GET /api/requisition/pending/hod/:employeeId` (HOD = same department, employee_type = HOD)
- **Pending for Committee**: `GET /api/requisition/pending/committee/:employeeId`
- **Pending for CEO**: `GET /api/requisition/pending/ceo/:employeeId`
- **Forwarded to Procurement**: `GET /api/requisition/pending/procurement/:employeeId`
- **Approve/Reject**: `POST /api/requisition/approve/hod`, `.../approve/committee`, `.../approve/ceo` – body: `{ requisitionId, approvedByEmployeeId, approved: true|false }`

## Database Tables (all in `schema.sql`)

| Table | Purpose |
|-------|---------|
| `departments` | Department list |
| `designation` | Designation (Employee, HOD, Manager, CEO, etc.) |
| `employee_type` | Type for approval flow (HOD, Committee, CEO, Procurement, Finance) |
| `station` | Station (employees assigned to a station) |
| `city` | City, linked to station |
| `employees` | Employee info, FKs to department, designation, employee_type, station, city |
| `users` | Portal login (username, password, user_type, emp_id) |
| `role_permissions` | Default permissions per role (Admin, Staff, User): role_name, permission_key, allowed |
| `user_permissions` | Per-employee permission overrides: emp_id, permission_key, allowed |
| `leave_balance` | Annual/sick/personal leave per employee |
| `leave_requests` | Leave requests |
| `feedback` | Feedback submissions |
| `salary_slips` | Salary records |
| `requisition` | Requisition with full approval workflow and reference number |
| `requisition_items` | Line items (with HOD BOQ and Committee approved qty) |
| `payroll_period` | Payroll period (name, start/end date, working days, status) |
| `payroll_slip` | Generated slip per employee per period (gross, allowances, deductions, net) |
| `payroll_period_employee_override` | Override working days / other allowance-deduction per employee per period |
| `designation_allowance` | Fixed allowance per designation |
| `employee_salary_structure` | Basic + allowances (medical, conveyance, HRA, etc.) per employee |
| `department` | Legacy Dep_ID, Dep_Name (synced from `departments`) |

## Other schema files (can be removed)

After using the single `schema.sql`, these are **redundant** and can be deleted if you no longer need them for reference or migrations:

- `postgresql-schema.sql`, `postgresql-full-schema.sql` – superseded by `schema.sql`
- `users-schema.sql` – `users` is in `schema.sql`
- `requisition-schema.sql` – requisition tables are in `schema.sql`

Migrations (`migration-*.sql`, `requisition-*-migration-pg.sql`, etc.) were one-time changes; their column/table changes are already included in `schema.sql`. Keep migration files only if you need to track history.