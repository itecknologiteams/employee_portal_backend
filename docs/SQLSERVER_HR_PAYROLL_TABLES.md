# SQL Server HR Payroll Tables Reference

Reference for the payroll structure used when fetching salary slips and computing **Pay_Month**.

---

## Tables

### HR_Payroll_Elements

| Column           | Description                          |
|------------------|--------------------------------------|
| Element_ID       | 1–31 (maps to Pay Sheet columns _1, _2, … _31) |
| Element_Name     | e.g. Basic Salary, Medical Allowance |
| Element_Type     | Allowance / Deduction / Adjust       |
| Element_Category | Fixed Gross, Additional, etc.        |
| Cal_Type         | Fixed / Calculate / Adjust           |
| SeqNo            | Display order                        |

Element_ID maps to Pay Sheet numbered columns (e.g. Basic_Salary_1, Medical_Allowance_2, …, Incremental_Arrears_31).

---

### HR_PAYROLL_PERIOD

| Column         | Description        |
|----------------|--------------------|
| Payroll_ID     | PK; links to Pay Sheet.Payroll_ID |
| PERIOD_ID      | Period set         |
| FYID           | FK → HR_FinYearMstr |
| MNTH_ID        | FK → HR_PAYROLL_MONTH |
| PERIOD_STATUS  | 0/1                |
| PAYROLL_FINAL  | 0/1                |
| PAYSHEET_FINAL | 0/1                |

---

### HR_PAYROLL_MONTH

| Column         | Description        |
|----------------|--------------------|
| MNTH_ID        | PK 1–12            |
| MNTH_NO        | Calendar month 1–12 (Jan=1, …, Dec=12) |
| MNTH_NAME      | January, February, … |
| MNTH_SHORT_NAME| Jan, Feb, …        |

---

### HR_FinYearMstr

| Column  | Description        |
|---------|--------------------|
| FYID    | PK                 |
| FinYear | e.g. `2024-2025`   |
| FYStatus| 0/1                |

---

## Pay_Month derivation

For each Pay Sheet row:

1. Join **Pay_Sheet** → **HR_PAYROLL_PERIOD** on `Payroll_ID`.
2. Join **HR_PAYROLL_PERIOD** → **HR_PAYROLL_MONTH** on `MNTH_ID`.
3. Join **HR_PAYROLL_PERIOD** → **HR_FinYearMstr** on `FYID`.
4. **Pay_Month** = first day of that month:
   - Year = first 4 characters of `FinYear` (e.g. `2024` from `2024-2025`).
   - Month = `MNTH_NO` (1–12).
   - Day = 1.

Example: FinYear `2024-2025`, MNTH_NO `7` → Pay_Month `2024-07-01`.

The Python script `scripts/fetch_salary_slips_from_sqlserver.py --with-pay-month` does this join and adds a **Pay_Month** column to the JSON. Use that as **payMonth** when importing into the portal (rename in JSON or in a small script if needed).
