# SuperAdmin Old Tax Certificate Candidates Sheet — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the SuperAdmin an Administration-page interface to load historical `old_salary_slip` pay-sheet rows (bulk Excel upload + manual single-row entry) that the FBR tax certificate reads from.

**Architecture:** A new SuperAdmin-only tab on the Administration page (mirroring the existing Sales Tax tab). Backend adds a `requireSuperAdmin` guard and three `/api/administration/old-salary-slips*` endpoints that reuse the existing `old_salary_slip` insert logic plus a new duplicate-skip step. Excel handling reuses the payroll `payrollExcelUpload` multer + `XLSX` pattern.

**Tech Stack:** Node/Express (ESM), PostgreSQL (`pg` via `executeQuery`), `xlsx` (SheetJS), `multer` memory storage, `node:test` for backend unit tests; React (Vite) frontend.

## Global Constraints

- Data target is the existing `old_salary_slip` table — **no schema change**.
- Employee resolution key: incoming `Employee_Code` / `HR_Emp_ID` is matched against `employees.employee_code` (see `getPortalEmployeeIdsByHrEmpIds`). A row inserts only if it resolves to a portal `employee_id` and has a `pay_month`.
- SuperAdmin check is verified against the DB (`users.user_type === 'SuperAdmin'`), never trusting the session value alone.
- Duplicate = same `(employee_id, pay_month)`; duplicates are skipped on the app import path. The existing CLI path (`createOldSalarySlips`) keeps its current always-insert behavior.
- The 6 taxable elements the certificate sums: `basic_salary_1`, `medical_allowance_2`, `house_rent_allowance_5`, `utilities_allowance_6`, `incentives_tech_10`, `incremental_arrears_31`.
- Backend ESM: use `import`/`export`. Follow existing controller error style (`handleError`, `error.status`).
- Run backend tests with `node --test`.

---

### Task 1: `requireSuperAdmin` middleware

**Files:**
- Create: `src/middleware/requireSuperAdmin.js`
- Test: `tests/require-superadmin.test.js`

**Interfaces:**
- Consumes: `authRepo.getUserTypeByEmployeeId(employeeId)` → `Promise<string|null>` (from `src/repositories/auth.repository.js`).
- Produces: `export function requireSuperAdmin()` → Express middleware `(req,res,next)`. On success sets `req.authEmployeeId = employeeId` and calls `next()`. 401 when no `req.session.user.employeeId`; 403 when user_type !== 'SuperAdmin'.

- [ ] **Step 1: Write the failing test**

```js
// tests/require-superadmin.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateSuperAdmin } from '../src/middleware/requireSuperAdmin.js'

test('evaluateSuperAdmin: no session → 401', () => {
  assert.deepEqual(evaluateSuperAdmin(null, 'SuperAdmin'), { ok: false, status: 401 })
})

test('evaluateSuperAdmin: wrong role → 403', () => {
  assert.deepEqual(evaluateSuperAdmin(5, 'Admin'), { ok: false, status: 403 })
  assert.deepEqual(evaluateSuperAdmin(5, null), { ok: false, status: 403 })
})

test('evaluateSuperAdmin: SuperAdmin → ok', () => {
  assert.deepEqual(evaluateSuperAdmin(5, 'SuperAdmin'), { ok: true, status: 200 })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/require-superadmin.test.js`
Expected: FAIL — `evaluateSuperAdmin` is not exported / module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// src/middleware/requireSuperAdmin.js
import * as authRepo from '../repositories/auth.repository.js'

/** Pure decision: given the resolved employeeId and the DB user_type, decide the outcome. */
export function evaluateSuperAdmin(employeeId, userType) {
  if (!employeeId) return { ok: false, status: 401 }
  if (userType !== 'SuperAdmin') return { ok: false, status: 403 }
  return { ok: true, status: 200 }
}

/**
 * Route guard: requires an authenticated session whose user is the SuperAdmin.
 * Verifies the role against the DB (users.user_type), not the session value.
 */
