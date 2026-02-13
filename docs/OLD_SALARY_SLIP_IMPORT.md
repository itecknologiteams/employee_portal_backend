# Old Salary Slip Import (SQL Server Pay Sheet)

The `old_salary_slip` table stores legacy salary slip data imported from the SQL Server Pay Sheet. The backend accepts the same column names as SQL Server (or camelCase equivalents).

## Required when importing

- **payMonth** (or **Pay_Month**) – Date of the pay period (e.g. first day of month: `2024-01-01`). In SQL Server this usually comes from the **Payroll** table or from the Python script with `--with-pay-month`.
- **employeeId** – Portal `employees.employee_id`. **Optional** if **HR_Emp_ID** is present: the importer resolves it by matching `employees.employee_code` to `HR_Emp_ID`. Ensure portal employees have `employee_code` set to the same value as SQL Server’s `HR_Emp_ID` (e.g. `10001`).

## SQL Server Pay Sheet → API / DB

| SQL Server (Pay Sheet) | API/DB field | Notes |
|------------------------|--------------|--------|
| ID | source_slip_id | Original slip ID |
| Payroll_ID | payroll_id | |
| HR_Emp_ID | hr_emp_id | Not used as FK; map to employeeId for portal |
| CO_ID | co_id | |
| Dept_ID | dept_id | |
| MDays, WDays, ADays, JLDays | m_days, w_days, a_days, j_l_days | |
| GrossSalary | gross_salary | |
| Basic_Salary_1 … Other_Allowance_14 | basic_salary_1 … other_allowance_14 | |
| Loan_15 … Other_Deduction_25 | loan_15 … other_deduction_25 | |
| Mobile_Installment_26, Food_Panda_27, etc. | mobile_installment_26, food_panda_27, … | |
| Conveyance_Liters_Allowance_28, Leaves_29, Incremental_Arrears_31 | conveyance_liters_allowance_28, leaves_29, incremental_arrears_31 | |
| Tot_Gross_Salary, Tot_Allowances, Tot_Deductions, Tot_Net_Salary | tot_gross_salary, tot_allowances, tot_deductions, tot_net_salary | |
| Remarks, Salary_Status | remarks, salary_status | |

You can send either **SQL Server names** (e.g. `Payroll_ID`, `HR_Emp_ID`, `GrossSalary`, `Tot_Net_Salary`) or **camelCase** (e.g. `payrollId`, `hrEmpId`, `grossSalary`, `totNetSalary`). Both are accepted.

## Fetch from SQL Server (Python script)

A Python script reads the Pay Sheet table from SQL Server and writes JSON with column names.

**1. Install:** `pip install -r scripts/requirements-sqlserver.txt` (or `pip install pyodbc python-dotenv`)

**2. Set connection** in `.env` or environment:

- `MSSQL_SERVER`, `MSSQL_DATABASE`, `MSSQL_USER`, `MSSQL_PASSWORD`
- Optional: `MSSQL_TABLE=Pay_Sheet`, `MSSQL_PAYROLL_TABLE=Payroll`

**3. Run:**

```bash
# Write all rows to slips.json
python scripts/fetch_salary_slips_from_sqlserver.py --output slips.json

# Add Pay_Month using HR_PAYROLL_PERIOD + HR_PAYROLL_MONTH + HR_FinYearMstr (recommended)
python scripts/fetch_salary_slips_from_sqlserver.py --output slips.json --with-pay-month

# Other table: --table YourTable
# Test with 10 rows: --limit 10
```

With `--with-pay-month`, the script joins your HR tables to compute the first day of the pay month (e.g. `2024-07-01`) and adds it as **Pay_Month**. See `docs/SQLSERVER_HR_PAYROLL_TABLES.md` for the table layout.

**4. Before importing:** If you used `--with-pay-month`, each row already has **Pay_Month** (used as pay month). **employeeId** is optional: if you omit it, the importer looks up the portal employee by `employees.employee_code = HR_Emp_ID`. Ensure your portal `employees` table has `employee_code` set to the HR employee ID (e.g. `10001`). Then run the Node import (see below).

---

## Bulk import (recommended for 1000+ rows)

For **5552 rows** (or any large file), use the Node script so all rows are inserted in batches (no HTTP size limits):

1. **Get JSON:** Use the Python script above to export from SQL Server (with `--with-pay-month` so each row has **Pay_Month**). No need to add **employeeId** if `employees.employee_code` in the portal matches **HR_Emp_ID**. The file must be an **array** of rows, or `{ "slips": [ ... ] }`.

2. From the project root run:

   ```bash
   node scripts/import-old-salary-slips.js path/to/your-slips.json
   ```

   Or with npm:

   ```bash
   npm run import-old-slips -- path/to/your-slips.json
   ```

3. The script inserts in batches of 100 rows. It will print how many rows were inserted and how many were skipped (missing `employeeId` or `payMonth`).

**Example file shape (minimal):**

```json
[
  { "employeeId": 370, "payMonth": "2024-01-01", "Payroll_ID": 10, "Tot_Net_Salary": 23870, "Tot_Deductions": 6130 },
  { "employeeId": 370, "payMonth": "2024-02-01", "Payroll_ID": 11, "Tot_Net_Salary": 29870 }
]
```

---

## Upload API (smaller batches)

`POST /api/salary/old-slips`

Body: array of rows, or `{ "slips": [ ... ] }`. Each row must include at least:

- `employeeId` (portal)
- `payMonth` (e.g. `"2024-01-01"`)

Example (SQL Server–style names; add `employeeId` and `payMonth` from your mapping and Payroll table):

```json
{
  "slips": [
    {
      "employeeId": 370,
      "payMonth": "2024-01-01",
      "Payroll_ID": 10,
      "HR_Emp_ID": 10608,
      "GrossSalary": 30000,
      "Basic_Salary_1": 17550,
      "Medical_Allowance_2": 1950,
      "House_Rent_Allowance_5": 8700,
      "Utilities_Allowance_6": 1800,
      "EOBI_17": 130,
      "Absent_Days_19": 6000,
      "Tot_Gross_Salary": 30000,
      "Tot_Allowances": 0,
      "Tot_Deductions": 6130,
      "Tot_Net_Salary": 23870,
      "Remarks": "",
      "Salary_Status": null
    }
  ]
}
```

## Migrations

1. `database/migration-old-salary-slip.sql` – creates `old_salary_slip` (base columns).
2. `database/migration-old-salary-slip-paysheet-columns.sql` – adds all Pay Sheet columns (ID, Payroll_ID, HR_Emp_ID, numbered allowances/deductions, Tot_*, etc.).

Run both on existing DBs. New installs get the full table from `schema.sql`.
