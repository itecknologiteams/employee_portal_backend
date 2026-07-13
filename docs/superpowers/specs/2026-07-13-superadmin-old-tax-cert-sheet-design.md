# SuperAdmin — Old Tax Certificate Candidates Sheet

**Date:** 2026-07-13
**Status:** Approved design, pending implementation plan

## Problem

The FBR income-tax certificate feature reads an employee's historical monthly salary
from the `old_salary_slip` table to cover past fiscal years. Today that historical data
can only be loaded through a CLI script (`scripts/import-old-salary-slips.js` →
`createOldSalarySlips`). There is no in-app way to add it.

We need an interface on the **Administration page**, restricted to the **SuperAdmin**
role, that lets the SuperAdmin load these old pay-sheet rows — both as a bulk Excel
upload and as a manual single-row add.

## Scope

- **In scope:** A SuperAdmin-only tab on the Administration page that (1) downloads an
  Excel template, (2) bulk-uploads a filled sheet into `old_salary_slip`, (3) manually
  adds a single row. Server-side SuperAdmin enforcement. Duplicate detection on upload.
- **Out of scope:** Editing/deleting existing `old_salary_slip` rows; changing the tax
  certificate rendering or the `old_salary_slip` schema; the existing CLI import (kept
  as-is).

## Data model

Target table is the existing **`old_salary_slip`** (no schema change). Rows carry the
full SQL Server pay-sheet structure (numbered allowances/deductions + totals) plus the
6 taxable elements the certificate sums (Basic `basic_salary_1`, Medical
`medical_allowance_2`, House Rent `house_rent_allowance_5`, Utilities
`utilities_allowance_6`, Incentives Tech `incentives_tech_10`, Incremental Arrears
`incremental_arrears_31`).

Employee identity accepted per row (as `normalizePaySheetRow` already handles):
`HR_Emp_ID` (mapped to a portal employee via `employee_code`), or `employeeId`, or
`source_employee_code`. A row is only inserted if it resolves to a portal
`employee_id` and has a `pay_month`.

## Approach (chosen: A)

Reuse existing conventions rather than build a parallel stack:
- Frontend: a new SuperAdmin-only tab, mirroring the existing **Sales Tax** tab pattern
  (`visibleTabs` gains the tab only when `isSuperAdmin`).
- Backend: reuse `createOldSalarySlips` (repository) and the `payrollExcelUpload`
  multer + `XLSX` pattern already used by the payroll element-sheet upload.

Rejected: (B) a standalone page/route — more scaffolding, no benefit; (C) CLI-only —
already exists, does not satisfy the request.

## Backend design (Emp_Portal_BackEnd)

### 1. `requireSuperAdmin` middleware — `src/middleware/requireSuperAdmin.js`
- 401 if `req.session?.user?.employeeId` is absent.
- Verifies against the DB: `authRepo.getUserTypeByEmployeeId(employeeId) === 'SuperAdmin'`.
  Does **not** trust the session's `userType` value alone.
- 403 otherwise. On success attaches `req.authEmployeeId` (mirrors `requirePermission`).

### 2. Routes — added to `src/routes/administration.routes.js`, all guarded by `requireSuperAdmin`
- `GET  /api/administration/old-salary-slips/template` → XLSX template download.
- `POST /api/administration/old-salary-slips/upload` (`payrollExcelUpload.single('file')`)
  → parse workbook → import → `{ total, inserted, skipped, duplicates }`.
- `POST /api/administration/old-salary-slips` → manual single row → import one row.

### 3. Service — `src/services/administration.service.js`
- `buildOldSlipTemplate()` → returns an XLSX buffer whose header row is the accepted
  pay-sheet column names (`HR_Emp_ID`, `Source_Employee_Code`, `Pay_Month`,
  `Period_Label`, the numbered `*_N` element columns, and the `Tot_*` totals), with one
  blank example row. Built with `XLSX` (same as `payrollDb.service.js`).
- `importOldSlips(buffer)` → `XLSX.read` → `sheet_to_json` → **dedup step** → insert.
- `addOldSlip(row)` → normalize one row → **dedup step** → insert.

### 4. Duplicate detection (new behavior for the app path)
Before insert, look up existing `(employee_id, pay_month)` pairs for the incoming batch
and drop rows that already exist, counting them as `duplicates`. Implementation:
- New repository helper `getExistingOldSlipKeys(pairs)` → returns the set of existing
  `employee_id|pay_month` keys.
- Import path normalizes rows, resolves `employee_id`, filters out existing keys, then
  calls `createOldSalarySlips` on the survivors.
- `createOldSalarySlips` (CLI path) is left unchanged (always-insert default), so the
  CLI keeps its current behavior.

### 5. Controller — `src/controllers/administration.controller.js`
`downloadOldSlipTemplate`, `uploadOldSlips`, `addOldSlip` — thin handlers delegating to
the service; set XLSX content-type/filename for the template download.

## Frontend design (Emp_Portal_FrontEnd)

### `src/pages/Administration.jsx`
- Add to `visibleTabs` when `isSuperAdmin` (exactly like Sales Tax):
  `{ id: 'old-tax-sheet', label: 'Tax Certificate Sheet', icon: FileSpreadsheet }`.
- Render a section when `activeTab === 'old-tax-sheet'` with three parts:
  1. **Download template** button → hits the template endpoint, saves the XLSX.
  2. **Upload** — file input (`.xlsx`/`.csv`) + submit → toast summarizing
     `inserted / skipped / duplicates` out of `total`.
  3. **Manual add** — **essentials-only** form: Employee Code (or HR_Emp_ID), Pay Month,
     Basic, Medical, House Rent, Utilities, Incentives Tech, Incremental Arrears, Gross,
     Total Deductions, Net → submit one row, toast result.

### `src/services/api.js`
`administrationAPI.downloadOldSlipTemplate()`, `uploadOldSlips(file)`, `addOldSlip(row)`.

## Error handling

- Non-SuperAdmin → 403 (server-side guard); the tab is also hidden client-side.
- `createOldSalarySlips` already skips rows missing `employee_id`/`pay_month`; those are
  reported in `skipped`.
- Duplicate `(employee_id, pay_month)` rows reported in `duplicates`, not inserted —
  prevents inflating tax-certificate totals on re-upload.
- Multer (`payrollExcelUpload`) enforces file type and size; parse errors → 400 with a
  clear message.

## Testing

- Unit test for `requireSuperAdmin`: 401 (no session), 403 (non-SuperAdmin), pass-through
  (SuperAdmin), using a stubbed `getUserTypeByEmployeeId`.
- Unit test for `importOldSlips`: parses a small in-memory workbook, exercises the dedup
  filter (existing key skipped, new key inserted), asserts the returned counts.
- Live-DB verification (real upload against `employee_portal`) is a manual step after
  deploy — noted, not automated (no DB access in the build environment).

## Open questions

None. Manual-form scope = essentials only; upload = skip duplicates (both confirmed).
