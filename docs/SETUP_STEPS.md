# Step-by-Step Setup Guide

Follow these steps in order to run the backend with all recent features (Administration HOD, Payroll fields, Old Salary Slips).

---

## Step 1: Install dependencies

Open a terminal in the project root (`d:\Github\Emp_Portal_BackEnd`) and run:

```bash
npm install
```

---

## Step 2: Configure environment

1. Ensure you have a `.env` file in the project root (you can copy from `.env.example` if it exists).
2. Set your **PostgreSQL** connection (the app uses this for the main database):

   ```env
   DB_DRIVER=postgres
   DB_HOST=localhost
   DB_PORT=5432
   DB_DATABASE=employee_portal
   DB_USER=postgres
   DB_PASSWORD=your_password
   ```

3. If you use other services (Redis, RabbitMQ, etc.), set those in `.env` as well.

---

## Step 3: Create the database (if it doesn’t exist)

If `employee_portal` is not created yet:

```bash
psql -U postgres -c "CREATE DATABASE employee_portal;"
```

(Or create it via pgAdmin / any PostgreSQL client.)

---

## Step 4: Run database migrations

Run these **in order** from the project root. Each command applies one migration to your existing database.

**4.1 – HOD departments (Administration)**  
Required for “HOD of departments” per employee.

```bash
psql -U postgres -d employee_portal -f database/migration-employee-hod-departments.sql
```

**4.2 – Payroll fields**  
Adds loan/salary advance on overrides and new allowance columns on salary structures.

```bash
psql -U postgres -d employee_portal -f database/migration-payroll-fields.sql
```

**4.3 – Old salary slip table**  
Creates the table for legacy slips from SQL Server.

```bash
psql -U postgres -d employee_portal -f database/migration-old-salary-slip.sql
```

**4.4 – Old salary slip Pay Sheet columns**  
Adds all SQL Server Pay Sheet columns to `old_salary_slip`.

```bash
psql -U postgres -d employee_portal -f database/migration-old-salary-slip-paysheet-columns.sql
```

**If the database is brand new (no tables yet):**  
You can skip the migrations above and run the full schema once instead:

```bash
psql -U postgres -d employee_portal -f database/schema.sql
```

---

## Step 5: Start the backend

From the project root:

```bash
npm start
```

Or, if you use a different script (e.g. `node server.js`), run that. The API should be available at the URL shown in the console (e.g. `http://localhost:4000`).

---

## Step 6: Verify (optional)

- **Health:** Open `http://localhost:4000/` or your app’s health/status route if it has one.
- **Administration:**  
  - List departments: `GET /api/administration/departments`  
  - List employees (with HOD): `GET /api/administration/employees?page=1&limit=10`
- **Payroll:**  
  - List periods: `GET /api/payroll/periods`  
  - List salary structures: `GET /api/payroll/salary-structures`
- **Old salary slips:**  
  - List slips for an employee: `GET /api/salary/slips/:employeeId`  
  - Upload old slips: `POST /api/salary/old-slips` with body `{ "slips": [ { "employeeId": 1, "payMonth": "2024-01-01", ... } ] }`

(Use Postman, curl, or your frontend; ensure you send auth headers if the routes are protected.)

---

## Quick checklist

| Step | Action |
|------|--------|
| 1 | `npm install` |
| 2 | Configure `.env` (PostgreSQL and others) |
| 3 | Create database `employee_portal` if needed |
| 4 | Run migrations (4.1 → 4.4) **or** run `schema.sql` on a fresh DB |
| 5 | `npm start` |
| 6 | Test APIs (optional) |

---

## If something fails

- **“relation does not exist” / “table does not exist”**  
  Run the corresponding migration (Step 4) or the full `schema.sql` for a new DB.

- **“password authentication failed”**  
  Check `DB_USER` and `DB_PASSWORD` in `.env` and that the PostgreSQL user can connect to `employee_portal`.

- **Port in use**  
  Change the port in your app config or `.env` (e.g. `PORT=3002`) and restart.

- **Old salary slip upload:**  
  See `docs/OLD_SALARY_SLIP_IMPORT.md` for required fields (`employeeId`, `payMonth`) and column mapping from SQL Server.
