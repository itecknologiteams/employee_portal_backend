# Import from SQL Server Master Salary Slip View

Use the **master view** that has one row per employee per period with full earnings and deductions. The importer maps the view columns below into `old_salary_slip`.

## View columns → old_salary_slip

| View column | old_salary_slip | Notes |
|-------------|-----------------|--------|
| **Payroll_ID** | payroll_id | |
| **HR_Emp_ID** | hr_emp_id | Portal employee_id is resolved via employees.employee_code = HR_Emp_ID |
| **SDT** | pay_month | Period start date (e.g. 2024-07-01). Fallback: Yr + MNTH_NO → YYYY-MM-01 |
| **MNTH_NAME** / **MNTH_SHORT_NAME** | period_label | e.g. "July" / "Jul" |
| **MDays, WDays, ADays, JLDays** | m_days, w_days, a_days, j_l_days | |
| **CO_ID, Dept_ID** | co_id, dept_id | |
| **Basic_Salary_1** | basic_salary, basic_salary_1 | |
| **Medical_Allowance_2** … **Other_Allowance_14** | medical_allowance_2 … other_allowance_14 | Same names with underscores |
| **Tot_Gross_Salary** | gross_salary, tot_gross_salary | |
| **Meal_Allowance_7, Bike_Maintainence_9, Overtime_Allowance_4**, etc. | meal_allowance_7, bike_maintainence_9, … | |
| **Tot_Allowances, Tot_Net_Gross_Allowances** | tot_allowances, tot_net_gross_allowances | |
| **Loan_15, Advance_Salary_16, EOBI_17, Income_Tax_18**, … | loan_15, advance_salary_16, … | |
| **Tot_Deductions, Tot_AC_To_WD, Tot_Net_Salary** | tot_deductions, tot_ac_to_wd, tot_net_salary | |
| **Remarks, Salary_Status** | remarks, status, salary_status | |
| **Leaves_29, Conveyance_Liters_Allowance_28**, etc. | leaves_29, conveyance_liters_allowance_28 | |

Columns like Emp_Name, Gender, CNIC_No, Bank_Name, etc. are not stored in `old_salary_slip` (display-only table). If the view has no **ID** column, `source_slip_id` is left null.

---

## Steps

### 1. Export the view to JSON

From the project root, using your **view name**:

```bash
python scripts/fetch_salary_slips_from_sqlserver.py --output slips.json --table YourMasterViewName
```

Set `MSSQL_DATABASE` in `.env` if the view is in another database. The script keeps column names as in the view (e.g. `Payroll_ID`, `HR_Emp_ID`, `Tot_Net_Salary`).

### 2. Import into old_salary_slip

```bash
node scripts/import-old-salary-slips.js slips.json
```

- **employee_id** is set from **HR_Emp_ID** by matching `employees.employee_code` in the portal. Ensure each employee has `employee_code` = their HR_Emp_ID (e.g. 10001).
- **pay_month** is taken from **SDT** (or from **Yr** + **MNTH_NO** if SDT is missing).

### 3. Display in the app

- **List:** `GET /salary/old-slips/:employeeId` or `GET /api/salary/old-slips/:employeeId`
- **Detail:** `GET /api/salary/old-slip/:id?employeeId=...`

The "Old salary slips" tab will show the imported rows for employees with matching `employee_code`.
