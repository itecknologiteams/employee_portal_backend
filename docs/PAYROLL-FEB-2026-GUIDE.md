# Run Payroll for February 2026

This guide explains how to run payroll for **February 2026** using your three Excel/CSV sheets and the Employee Portal backend.

---

## Your Sheets

| File | Purpose |
|------|--------|
| **1. iTecknologi Payroll - February 2026.csv** | Main payroll: Employee ID, Basic Salary, allowances, deductions, Total, etc. Used to load **salary structures** and **gross salaries**. |
| **Allowances Sheet February 2026.csv** | Overtime & incentives: Employee Code, OT PKR, PKR amount. Used to set **period overrides** (other allowance) for Feb 2026. |
| **I.Tax working Feb 2025-2026 ..csv** | Bank/cheque payment log (Emp ID, Amount). Optional; not required to *run* payroll in the portal. Use for your own records. |

---

## Prerequisites

1. **Backend running** (e.g. `npm run dev` in `Emp_Portal_BackEnd`).
2. **Database** has payroll tables and employees (from your schema/migrations).
3. **Base URL** for API (e.g. `http://localhost:5000` or your deployed URL). Replace in the examples below if different.

---

## Step 1: Create the February 2026 period

Create a payroll period for February 2026 (draft).

**Request:**

```http
POST /api/payroll/periods
Content-Type: application/json

{
  "name": "February 2026",
  "startDate": "2026-02-01",
  "endDate": "2026-02-28",
  "workingDays": 20
}
```

- Adjust **workingDays** to your company’s working days in Feb 2026 (e.g. 20 or 30).
- Example with `curl` (replace `BASE_URL` and add auth if needed):

```bash
curl -X POST "BASE_URL/api/payroll/periods" -H "Content-Type: application/json" -d "{\"name\":\"February 2026\",\"startDate\":\"2026-02-01\",\"endDate\":\"2026-02-28\",\"workingDays\":20}"
```

**Response:** `{ "id": 123, "name": "February 2026", "startDate": "2026-02-01", "endDate": "2026-02-28", "workingDays": 20, "status": "draft", ... }`

**Note the `id`** (e.g. `123`). You will use it as `PERIOD_ID` in the next steps.

---

## Step 2: Import salary structures from the main payroll sheet

Upload **1. iTecknologi Payroll - February 2026.csv** so the system has each employee’s Basic Salary and allowances (and gross).

**Request:**

```http
POST /api/payroll/payroll-sheet/upload
Content-Type: multipart/form-data
file: <your file "1. iTecknologi Payroll - February 2026.csv">
```

- The importer **skips title rows** and finds the row that contains **"Employee ID"** as the header row.
- It then reads: Basic Salary, Medical Allowance, Fixed Conveyance, Conveyance in Liters, Communication, House Allow., Utilities, Meal, Arrears, Incremental Arrears, Bike Maintenance, Incentives, Device Reimbursement, Total, EOBI.
- For each row it: resolves **Employee ID** → employee in DB, then **upserts** gross salary and full salary structure.

**Example with curl:**

```bash
curl -X POST "BASE_URL/api/payroll/payroll-sheet/upload" -F "file=@Excel/1. iTecknologi Payroll - February 2026.csv"
```

**Response:** `{ "message": "Payroll sheet imported: N employee(s) updated.", "added": N, "totalRows": ..., "errors": [] }`

- If there are **errors** (e.g. employee not found), fix the CSV or add missing employees and re-upload.

---

## Step 3: Upload period overrides (Allowances sheet)

Upload **Allowances Sheet February 2026.csv** for the **same period** so overtime and incentives are applied as **other allowance** for February 2026.

**Request:**

```http
POST /api/payroll/periods/PERIOD_ID/overrides/upload
Content-Type: multipart/form-data
file: <your file "Allowances Sheet February 2026.csv">
```

- Replace **PERIOD_ID** with the id from Step 1.
- The importer finds the row that contains **"Employee Code"** (so title rows like "Overtime & Incentive January 2025" are skipped).
- It uses **OT PKR** and **PKR amount** (incentives) and sets **other_allowance = OT PKR + PKR amount** for that period.

**Example with curl:**

```bash
curl -X POST "BASE_URL/api/payroll/periods/123/overrides/upload" -F "file=@Excel/Allowances Sheet February 2026.csv"
```

**Response:** `{ "message": "Overrides uploaded: N employee(s) updated for this period.", "added": N, "totalRows": ..., "errors": [] }`

---

## Step 4: Run payroll

Trigger the payroll run for February 2026. This uses:

- Salary structures (from Step 2),
- Period overrides (from Step 3: OT + incentives as other allowance),
- Approved leaves in the period,
- Working days (default for the period or overridden per employee).

**Request:**

```http
POST /api/payroll/periods/PERIOD_ID/run
```

**Example with curl:**

```bash
curl -X POST "BASE_URL/api/payroll/periods/123/run"
```

**Response:** `{ "message": "Payroll run completed", "periodId": 123, "employeesProcessed": N, "workingDays": 20, "status": "processed" }`

- After this, the period status becomes **processed** and salary slips are generated.

---

## Step 5: View slips and close period

- **List slips:**  
  `GET /api/payroll/periods/PERIOD_ID/slips?page=1&limit=100`
- **Close period** (when you are done and no more edits):  
  `POST /api/payroll/periods/PERIOD_ID/close`

---

## Summary checklist

| Step | Action | File / Data |
|------|--------|-------------|
| 1 | Create period | name: "February 2026", start: 2026-02-01, end: 2026-02-28, workingDays: 20 |
| 2 | Upload payroll sheet | **1. iTecknologi Payroll - February 2026.csv** → salary structures + gross |
| 3 | Upload overrides | **Allowances Sheet February 2026.csv** → OT + incentives as other allowance |
| 4 | Run payroll | `POST .../periods/PERIOD_ID/run` |
| 5 | View slips / close period | `GET .../slips`, `POST .../close` |

---

## I.Tax working Feb 2025-2026 ..csv

This file is a bank/cheque log (Emp ID, Amount, etc.). The portal does **not** use it to run payroll. Keep it for your own records or future integration (e.g. marking payments).

---

## If something fails

- **"Employee not found"** in upload: Ensure **Employee ID** / **Employee Code** in the CSV match active employees in the portal (same ID or code).
- **"Could not find header row containing Employee ID"**: Ensure the main payroll CSV has a row where one of the cells is literally **Employee ID** (title rows above are fine).
- **"Overrides can only be uploaded for draft periods"**: Create a new draft period or re-open the period; overrides upload is only allowed when status is **draft**.
- **"Only draft periods can be run"**: Run payroll only once per period; after run, status is **processed**. To re-run, you would need to delete the period and create it again (and re-upload if needed), or add a “re-open draft” feature in code.

---

## API base URL and auth

- Replace `BASE_URL` with your backend URL (e.g. `http://localhost:5000`).
- If your API uses **auth** (e.g. Bearer token or session cookie), add the same headers/cookies to the `curl` commands (e.g. `-H "Authorization: Bearer YOUR_TOKEN"`).