export function requireSuperAdmin() {
  return async (req, res, next) => {
    const employeeId = req.session?.user?.employeeId
    if (!employeeId) return res.status(401).json({ error: 'Authentication required' })
    try {
      const userType = await authRepo.getUserTypeByEmployeeId(employeeId)
      const verdict = evaluateSuperAdmin(employeeId, userType)
      if (!verdict.ok) return res.status(verdict.status).json({ error: 'SuperAdmin access required' })
      req.authEmployeeId = employeeId
      next()
    } catch (err) {
      console.error('SuperAdmin check failed:', err?.message)
      res.status(500).json({ error: 'SuperAdmin check failed' })
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/require-superadmin.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/middleware/requireSuperAdmin.js tests/require-superadmin.test.js
git commit -m "feat(admin): add requireSuperAdmin middleware"
```

---

### Task 2: Repository — refactor insert + add dedup helpers

**Files:**
- Modify: `src/repositories/salary.repository.js` (refactor `createOldSalarySlips` ~lines 520-568; add helpers near it)
- Test: `tests/old-slip-dedup.test.js`

**Interfaces:**
- Consumes: existing private `normalizePaySheetRow`, `getPortalEmployeeIdsByHrEmpIds`, `OLD_SLIP_FULL_COLUMNS`, `rowToParams`, `PARAMS_PER_ROW`, `OLD_SLIP_PARAM_CASTS`, `BATCH_SIZE`, `executeQuery`.
- Produces (all exported):
  - `oldSlipDedupeKey(employeeId, payMonth)` → `string` `"<id>|YYYY-MM-DD"`.
  - `partitionByExistingKeys(normalizedRows, existingKeySet)` → `{ toInsert: Row[], duplicates: number }`. Skips rows whose key is in the set AND intra-batch repeats.
  - `normalizeSlips(slips)` → `Promise<Row[]>` (rows with resolved `employee_id`, filtered to those with `employee_id != null && pay_month != null`).
  - `insertNormalizedOldSlips(normalized)` → `Promise<Array<{id,employee_id,pay_month}>>` (the batch insert, unchanged behavior).
  - `getExistingOldSlipKeys(normalizedRows)` → `Promise<Set<string>>` (existing `(employee_id,pay_month)` keys for the batch's employee_ids).
  - `createOldSalarySlips(slips)` → unchanged signature/return (`= normalizeSlips` then `insertNormalizedOldSlips`).

- [ ] **Step 1: Write the failing test**

```js
// tests/old-slip-dedup.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { oldSlipDedupeKey, partitionByExistingKeys } from '../src/repositories/salary.repository.js'

test('oldSlipDedupeKey normalizes date to YYYY-MM-DD', () => {
  assert.equal(oldSlipDedupeKey(7, '2024-01-01'), '7|2024-01-01')
  assert.equal(oldSlipDedupeKey(7, new Date('2024-01-01T00:00:00Z')), '7|2024-01-01')
  assert.equal(oldSlipDedupeKey(7, '2024-01-01T00:00:00.000Z'), '7|2024-01-01')
})

test('partitionByExistingKeys drops existing and intra-batch dupes', () => {
  const rows = [
    { employee_id: 7, pay_month: '2024-01-01' }, // exists → duplicate
    { employee_id: 7, pay_month: '2024-02-01' }, // new
    { employee_id: 7, pay_month: '2024-02-01' }  // intra-batch repeat → duplicate
  ]
  const existing = new Set([oldSlipDedupeKey(7, '2024-01-01')])
  const { toInsert, duplicates } = partitionByExistingKeys(rows, existing)
  assert.equal(toInsert.length, 1)
  assert.equal(toInsert[0].pay_month, '2024-02-01')
  assert.equal(duplicates, 2)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/old-slip-dedup.test.js`
Expected: FAIL — exports not found.

- [ ] **Step 3: Refactor `createOldSalarySlips` and add helpers**

Replace the body of `createOldSalarySlips` (currently lines ~520-568) with the extracted functions below. Keep `OLD_SLIP_FULL_COLUMNS`, `OLD_SLIP_PARAM_CASTS`, `BATCH_SIZE`, `rowToParams`, `PARAMS_PER_ROW`, `normalizePaySheetRow`, `getPortalEmployeeIdsByHrEmpIds` as they are.

```js
/** Normalize + resolve employee_id for a batch of raw slip rows. Drops rows lacking employee_id/pay_month. */
export async function normalizeSlips(slips) {
  const needHrMap = slips.some((r) => (r.employeeId ?? r.employee_id) == null && (r.HR_Emp_ID ?? r.hrEmpId) != null)
  let hrToPortalMap = new Map()
  if (needHrMap) {
    const hrIds = slips
      .filter((r) => (r.employeeId ?? r.employee_id) == null && (r.HR_Emp_ID ?? r.hrEmpId) != null)
      .map((r) => r.HR_Emp_ID ?? r.hrEmpId)
    hrToPortalMap = await getPortalEmployeeIdsByHrEmpIds(hrIds)
  }
  const normalized = []
  for (const raw of slips) {
    const s = normalizePaySheetRow(raw, hrToPortalMap)
    if (s.employee_id == null || s.pay_month == null) continue
    normalized.push(s)
  }
  return normalized
}

/** Batch-insert already-normalized rows into old_salary_slip. Returns inserted {id,employee_id,pay_month}. */
export async function insertNormalizedOldSlips(normalized) {
  if (normalized.length === 0) return []
  const created = []
  const useFullColumns = true
  for (let i = 0; i < normalized.length; i += BATCH_SIZE) {
    const chunk = normalized.slice(i, i + BATCH_SIZE)
    const params = []
    const placeholders = chunk.map((s, idx) => {
      const base = idx * PARAMS_PER_ROW
      const rowParams = rowToParams(s)
      params.push(...rowParams)
      return '(' + rowParams.map((_, j) => `COALESCE($${base + j + 1}, NULL::${OLD_SLIP_PARAM_CASTS[j]})`).join(', ') + ')'
    }).join(', ')
    try {
      const sql = `INSERT INTO old_salary_slip (${OLD_SLIP_FULL_COLUMNS}) VALUES ${placeholders} RETURNING id, employee_id, pay_month`
      const r = await executeQuery(sql, params)
      created.push(...r)
    } catch (err) {
      if (err.code === '42703' && useFullColumns) {
        for (const s of chunk) {
          const r = await executeQuery(
            `INSERT INTO old_salary_slip (employee_id, pay_month, period_label, basic_salary, gross_salary, total_allowances, total_deductions, net_salary, status, remarks, source_employee_code)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id, employee_id, pay_month`,
            [s.employee_id, s.pay_month, s.period_label, s.basic_salary, s.gross_salary, s.total_allowances, s.total_deductions, s.net_salary, s.status, s.remarks, s.source_employee_code]
          )
          created.push(r[0])
        }
      } else throw err
    }
  }
  return created
}

/** Stable key for duplicate detection. Normalizes date-ish values to YYYY-MM-DD. */
export function oldSlipDedupeKey(employeeId, payMonth) {
  let d = payMonth
  if (payMonth instanceof Date) d = payMonth.toISOString().slice(0, 10)
  else if (typeof payMonth === 'string') d = payMonth.slice(0, 10)
  return `${employeeId}|${d}`
}

/** Split normalized rows into those to insert vs. duplicates (existing in DB or repeated in batch). */
export function partitionByExistingKeys(normalizedRows, existingKeySet) {
  const seen = new Set()
  const toInsert = []
  let duplicates = 0
  for (const s of normalizedRows) {
    const key = oldSlipDedupeKey(s.employee_id, s.pay_month)
    if (existingKeySet.has(key) || seen.has(key)) { duplicates++; continue }
    seen.add(key)
    toInsert.push(s)
  }
  return { toInsert, duplicates }
}

/** Fetch existing (employee_id, pay_month) keys for the batch's employees. */
export async function getExistingOldSlipKeys(normalizedRows) {
  const ids = [...new Set(normalizedRows.map((s) => s.employee_id).filter((v) => v != null))]
  if (ids.length === 0) return new Set()
  const rows = await executeQuery(
    'SELECT employee_id, pay_month FROM old_salary_slip WHERE employee_id = ANY($1::int[])',
    [ids]
  )
  return new Set(rows.map((r) => oldSlipDedupeKey(r.employee_id, r.pay_month)))
}

/** CLI/legacy path: normalize then insert everything (no dedup). Unchanged behavior. */
export async function createOldSalarySlips(slips) {
  const normalized = await normalizeSlips(slips)
  return insertNormalizedOldSlips(normalized)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/old-slip-dedup.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full backend test suite (no regressions)**

Run: `node --test`
Expected: All existing tests still PASS.

- [ ] **Step 6: Commit**

```bash
git add src/repositories/salary.repository.js tests/old-slip-dedup.test.js
git commit -m "refactor(salary): split old-slip insert + add dedup helpers"
```

---

### Task 3: Admin service — template, import, manual add

**Files:**
- Modify: `src/services/administration.service.js` (add imports + three exports)
- Test: `tests/old-slip-admin-service.test.js`

**Interfaces:**
- Consumes: `XLSX` (from `'xlsx'`), `salaryRepo.normalizeSlips`, `salaryRepo.getExistingOldSlipKeys`, `salaryRepo.partitionByExistingKeys`, `salaryRepo.insertNormalizedOldSlips` (Task 2).
- Produces (exported from `administration.service.js`):
  - `OLD_SLIP_TEMPLATE_COLUMNS` → `string[]` (ordered header names).
  - `aliasEmployeeCode(row)` → new row object; when `Employee_Code`/`employee_code` present and no `HR_Emp_ID`/`employeeId`, sets `HR_Emp_ID` and `Source_Employee_Code` to it. Pure.
  - `buildOldSlipTemplate()` → `{ buffer: Buffer, filename: string }`.
  - `importOldSlips(buffer)` → `Promise<{ total, inserted, skipped, duplicates }>`; throws `{ status, message }` on unreadable/empty file.
  - `addOldSlip(row)` → `Promise<{ inserted: 0|1, duplicate: boolean, skipped: boolean }>`; throws `{ status:400, message }` when the row cannot resolve to an employee/pay_month.

- [ ] **Step 1: Write the failing test**

```js
// tests/old-slip-admin-service.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aliasEmployeeCode, OLD_SLIP_TEMPLATE_COLUMNS } from '../src/services/administration.service.js'

test('template columns include identifier, pay month, and the 6 taxable elements', () => {
  for (const c of ['Employee_Code', 'Pay_Month', 'Basic_Salary_1', 'Medical_Allowance_2',
    'House_Rent_Allowance_5', 'Utilities_Allowance_6', 'Incentives_Tech_10', 'Incremental_Arrears_31']) {
    assert.ok(OLD_SLIP_TEMPLATE_COLUMNS.includes(c), `missing ${c}`)
  }
})

test('aliasEmployeeCode maps Employee_Code to HR_Emp_ID + Source_Employee_Code', () => {
  const out = aliasEmployeeCode({ Employee_Code: '1234', Pay_Month: '2024-01-01' })
  assert.equal(out.HR_Emp_ID, '1234')
  assert.equal(out.Source_Employee_Code, '1234')
  assert.equal(out.Pay_Month, '2024-01-01')
})

test('aliasEmployeeCode does not override an explicit HR_Emp_ID', () => {
  const out = aliasEmployeeCode({ Employee_Code: '1234', HR_Emp_ID: '9999' })
  assert.equal(out.HR_Emp_ID, '9999')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/old-slip-admin-service.test.js`
Expected: FAIL — exports not found.

- [ ] **Step 3: Add imports at the top of `administration.service.js`**

After the existing imports (line 5 area), add:

```js
import XLSX from 'xlsx'
import * as salaryRepo from '../repositories/salary.repository.js'
```

- [ ] **Step 4: Append the service code to `administration.service.js`**

```js
// ---------- Old salary slip (tax certificate candidates) sheet ----------

/** Header columns for the upload template. Employee_Code resolves against employees.employee_code. */
export const OLD_SLIP_TEMPLATE_COLUMNS = [
  'Employee_Code', 'Pay_Month', 'Period_Label',
  'Basic_Salary_1', 'Medical_Allowance_2', 'Conveyance_Fixed_Allowance_3', 'Overtime_Allowance_4',
  'House_Rent_Allowance_5', 'Utilities_Allowance_6', 'Meal_Allowance_7', 'Arrears_8',
  'Bike_Maintainence_9', 'Incentives_Tech_10', 'Device_Reimbursment_11', 'Communication_12',
  'Incentives_KPI_13', 'Other_Allowance_14', 'Loan_15', 'Advance_Salary_16', 'EOBI_17', 'Income_Tax_18',
  'Absent_Days_19', 'Device_Deduction_20', 'Over_Utilization_Mobile_21', 'Vehicle_Fuel_Deduction_22',
  'Pandamic_Deduction_23', 'Late_Days_24', 'Other_Deduction_25', 'Mobile_Installment_26', 'Food_Panda_27',
  'Conveyance_Liters_Allowance_28', 'Leaves_29', 'Incremental_Arrears_31',
  'Tot_Gross_Salary', 'Tot_Allowances', 'Tot_Deductions', 'Tot_Net_Salary', 'Salary_Status', 'Remarks'
]

/** Map a sheet's Employee_Code to the fields the normalizer resolves by (employee_code lookup). Pure. */
export function aliasEmployeeCode(row) {
  const out = { ...row }
  const code = out.Employee_Code ?? out.employee_code
  const hasId = out.HR_Emp_ID != null || out.employeeId != null || out.employee_id != null
  if (code != null && String(code).trim() !== '' && !hasId) {
    out.HR_Emp_ID = code
    if (out.Source_Employee_Code == null) out.Source_Employee_Code = code
  }
  return out
}

/** Build the downloadable XLSX template (header row + one blank example row). */
export function buildOldSlipTemplate() {
  const header = OLD_SLIP_TEMPLATE_COLUMNS
  const example = header.map((h) => (h === 'Pay_Month' ? '2024-01-01' : ''))
  const ws = XLSX.utils.aoa_to_sheet([header, example])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Old Salary Slips')
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  return { buffer, filename: 'Old-Tax-Certificate-Sheet-Template.xlsx' }
}

/** Shared: normalize → skip duplicates → insert. Returns counts. */
async function importRows(rawRows) {
  const aliased = rawRows.map(aliasEmployeeCode)
  const normalized = await salaryRepo.normalizeSlips(aliased)
  const skipped = aliased.length - normalized.length
  const existing = await salaryRepo.getExistingOldSlipKeys(normalized)
  const { toInsert, duplicates } = salaryRepo.partitionByExistingKeys(normalized, existing)
  const created = await salaryRepo.insertNormalizedOldSlips(toInsert)
  return { total: rawRows.length, inserted: created.length, skipped, duplicates }
}

/** Parse an uploaded workbook and import its rows into old_salary_slip (skipping duplicates). */
export async function importOldSlips(buffer) {
  let sheet
  try {
    const wb = XLSX.read(buffer, { type: 'buffer' })
    sheet = wb.Sheets[wb.SheetNames[0]]
  } catch {
    const e = new Error('Could not read the uploaded file'); e.status = 400; throw e
  }
  if (!sheet) { const e = new Error('The uploaded file has no sheet'); e.status = 400; throw e }
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
  if (!rows.length) { const e = new Error('No data rows found in the sheet'); e.status = 400; throw e }
  return importRows(rows)
}

/** Add a single manually-entered old salary slip row. */
export async function addOldSlip(row) {
  if (!row || typeof row !== 'object') { const e = new Error('A row object is required'); e.status = 400; throw e }
  const result = await importRows([row])
  if (result.inserted === 0 && result.skipped > 0) {
    const e = new Error('Could not resolve the employee (Employee_Code) or Pay_Month'); e.status = 400; throw e
  }
  return { inserted: result.inserted, duplicate: result.duplicates > 0, skipped: result.skipped > 0 }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/old-slip-admin-service.test.js`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/services/administration.service.js tests/old-slip-admin-service.test.js
git commit -m "feat(admin): old-slip template, import, and manual-add service"
```

---

### Task 4: Controller handlers + guarded routes

**Files:**
- Modify: `src/controllers/administration.controller.js` (add three handlers)
- Modify: `src/routes/administration.routes.js` (import guard + multer, add three routes)

**Interfaces:**
- Consumes: `adminService.buildOldSlipTemplate`, `adminService.importOldSlips`, `adminService.addOldSlip` (Task 3); `requireSuperAdmin` (Task 1); `payrollExcelUpload` (from `src/utils/file.utils.js`); existing `handleError`.
- Produces: routes `GET /api/administration/old-salary-slips/template`, `POST /api/administration/old-salary-slips/upload`, `POST /api/administration/old-salary-slips`.

- [ ] **Step 1: Add controller handlers**

Append to `src/controllers/administration.controller.js`:

```js
// Old salary slip (tax certificate candidates) sheet — SuperAdmin only
export async function downloadOldSlipTemplate(req, res) {
  try {
    const { buffer, filename } = adminService.buildOldSlipTemplate()
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.send(buffer)
  } catch (error) {
    handleError(error, res, 'Failed to build template')
  }
}

export async function uploadOldSlips(req, res) {
  try {
    if (!req.file?.buffer) return res.status(400).json({ error: 'An Excel file (field "file") is required' })
    const result = await adminService.importOldSlips(req.file.buffer)
    res.json(result)
  } catch (error) {
    handleError(error, res, 'Failed to import old salary slips')
  }
}

export async function addOldSlip(req, res) {
  try {
    const result = await adminService.addOldSlip(req.body)
    res.status(201).json(result)
  } catch (error) {
    handleError(error, res, 'Failed to add old salary slip')
  }
}
```

- [ ] **Step 2: Wire the routes**

In `src/routes/administration.routes.js`, add imports after the existing ones:

```js
import { requireSuperAdmin } from '../middleware/requireSuperAdmin.js'
import { payrollExcelUpload } from '../utils/file.utils.js'
```

Add these routes before `export default router`:

```js
// Old Tax Certificate Candidates Sheet (SuperAdmin only)
router.get('/old-salary-slips/template', requireSuperAdmin(), adminController.downloadOldSlipTemplate)
router.post('/old-salary-slips/upload', requireSuperAdmin(), payrollExcelUpload.single('file'), adminController.uploadOldSlips)
router.post('/old-salary-slips', requireSuperAdmin(), adminController.addOldSlip)
```

- [ ] **Step 3: Verify the server boots and routes are mounted**

Run: `node -e "import('./src/routes/administration.routes.js').then(()=>console.log('routes ok')).catch(e=>{console.error(e);process.exit(1)})"`
Expected: prints `routes ok` (no import/wiring errors).

- [ ] **Step 4: Run the full backend test suite**

Run: `node --test`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/controllers/administration.controller.js src/routes/administration.routes.js
git commit -m "feat(admin): guarded old-salary-slip endpoints (template/upload/add)"
```

---

### Task 5: Frontend API methods

**Files:**
- Modify: `d:/Github/Emp_Portal_FrontEnd/src/services/api.js` (add three methods to `administrationAPI`)

**Interfaces:**
- Consumes: existing `apiCall`, `apiUpload`, `API_BASE_URL`.
- Produces: `administrationAPI.downloadOldSlipTemplate()`, `administrationAPI.uploadOldSlips(file)`, `administrationAPI.addOldSlip(row)`.

- [ ] **Step 1: Add the methods**

Inside the `administrationAPI` object (near `getSuperAdminStatus`, around line 688), add:

```js
  uploadOldSlips: (file) => {
    const fd = new FormData()
    fd.append('file', file)
    return apiUpload('/administration/old-salary-slips/upload', fd)
  },
  addOldSlip: (row) => apiCall('/administration/old-salary-slips', { method: 'POST', body: JSON.stringify(row) }),
  downloadOldSlipTemplate: async () => {
    const res = await fetch(`${API_BASE_URL}/administration/old-salary-slips/template`, { credentials: 'include' })
    if (!res.ok) throw new Error('Failed to download template')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'Old-Tax-Certificate-Sheet-Template.xlsx'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  },
```

- [ ] **Step 2: Verify the frontend compiles**

Run (in `d:/Github/Emp_Portal_FrontEnd`): `npm run build`
Expected: build succeeds with no errors referencing `api.js`.

- [ ] **Step 3: Commit**

```bash
cd d:/Github/Emp_Portal_FrontEnd
git add src/services/api.js
git commit -m "feat(admin): api methods for old salary slip sheet"
```

---

### Task 6: Administration page — SuperAdmin tab + UI

**Files:**
- Modify: `d:/Github/Emp_Portal_FrontEnd/src/pages/Administration.jsx`

**Interfaces:**
- Consumes: `administrationAPI.downloadOldSlipTemplate/uploadOldSlips/addOldSlip` (Task 5); existing `isSuperAdmin`, `toast`, `visibleTabs` pattern.
- Produces: a new tab `old-tax-sheet` visible only to SuperAdmin, with download / upload / manual-add UI.

- [ ] **Step 1: Add the tab to `visibleTabs`**

Import an icon (add `FileSpreadsheet` to the existing `lucide-react` import). Then extend `visibleTabs` (currently line ~295):

```jsx
  const visibleTabs = isSuperAdmin
    ? [...TABS,
        { id: 'sales-tax', label: 'Sales Tax', icon: TrendingUp },
        { id: 'old-tax-sheet', label: 'Tax Certificate Sheet', icon: FileSpreadsheet }]
    : TABS
```

- [ ] **Step 2: Add component state and handlers**

Near the sales-tax state (after line ~300), add:

```jsx
  const [oldSlipFile, setOldSlipFile] = useState(null)
  const [oldSlipUploading, setOldSlipUploading] = useState(false)
  const [oldSlipForm, setOldSlipForm] = useState({
    Employee_Code: '', Pay_Month: '', Basic_Salary_1: '', Medical_Allowance_2: '',
    House_Rent_Allowance_5: '', Utilities_Allowance_6: '', Incentives_Tech_10: '',
    Incremental_Arrears_31: '', Tot_Gross_Salary: '', Tot_Deductions: '', Tot_Net_Salary: ''
  })
  const [oldSlipSaving, setOldSlipSaving] = useState(false)

  const handleDownloadOldSlipTemplate = async () => {
    try { await administrationAPI.downloadOldSlipTemplate() }
    catch (e) { toast.error(e.message || 'Failed to download template') }
  }

  const handleUploadOldSlips = async () => {
    if (!oldSlipFile) { toast.error('Choose an Excel file first'); return }
    setOldSlipUploading(true)
    try {
      const r = await administrationAPI.uploadOldSlips(oldSlipFile)
      toast.success(`Imported ${r.inserted} of ${r.total} rows (skipped ${r.skipped}, duplicates ${r.duplicates})`)
      setOldSlipFile(null)
    } catch (e) {
      toast.error(e.message || 'Upload failed')
    } finally { setOldSlipUploading(false) }
  }

  const handleAddOldSlip = async () => {
    if (!oldSlipForm.Employee_Code || !oldSlipForm.Pay_Month) {
      toast.error('Employee Code and Pay Month are required'); return
    }
    setOldSlipSaving(true)
    try {
      const r = await administrationAPI.addOldSlip(oldSlipForm)
      if (r.duplicate) toast('That month already exists for this employee — skipped', { icon: 'ℹ️' })
      else toast.success('Row added')
      setOldSlipForm((f) => ({ ...f, Pay_Month: '', Basic_Salary_1: '', Medical_Allowance_2: '',
        House_Rent_Allowance_5: '', Utilities_Allowance_6: '', Incentives_Tech_10: '',
        Incremental_Arrears_31: '', Tot_Gross_Salary: '', Tot_Deductions: '', Tot_Net_Salary: '' }))
    } catch (e) {
      toast.error(e.message || 'Failed to add row')
    } finally { setOldSlipSaving(false) }
  }
```

- [ ] **Step 3: Render the tab content**

After the `activeTab === 'sales-tax'` block (closes at line ~1827), add:

```jsx
      {activeTab === 'old-tax-sheet' && (
        <div className="admin-content">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 8px' }}>
            <FileSpreadsheet size={18} /> Tax Certificate Sheet (Old Salary Slips)
          </h3>
          <p style={{ margin: '0 0 12px', color: '#475569', fontSize: '0.9rem' }}>
            Load historical monthly salary rows used by the FBR tax certificate. Bulk-upload the
            template, or add a single month below. Rows for a month that already exists for an
            employee are skipped.
          </p>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '0 0 20px', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-sm" onClick={handleDownloadOldSlipTemplate}>
              Download template
            </button>
            <input type="file" accept=".xlsx,.xls,.csv"
              onChange={(e) => setOldSlipFile(e.target.files?.[0] || null)} />
            <button type="button" className="btn btn-sm btn-primary" disabled={oldSlipUploading || !oldSlipFile}
              onClick={handleUploadOldSlips}>
              {oldSlipUploading ? 'Uploading…' : 'Upload sheet'}
            </button>
          </div>

          <h4 style={{ margin: '0 0 8px' }}>Add a single month</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, margin: '0 0 12px' }}>
            {[
              ['Employee_Code', 'Employee Code', 'text'],
              ['Pay_Month', 'Pay Month (YYYY-MM-DD)', 'date'],
              ['Basic_Salary_1', 'Basic', 'number'],
              ['Medical_Allowance_2', 'Medical', 'number'],
              ['House_Rent_Allowance_5', 'House Rent', 'number'],
              ['Utilities_Allowance_6', 'Utilities', 'number'],
              ['Incentives_Tech_10', 'Incentives (Tech)', 'number'],
              ['Incremental_Arrears_31', 'Incremental Arrears', 'number'],
              ['Tot_Gross_Salary', 'Gross', 'number'],
              ['Tot_Deductions', 'Total Deductions', 'number'],
              ['Tot_Net_Salary', 'Net', 'number']
            ].map(([key, label, type]) => (
              <div key={key} className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: '0.8rem' }}>{label}</label>
                <input type={type} value={oldSlipForm[key]}
                  onChange={(e) => setOldSlipForm((f) => ({ ...f, [key]: e.target.value }))}
                  style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6 }} />
              </div>
            ))}
          </div>
          <button type="button" className="btn btn-sm btn-primary" disabled={oldSlipSaving} onClick={handleAddOldSlip}>
            {oldSlipSaving ? 'Saving…' : 'Add row'}
          </button>
        </div>
      )}
```

- [ ] **Step 4: Verify the frontend compiles**

Run (in `d:/Github/Emp_Portal_FrontEnd`): `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Manual verification (browser)**

Start the frontend + backend dev servers. Log in as the SuperAdmin.
- Confirm the **Tax Certificate Sheet** tab appears; log in as a non-SuperAdmin and confirm it does NOT.
- Click **Download template** → an `.xlsx` with the header row downloads.
- Fill the template with one known employee code + a past month, upload → toast shows `Imported 1 of 1`.
- Upload the same file again → toast shows `duplicates 1`, `inserted 0`.
- Add a single month via the form for another past month → toast `Row added`.
- Open that employee's Salary Slip page → the tax-certificate totals reflect the added months.

- [ ] **Step 6: Commit**

```bash
cd d:/Github/Emp_Portal_FrontEnd
git add src/pages/Administration.jsx
git commit -m "feat(admin): SuperAdmin Tax Certificate Sheet tab (upload + manual add)"
```

---

## Self-Review

**Spec coverage:**
- SuperAdmin-only, server-verified → Task 1 (`requireSuperAdmin`, DB-verified) + Task 4 (routes guarded) + Task 6 (tab hidden client-side).
- Excel upload with template → Tasks 3 (`buildOldSlipTemplate`, `importOldSlips`), 4 (routes), 5/6 (frontend).
- Manual single-row add → Tasks 3 (`addOldSlip`), 4, 6.
- Target `old_salary_slip`, no schema change → Task 2 (reuses existing insert).
- Skip duplicates by (employee_id, pay_month) → Task 2 (`getExistingOldSlipKeys`, `partitionByExistingKeys`) + Task 3 (`importRows`).
- CLI behavior unchanged → Task 2 (`createOldSalarySlips` re-expressed, same signature/return).
- Testing (guard, import/dedup, template) → Tasks 1, 2, 3 unit tests; Task 6 manual browser check.

**Placeholder scan:** No TBD/TODO; all code steps contain full code.

**Type consistency:** `normalizeSlips`/`insertNormalizedOldSlips`/`getExistingOldSlipKeys`/`partitionByExistingKeys`/`oldSlipDedupeKey` names are used identically across Tasks 2 and 3. `importOldSlips`/`addOldSlip`/`buildOldSlipTemplate` names match across Tasks 3, 4. Frontend `downloadOldSlipTemplate`/`uploadOldSlips`/`addOldSlip` match across Tasks 5, 6.
