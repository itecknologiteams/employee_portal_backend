# Employee Bulk Import Design

## Overview

Add a bulk employee import feature to Administration → Employees. The user uploads an Excel (.xlsx/.xls) or CSV file, maps spreadsheet columns to database fields, reviews a preview table, then confirms the insert. If any duplicates or validation errors exist, the entire import is rejected before any row is written.

---

## Architecture

### Backend (d:\Github\Emp_Portal_BackEnd)

| File | Change |
|---|---|
| `src/utils/file.utils.js` | Add `employeeImportUpload` multer (memoryStorage, Excel + CSV, 10 MB) |
| `src/routes/administration.routes.js` | Add two POST routes: `/employees/import/parse` and `/employees/import/confirm` |
| `src/controllers/administration.controller.js` | Add `parseEmployeeImport` and `confirmEmployeeImport` |
| `src/services/administration.service.js` | Add `parseEmployeeImportFile(buffer, filename)` and `confirmEmployeeImport(mapping, rows)` |

### Frontend (d:\Github\Emp_Portal_FrontEnd)

| File | Change |
|---|---|
| `src/pages/Administration.jsx` | Add "Import Employees" button in Employees tab; add inline `EmployeeImportModal` component (3-step wizard) |
| `src/services/api.js` | Add `parseEmployeeImport(formData)` and `confirmEmployeeImport(data)` to `adminAPI` |

---

## API Contracts

### POST /administration/employees/import/parse

**Request:** `multipart/form-data` with field `file` (.xlsx, .xls, or .csv)

**Response 200:**
```json
{
  "headers": ["Name", "Emp Code", "Dept", "..."],
  "rows": [["Ali", "E001", "IT", "..."], ...],
  "totalRows": 42
}
```

**Response 400:** `{ "error": "No file uploaded" }` or `{ "error": "Unsupported file format" }`

### POST /administration/employees/import/confirm

**Request JSON:**
```json
{
  "mapping": {
    "0": "first_name",
    "1": "employee_code",
    "2": "department_name",
    "3": null
  },
  "requiredIndices": [0, 1],
  "rows": [["Ali", "E001", "IT"], ...]
}
```
- `mapping`: column index (string) → database field key (or null to skip)
- `requiredIndices`: column indices the user marked as required
- `rows`: the same array returned by `/parse`

**Response 200:** `{ "inserted": 42 }`

**Response 400 (duplicates):**
```json
{
  "error": "Import blocked: duplicates found",
  "conflicts": [
    { "row": 3, "field": "employee_code", "value": "E001" },
    { "row": 7, "field": "email", "value": "ali@example.com" }
  ]
}
```

**Response 400 (lookup failure):**
```json
{
  "error": "Import blocked: unresolvable lookups",
  "conflicts": [
    { "row": 2, "field": "department_name", "value": "Unknownn Dept" }
  ]
}
```

**Response 400 (required field missing):**
```json
{
  "error": "Import blocked: required fields missing",
  "conflicts": [
    { "row": 5, "field": "first_name", "value": "" }
  ]
}
```

---

## Importable Database Fields

| Key (used in `mapping`) | DB Column | Type | Notes |
|---|---|---|---|
| `employee_code` | `employee_code` | VARCHAR | Unique; duplicate check |
| `first_name` | `first_name` | VARCHAR | — |
| `last_name` | `last_name` | VARCHAR | — |
| `email` | `email` | VARCHAR | Unique; duplicate check |
| `phone` | `phone` | VARCHAR | — |
| `address` | `address` | TEXT | — |
| `position` | `position` | VARCHAR | — |
| `join_date` | `join_date` | DATE | Parsed as ISO string or Excel serial |
| `is_active` | `is_active` | BOOLEAN | Accepts: `true/false`, `1/0`, `yes/no`, `active/inactive` |
| `department_name` | `department_id` | Lookup | Name-to-ID, case-insensitive |
| `designation_name` | `designation_id` | Lookup | Name-to-ID, case-insensitive |
| `employee_type_name` | `employee_type_id` | Lookup | Name-to-ID, case-insensitive |
| `city_name` | `city_id` | Lookup | Name-to-ID, case-insensitive |
| `date_of_birth` | `date_of_birth` | DATE | — |
| `father_name` | `father_name` | VARCHAR | — |
| `gender` | `gender` | VARCHAR | — |
| `marital_status` | `marital_status` | VARCHAR | — |
| `cnic_number` | `cnic_number` | VARCHAR | — |
| `personal_cell_number` | `personal_cell_number` | VARCHAR | — |
| `emergency_contact_number` | `emergency_contact_number` | VARCHAR | — |
| `grade` | `grade` | VARCHAR | — |
| `region` | `region` | VARCHAR | — |

HOD departments, profile picture, bio, and portal credentials are excluded from bulk import.

---

## Validation Rules (all-or-nothing)

Checked in this order on `/import/confirm`; first failure aborts the entire import:

1. **Required field check** — any row missing a value in a user-marked required column
2. **Duplicate check** — any `employee_code` or `email` in the submitted rows already exists in the `employees` table (checked with a single `WHERE ... IN (...)` query)
3. **Lookup resolution** — any lookup value (department, designation, etc.) that doesn't match any record in its reference table

If all checks pass → single `BEGIN ... COMMIT` transaction inserts all rows.

---

## Frontend Modal — 3-Step Wizard

### Step 1: Upload
- File input accepting `.xlsx`, `.xls`, `.csv`
- "Parse File" button → POST to `/import/parse` → loading spinner
- On success → advance to Step 2 with `{ headers, rows }`

### Step 2: Map Columns
- Table with one row per spreadsheet column:
  - Column header from file (left)
  - Dropdown: select database field key or "— Skip —" (right)
  - Checkbox: "Required" (right)
- Each database field key can only be selected once (used options are disabled in other dropdowns)
- "Preview →" button → client-side renders the preview table, advance to Step 3

### Step 3: Preview & Confirm
- Table showing every row with mapped column headers
- Rows where a required field is blank are highlighted in red with a small badge
- "← Back to Mapping" button
- "Confirm Import (N rows)" button — disabled if any red rows exist
- On confirm → POST to `/import/confirm` → loading
- **Success:** green alert "N employees imported" → close modal → reload employee list
- **Error:** red alert with conflict table listing row number, field, and conflicting value

---

## Error Handling

- Parse failures (corrupt file, wrong format) → Step 1 shows inline error, user can try another file
- Import conflicts → Step 3 shows a scrollable conflict table; "← Back to Mapping" remains available
- Network errors → toast notification; modal stays open
- Empty file (0 data rows after header) → Step 1 shows error "File has no data rows"

---

## Constraints

- Max file size: 10 MB
- No partial inserts: the entire batch succeeds or fails as one transaction
- No HOD department assignment via bulk import (use the individual edit form)
- No portal credential creation via bulk import
- Lookup resolution is case-insensitive and trims whitespace; no fuzzy matching
