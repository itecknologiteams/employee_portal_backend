# Employee History Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full Employee History Tracking module — a per-employee timeline (joining, probation, grade/department/designation/salary/location changes, separation) with manual add/edit/soft-delete, automatic diff-logging when the employee record is updated, and HR/SuperAdmin gating.

**Architecture:** Reuse the existing `employee_record_history` Postgres table (already migrated; inline `old_X` / `new_X` columns) and its SQL helper functions/views. A new repository + service expose CRUD over the table. A Node-side hook in `administration.service.js → updateEmployee` diffs the before/after row and inserts history entries automatically. Frontend renders a timeline modal opened from a new eye-icon "View History" action on each employees row, replacing the Delete button.

**Tech Stack:** PostgreSQL, Node.js/Express, React 18 + Vite, existing CSS variable system. No test framework — manual verification matching the codebase pattern.

---

## File Structure

**Backend (root = `d:\Github\Emp_Portal_BackEnd\`):**

| File | Responsibility | New / Modify |
|---|---|---|
| `migration_employee_history_extras.sql` | Extend CHECK constraint with `probation_start`/`probation_extended`; add `is_deleted`, `deleted_at`, `deleted_by`, `edited_at`, `edited_by`, `approver_name`, `approver_designation` columns | NEW |
| `src/repositories/employeeHistory.repository.js` | All SQL for `employee_record_history` (list/get/insert/update/soft-delete/duplicate check) | NEW |
| `src/services/employeeHistory.service.js` | CRUD validation + diff engine + percentage/tenure helpers | NEW |
| `src/controllers/employeeHistory.controller.js` | 5 REST handlers + HR/SuperAdmin guard | NEW |
| `src/routes/employeeHistory.routes.js` | Route definitions | NEW |
| `src/routes/index.js` | Export the new router | MODIFY |
| `app.js` | Mount the new router on `/api` | MODIFY |
| `src/services/administration.service.js` | Diff-and-autolog hook inside `updateEmployee` | MODIFY |
| `src/repositories/administration.repository.js` | Add a `getEmployeeById` helper if missing | MODIFY |

**Frontend (root = `d:\Github\Emp_Portal_FrontEnd\`):**

| File | Responsibility | New / Modify |
|---|---|---|
| `src/services/api.js` | New `employeeHistoryAPI` (list/get/create/update/remove) | MODIFY |
| `src/components/EmployeeHistoryModal.jsx` | Timeline modal, filter chips, header stats, add/edit form | NEW |
| `src/components/EmployeeHistoryModal.css` | Modal/timeline/badge/form styles | NEW |
| `src/pages/Administration.jsx` | Replace Delete row action with eye-icon "View History"; render modal | MODIFY |

---

## Tasks

### Task 1: Database schema additions

**Files:**
- Create: `d:\Github\Emp_Portal_BackEnd\migration_employee_history_extras.sql`

- [ ] **Step 1: Create the migration file**

Write `d:\Github\Emp_Portal_BackEnd\migration_employee_history_extras.sql`:
```sql
-- 1) Allow new event types (probation lifecycle was missing in original CHECK)
ALTER TABLE employee_record_history DROP CONSTRAINT IF EXISTS employee_record_history_record_type_check;
ALTER TABLE employee_record_history ADD CONSTRAINT employee_record_history_record_type_check
  CHECK (record_type IN (
    'salary_change','department_change','designation_change','employee_type_change',
    'confirmation','probation_start','probation_extended',
    'joining','last_working_date','rehire','location_change','grade_change','other'
  ));

-- 2) Soft-delete + edit metadata (audit-trail safe — nothing is hard-deleted)
ALTER TABLE employee_record_history ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE employee_record_history ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE employee_record_history ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES employees(employee_id);
ALTER TABLE employee_record_history ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP;
ALTER TABLE employee_record_history ADD COLUMN IF NOT EXISTS edited_by INTEGER REFERENCES employees(employee_id);

-- 3) Approver name + designation as free text (approver may be CEO, an external auditor, etc., not always an employees row)
ALTER TABLE employee_record_history ADD COLUMN IF NOT EXISTS approver_name VARCHAR(200);
ALTER TABLE employee_record_history ADD COLUMN IF NOT EXISTS approver_designation VARCHAR(200);

-- 4) Useful index for timeline queries
CREATE INDEX IF NOT EXISTS idx_emp_history_not_deleted
  ON employee_record_history(employee_id, effective_date DESC)
  WHERE is_deleted = FALSE;
```

- [ ] **Step 2: Apply against the DB**

```bash
psql -h <host> -U employee_dev -d employee_portal -f migration_employee_history_extras.sql
```
Expected: a sequence of `ALTER TABLE` / `CREATE INDEX` lines, no errors.

- [ ] **Step 3: Verify columns exist**

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'employee_record_history'
  AND column_name IN ('is_deleted','approver_name','edited_by');
```
Expected: 3 rows returned.

- [ ] **Step 4: Commit**

```bash
git add migration_employee_history_extras.sql
git commit -m "feat(db): extend employee_record_history with probation types + soft-delete + approver fields"
```

---

### Task 2: Repository layer

**Files:**
- Create: `d:\Github\Emp_Portal_BackEnd\src\repositories\employeeHistory.repository.js`

- [ ] **Step 1: Write the repository module**

Create `d:\Github\Emp_Portal_BackEnd\src\repositories\employeeHistory.repository.js`:
```js
import { executeQuery } from '../../config/database.js'

const BASE_SELECT = `
  SELECT
    erh.record_id, erh.employee_id, erh.record_type,
    TO_CHAR(erh.effective_date, 'YYYY-MM-DD') AS effective_date,
    erh.old_gross_salary, erh.new_gross_salary,
    erh.old_department_id, erh.new_department_id,
    old_dept.department_name AS old_department_name,
    new_dept.department_name AS new_department_name,
    erh.old_designation_id, erh.new_designation_id,
    old_desg.desg_name AS old_designation_name,
    new_desg.desg_name AS new_designation_name,
    erh.old_employee_type_id, erh.new_employee_type_id,
    erh.old_location, erh.new_location, erh.old_grade, erh.new_grade,
    erh.old_value, erh.new_value,
    erh.change_amount, erh.change_percentage, erh.change_reason,
    erh.reference_no, erh.notes,
    erh.approver_name, erh.approver_designation,
    erh.approved_by, erh.approved_at, erh.approval_status,
    creator.first_name AS created_by_first_name, creator.last_name AS created_by_last_name,
    erh.created_by, erh.created_at, erh.updated_at,
    erh.edited_by, erh.edited_at,
    erh.is_deleted
  FROM employee_record_history erh
  LEFT JOIN departments old_dept ON erh.old_department_id = old_dept.department_id
  LEFT JOIN departments new_dept ON erh.new_department_id = new_dept.department_id
  LEFT JOIN designation old_desg ON erh.old_designation_id = old_desg.desg_id
  LEFT JOIN designation new_desg ON erh.new_designation_id = new_desg.desg_id
  LEFT JOIN employees creator ON erh.created_by = creator.employee_id
`

export async function listByEmployee(employeeId, { recordType } = {}) {
  const params = [employeeId]
  let sql = `${BASE_SELECT} WHERE erh.employee_id = $1 AND erh.is_deleted = FALSE`
  if (recordType) { params.push(recordType); sql += ` AND erh.record_type = $${params.length}` }
  sql += ' ORDER BY erh.effective_date DESC, erh.record_id DESC'
  return executeQuery(sql, params)
}

export async function getById(recordId) {
  const rows = await executeQuery(
    `${BASE_SELECT} WHERE erh.record_id = $1 AND erh.is_deleted = FALSE`,
    [recordId]
  )
  return rows[0] || null
}

export async function insert(data) {
  const cols = ['employee_id', 'record_type', 'effective_date']
  const vals = [data.employeeId, data.recordType, data.effectiveDate]
  const placeholders = ['$1', '$2', '$3']
  let i = 4
  const addCol = (col, val) => {
    if (val === undefined || val === null || val === '') return
    cols.push(col); vals.push(val); placeholders.push(`$${i++}`)
  }
  addCol('old_gross_salary', data.oldGrossSalary)
  addCol('new_gross_salary', data.newGrossSalary)
  addCol('old_department_id', data.oldDepartmentId)
  addCol('new_department_id', data.newDepartmentId)
  addCol('old_designation_id', data.oldDesignationId)
  addCol('new_designation_id', data.newDesignationId)
  addCol('old_employee_type_id', data.oldEmployeeTypeId)
  addCol('new_employee_type_id', data.newEmployeeTypeId)
  addCol('old_location', data.oldLocation)
  addCol('new_location', data.newLocation)
  addCol('old_grade', data.oldGrade)
  addCol('new_grade', data.newGrade)
  addCol('old_value', data.oldValue)
  addCol('new_value', data.newValue)
  addCol('change_amount', data.changeAmount)
  addCol('change_percentage', data.changePercentage)
  addCol('change_reason', data.changeReason)
  addCol('reference_no', data.referenceNo)
  addCol('notes', data.notes)
  addCol('approver_name', data.approverName)
  addCol('approver_designation', data.approverDesignation)
  addCol('approved_by', data.approvedBy)
  addCol('created_by', data.createdBy)
  const sql = `INSERT INTO employee_record_history (${cols.join(',')}) VALUES (${placeholders.join(',')}) RETURNING record_id`
  const rows = await executeQuery(sql, vals)
  return rows[0]?.record_id
}

export async function update(recordId, data, editedBy) {
  const set = []
  const vals = []
  let i = 1
  const addSet = (col, val) => {
    if (val === undefined) return
    set.push(`${col} = $${i++}`); vals.push(val === '' ? null : val)
  }
  addSet('effective_date', data.effectiveDate)
  addSet('record_type', data.recordType)
  addSet('old_gross_salary', data.oldGrossSalary)
  addSet('new_gross_salary', data.newGrossSalary)
  addSet('old_department_id', data.oldDepartmentId)
  addSet('new_department_id', data.newDepartmentId)
  addSet('old_designation_id', data.oldDesignationId)
  addSet('new_designation_id', data.newDesignationId)
  addSet('old_grade', data.oldGrade)
  addSet('new_grade', data.newGrade)
  addSet('old_location', data.oldLocation)
  addSet('new_location', data.newLocation)
  addSet('old_value', data.oldValue)
  addSet('new_value', data.newValue)
  addSet('change_amount', data.changeAmount)
  addSet('change_percentage', data.changePercentage)
  addSet('change_reason', data.changeReason)
  addSet('reference_no', data.referenceNo)
  addSet('notes', data.notes)
  addSet('approver_name', data.approverName)
  addSet('approver_designation', data.approverDesignation)
  if (set.length === 0) return 0
  set.push(`edited_by = $${i++}`); vals.push(editedBy ?? null)
  set.push(`edited_at = CURRENT_TIMESTAMP`)
  vals.push(recordId)
  const sql = `UPDATE employee_record_history SET ${set.join(', ')} WHERE record_id = $${i} AND is_deleted = FALSE`
  const result = await executeQuery(sql, vals)
  return result?.rowCount ?? 0
}

export async function softDelete(recordId, deletedBy) {
  const result = await executeQuery(
    `UPDATE employee_record_history
     SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP, deleted_by = $2
     WHERE record_id = $1 AND is_deleted = FALSE`,
    [recordId, deletedBy ?? null]
  )
  return result?.rowCount ?? 0
}

export async function findSameDayDuplicate(employeeId, recordType, effectiveDate) {
  const rows = await executeQuery(
    `SELECT record_id FROM employee_record_history
     WHERE employee_id = $1 AND record_type = $2 AND effective_date = $3 AND is_deleted = FALSE`,
    [employeeId, recordType, effectiveDate]
  )
  return rows[0]?.record_id || null
}
```

- [ ] **Step 2: Commit**

```bash
git add src/repositories/employeeHistory.repository.js
git commit -m "feat(history): repository for employee_record_history (CRUD + duplicate check)"
```

---

### Task 3: Service layer (validation + diff engine + helpers)

**Files:**
- Create: `d:\Github\Emp_Portal_BackEnd\src\services\employeeHistory.service.js`

- [ ] **Step 1: Write the service**

Create `d:\Github\Emp_Portal_BackEnd\src\services\employeeHistory.service.js`:
```js
import * as historyRepo from '../repositories/employeeHistory.repository.js'

const VALID_TYPES = new Set([
  'salary_change','department_change','designation_change','employee_type_change',
  'confirmation','probation_start','probation_extended',
  'joining','last_working_date','rehire','location_change','grade_change','other'
])

// Tenure helpers — used by the frontend, also exposed if any backend reporting wants it
export function tenureMonths(joinDate, endDate) {
  if (!joinDate) return 0
  const a = new Date(joinDate), b = endDate ? new Date(endDate) : new Date()
  return Math.max(0, (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()))
}

export function pctChange(oldVal, newVal) {
  const o = Number(oldVal), n = Number(newVal)
  if (!isFinite(o) || !isFinite(n) || o === 0) return null
  return Math.round(((n - o) / o) * 10000) / 100
}

export async function listForEmployee(employeeId, { recordType } = {}) {
  const id = parseInt(employeeId, 10)
  if (!Number.isInteger(id)) return { error: 'Invalid employee id', status: 400 }
  if (recordType && !VALID_TYPES.has(recordType)) return { error: 'Invalid record type', status: 400 }
  return historyRepo.listByEmployee(id, { recordType })
}

export async function getOne(recordId) {
  const id = parseInt(recordId, 10)
  if (!Number.isInteger(id)) return { error: 'Invalid record id', status: 400 }
  const row = await historyRepo.getById(id)
  if (!row) return { error: 'History event not found', status: 404 }
  return row
}

export async function createEvent(employeeId, body, createdBy) {
  const id = parseInt(employeeId, 10)
  if (!Number.isInteger(id)) return { error: 'Invalid employee id', status: 400 }
  if (!body?.recordType || !VALID_TYPES.has(body.recordType)) {
    return { error: 'Valid recordType is required', status: 400 }
  }
  if (!body?.effectiveDate) return { error: 'effectiveDate is required (YYYY-MM-DD)', status: 400 }
  const dup = await historyRepo.findSameDayDuplicate(id, body.recordType, body.effectiveDate)
  if (dup) {
    return { error: `An event of type "${body.recordType}" already exists for this employee on ${body.effectiveDate}.`, status: 409 }
  }

  const payload = { ...body, employeeId: id, createdBy }
  // Auto-calc salary delta and percentage when both values are present
  if (body.recordType === 'salary_change' && body.oldGrossSalary != null && body.newGrossSalary != null) {
    payload.changeAmount = Number(body.newGrossSalary) - Number(body.oldGrossSalary)
    payload.changePercentage = pctChange(body.oldGrossSalary, body.newGrossSalary)
  }
  const recordId = await historyRepo.insert(payload)
  return { recordId, message: 'History event created' }
}

export async function updateEvent(recordId, body, editedBy) {
  const id = parseInt(recordId, 10)
  if (!Number.isInteger(id)) return { error: 'Invalid record id', status: 400 }
  if (body.recordType && !VALID_TYPES.has(body.recordType)) return { error: 'Invalid record type', status: 400 }
  const patched = { ...body }
  if (body.oldGrossSalary != null && body.newGrossSalary != null) {
    patched.changeAmount = Number(body.newGrossSalary) - Number(body.oldGrossSalary)
    patched.changePercentage = pctChange(body.oldGrossSalary, body.newGrossSalary)
  }
  const rows = await historyRepo.update(id, patched, editedBy)
  if (rows === 0) return { error: 'History event not found', status: 404 }
  return { message: 'History event updated' }
}

export async function deleteEvent(recordId, deletedBy) {
  const id = parseInt(recordId, 10)
  if (!Number.isInteger(id)) return { error: 'Invalid record id', status: 400 }
  const rows = await historyRepo.softDelete(id, deletedBy)
  if (rows === 0) return { error: 'History event not found', status: 404 }
  return { message: 'History event deleted' }
}

// Map employee column → history record_type for auto-log
const TRACKED_FIELDS = {
  department_id: 'department_change',
  designation_id: 'designation_change',
  employee_type_id: 'employee_type_change',
  grade: 'grade_change',
  city_id: 'location_change',
  station_id: 'location_change',
}

/**
 * Compare `before` and `after` employee rows and insert a history row for each tracked field
 * that changed. Idempotent for same-day re-saves (uses findSameDayDuplicate).
 * Auto-log never throws — failures are logged but don't block the parent update.
 */
export async function autoLogFromDiff({ employeeId, before, after, effectiveDate, createdBy }) {
  if (!employeeId || !before || !after) return []
  const date = effectiveDate || new Date().toISOString().slice(0, 10)
  const inserted = []
  for (const [field, type] of Object.entries(TRACKED_FIELDS)) {
    const oldV = before[field]
    const newV = after[field]
    if (oldV == null && newV == null) continue
    if (String(oldV ?? '') === String(newV ?? '')) continue

    const data = {
      employeeId, recordType: type, effectiveDate: date, createdBy,
      changeReason: 'Auto-logged from employee record update',
    }
    if (field === 'department_id') { data.oldDepartmentId = oldV; data.newDepartmentId = newV }
    if (field === 'designation_id') { data.oldDesignationId = oldV; data.newDesignationId = newV }
    if (field === 'employee_type_id') { data.oldEmployeeTypeId = oldV; data.newEmployeeTypeId = newV }
    if (field === 'grade') { data.oldGrade = oldV; data.newGrade = newV }
    if (field === 'city_id' || field === 'station_id') {
      data.oldLocation = String(oldV ?? ''); data.newLocation = String(newV ?? '')
    }
    try {
      const dup = await historyRepo.findSameDayDuplicate(employeeId, type, date)
      if (dup) continue
      const id = await historyRepo.insert(data)
      inserted.push({ recordId: id, recordType: type })
    } catch (e) {
      console.warn(`autoLogFromDiff(${type}) skipped:`, e.message)
    }
  }
  // Also auto-log separation when last_working_date was just set
  if (after.last_working_date && !before.last_working_date) {
    try {
      const dup = await historyRepo.findSameDayDuplicate(employeeId, 'last_working_date', after.last_working_date)
      if (!dup) {
        const id = await historyRepo.insert({
          employeeId, recordType: 'last_working_date',
          effectiveDate: after.last_working_date, createdBy,
          changeReason: 'Auto-logged from employee record update'
        })
        inserted.push({ recordId: id, recordType: 'last_working_date' })
      }
    } catch (e) {
      console.warn('autoLogFromDiff(last_working_date) skipped:', e.message)
    }
  }
  return inserted
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/employeeHistory.service.js
git commit -m "feat(history): service with CRUD validation, diff engine, salary delta calc"
```

---

### Task 4: Controller + routes + mount

**Files:**
- Create: `d:\Github\Emp_Portal_BackEnd\src\controllers\employeeHistory.controller.js`
- Create: `d:\Github\Emp_Portal_BackEnd\src\routes\employeeHistory.routes.js`
- Modify: `d:\Github\Emp_Portal_BackEnd\src\routes\index.js`
- Modify: `d:\Github\Emp_Portal_BackEnd\app.js`

- [ ] **Step 1: Write the controller**

Create `d:\Github\Emp_Portal_BackEnd\src\controllers\employeeHistory.controller.js`:
```js
import * as historyService from '../services/employeeHistory.service.js'

function actorId(req) {
  return req.session?.user?.employeeId || req.session?.user?.id || null
}

function isHrOrAdmin(req) {
  const u = req.session?.user
  if (!u) return false
  if (u.userType === 'SuperAdmin') return true
  return Array.isArray(u.permissions) && u.permissions.includes('administration')
}

export async function list(req, res) {
  try {
    const result = await historyService.listForEmployee(req.params.id, { recordType: req.query.type })
    if (result?.error) return res.status(result.status).json({ error: result.error })
    res.json(result)
  } catch (e) {
    console.error('history.list error:', e)
    res.status(500).json({ error: 'Failed to fetch history' })
  }
}

export async function getOne(req, res) {
  try {
    const result = await historyService.getOne(req.params.eventId)
    if (result?.error) return res.status(result.status).json({ error: result.error })
    res.json(result)
  } catch (e) {
    console.error('history.getOne error:', e)
    res.status(500).json({ error: 'Failed to fetch event' })
  }
}

export async function create(req, res) {
  try {
    if (!isHrOrAdmin(req)) {
      return res.status(403).json({ error: 'Only HR or SuperAdmin can add history events' })
    }
    const result = await historyService.createEvent(req.params.id, req.body, actorId(req))
    if (result?.error) return res.status(result.status).json({ error: result.error })
    res.status(201).json(result)
  } catch (e) {
    console.error('history.create error:', e)
    res.status(500).json({ error: 'Failed to create event' })
  }
}

export async function update(req, res) {
  try {
    if (!isHrOrAdmin(req)) {
      return res.status(403).json({ error: 'Only HR or SuperAdmin can edit history events' })
    }
    const result = await historyService.updateEvent(req.params.eventId, req.body, actorId(req))
    if (result?.error) return res.status(result.status).json({ error: result.error })
    res.json(result)
  } catch (e) {
    console.error('history.update error:', e)
    res.status(500).json({ error: 'Failed to update event' })
  }
}

export async function remove(req, res) {
  try {
    if (!isHrOrAdmin(req)) {
      return res.status(403).json({ error: 'Only HR or SuperAdmin can delete history events' })
    }
    const result = await historyService.deleteEvent(req.params.eventId, actorId(req))
    if (result?.error) return res.status(result.status).json({ error: result.error })
    res.json(result)
  } catch (e) {
    console.error('history.delete error:', e)
    res.status(500).json({ error: 'Failed to delete event' })
  }
}
```

- [ ] **Step 2: Write the router**

Create `d:\Github\Emp_Portal_BackEnd\src\routes\employeeHistory.routes.js`:
```js
import express from 'express'
import * as ctrl from '../controllers/employeeHistory.controller.js'

const router = express.Router()

router.get('/employees/:id/history', ctrl.list)
router.post('/employees/:id/history', ctrl.create)
router.get('/employees/:id/history/:eventId', ctrl.getOne)
router.put('/employees/:id/history/:eventId', ctrl.update)
router.delete('/employees/:id/history/:eventId', ctrl.remove)

export default router
```

- [ ] **Step 3: Export from the routes index**

Edit `d:\Github\Emp_Portal_BackEnd\src\routes\index.js`. Append after the existing exports:
```js
export { default as employeeHistoryRoutes } from './employeeHistory.routes.js'
```

- [ ] **Step 4: Mount the router in app.js**

Edit `d:\Github\Emp_Portal_BackEnd\app.js`. Update the import block at line 18 to include the new export:
```js
import {
  dashboardRoutes,
  profileRoutes,
  salaryRoutes,
  leaveRoutes,
  feedbackRoutes,
  requisitionRoutes,
  extensionsRoutes,
  authRoutes,
  administrationRoutes,
  payrollRoutes,
  rolePermissionsRoutes,
  cardsRoutes,
  notificationRoutes,
  employeeHistoryRoutes   // NEW
} from './src/routes/index.js'
```

Then add the mount line right after `app.use('/api/administration', administrationRoutes)` at line 144:
```js
app.use('/api', employeeHistoryRoutes)   // routes resolve to /api/employees/:id/history/...
```

- [ ] **Step 5: Restart backend and smoke-test**

```bash
curl -s http://localhost:5000/api/employees/10147/history | head -50
```
Expected: a JSON array — `[]` if no events yet, or actual rows if any exist. Should NOT return 404 or HTML.

- [ ] **Step 6: Commit**

```bash
git add src/controllers/employeeHistory.controller.js src/routes/employeeHistory.routes.js src/routes/index.js app.js
git commit -m "feat(history): REST endpoints (list/get/create/update/delete) with HR guard"
```

---

### Task 5: Auto-log diff hook on updateEmployee

**Files:**
- Modify: `d:\Github\Emp_Portal_BackEnd\src\services\administration.service.js`
- Modify: `d:\Github\Emp_Portal_BackEnd\src\repositories\administration.repository.js`

- [ ] **Step 1: Add a `getEmployeeById` helper if missing**

Check if the repository already has one:
```bash
grep -n "getEmployeeById\b" d:/Github/Emp_Portal_BackEnd/src/repositories/administration.repository.js
```
If no output, append to `src/repositories/administration.repository.js`:
```js
export async function getEmployeeById(id) {
  return executeQuery('SELECT * FROM employees WHERE employee_id = $1', [id])
}
```

- [ ] **Step 2: Locate updateEmployee in administration.service.js**

```bash
grep -n "export async function updateEmployee" d:/Github/Emp_Portal_BackEnd/src/services/administration.service.js
```
Note the line number.

- [ ] **Step 3: Wrap with diff hook**

At the top of `src/services/administration.service.js`, add the import (place near other service imports):
```js
import * as historyService from './employeeHistory.service.js'
```

Inside `updateEmployee(id, body)`, just before the line that calls `adminRepo.updateEmployee(id, ...)`, snapshot the before state:
```js
const beforeRows = await adminRepo.getEmployeeById(id)
const before = beforeRows?.[0] || null
```

Immediately after the existing update call succeeds (and before any return), snapshot the after state and call the diff hook:
```js
const afterRows = await adminRepo.getEmployeeById(id)
const after = afterRows?.[0] || null
const actorEmployeeId = body.actorEmployeeId || body.createdBy || null
if (before && after) {
  await historyService.autoLogFromDiff({
    employeeId: id, before, after,
    effectiveDate: new Date().toISOString().slice(0, 10),
    createdBy: actorEmployeeId
  }).catch((err) => console.warn('autoLogFromDiff failed:', err.message))
}
```

- [ ] **Step 4: Restart backend and verify auto-log fires**

Open the frontend, edit any employee's department to a different value, save. Then:
```bash
curl -s "http://localhost:5000/api/employees/<id>/history" | head -50
```
Expected: a row with `record_type: "department_change"`, `change_reason: "Auto-logged from employee record update"`, plus matching `old_department_id` / `new_department_id`.

- [ ] **Step 5: Commit**

```bash
git add src/services/administration.service.js src/repositories/administration.repository.js
git commit -m "feat(history): auto-log employee field diffs to history on update"
```

---

### Task 6: Frontend API methods

**Files:**
- Modify: `d:\Github\Emp_Portal_FrontEnd\src\services\api.js`

- [ ] **Step 1: Append the new API object**

Add to the bottom of `d:\Github\Emp_Portal_FrontEnd\src\services\api.js` (after `administrationAPI`):
```js
export const employeeHistoryAPI = {
  list: (employeeId, params = {}) => {
    const q = new URLSearchParams()
    if (params.type) q.set('type', params.type)
    const qs = q.toString()
    return apiCall(`/employees/${employeeId}/history${qs ? '?' + qs : ''}`)
  },
  getOne: (employeeId, eventId) =>
    apiCall(`/employees/${employeeId}/history/${eventId}`),
  create: (employeeId, data) =>
    apiCall(`/employees/${employeeId}/history`, { method: 'POST', body: JSON.stringify(data) }),
  update: (employeeId, eventId, data) =>
    apiCall(`/employees/${employeeId}/history/${eventId}`, { method: 'PUT', body: JSON.stringify(data) }),
  remove: (employeeId, eventId) =>
    apiCall(`/employees/${employeeId}/history/${eventId}`, { method: 'DELETE' }),
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/api.js
git commit -m "feat(history): employeeHistoryAPI client methods"
```

---

### Task 7: EmployeeHistoryModal component (timeline UI)

**Files:**
- Create: `d:\Github\Emp_Portal_FrontEnd\src\components\EmployeeHistoryModal.jsx`
- Create: `d:\Github\Emp_Portal_FrontEnd\src\components\EmployeeHistoryModal.css`

- [ ] **Step 1: Write the JSX**

Create `d:\Github\Emp_Portal_FrontEnd\src\components\EmployeeHistoryModal.jsx`:
```jsx
import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { X, Plus, Edit2, Trash2, Calendar, FileText, CheckCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import { employeeHistoryAPI } from '../services/api'
import './EmployeeHistoryModal.css'

const TYPES = [
  { key: 'all',                  label: 'All' },
  { key: 'joining',              label: 'Joining' },
  { key: 'probation_start',      label: 'Probation Start' },
  { key: 'confirmation',         label: 'Confirmation' },
  { key: 'probation_extended',   label: 'Probation Extended' },
  { key: 'grade_change',         label: 'Grade' },
  { key: 'department_change',    label: 'Department' },
  { key: 'designation_change',   label: 'Designation' },
  { key: 'salary_change',        label: 'Salary' },
  { key: 'location_change',      label: 'Location' },
  { key: 'last_working_date',    label: 'Separation' },
]

const TYPE_META = {
  joining:              { label: 'New Joining',           color: '#1D9E75' },
  probation_start:      { label: 'Probation Started',     color: '#378ADD' },
  confirmation:         { label: 'Confirmed / Permanent', color: '#1D9E75' },
  probation_extended:   { label: 'Probation Extended',    color: '#EF9F27' },
  grade_change:         { label: 'Grade Change',          color: '#7F77DD' },
  department_change:    { label: 'Department Change',     color: '#EF9F27' },
  designation_change:   { label: 'Designation Change',    color: '#D85A30' },
  salary_change:        { label: 'Salary Change',         color: '#1D9E75' },
  location_change:      { label: 'Location Change',       color: '#D4537E' },
  last_working_date:    { label: 'Last Working Day',      color: '#E24B4A' },
  employee_type_change: { label: 'Employee Type Change',  color: '#7F77DD' },
  rehire:               { label: 'Rehire',                color: '#1D9E75' },
  other:                { label: 'Other',                 color: '#6b7280' },
}

function fmt(date) {
  if (!date) return '—'
  const d = new Date(`${date}T00:00:00`)
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

function tenureLabel(joinDate, endDate) {
  if (!joinDate) return '—'
  const a = new Date(joinDate), b = endDate ? new Date(endDate) : new Date()
  const months = Math.max(0, (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()))
  const yrs = Math.floor(months / 12), mos = months % 12
  if (yrs === 0 && mos === 0) return '< 1 mo'
  return [yrs ? `${yrs} yr${yrs > 1 ? 's' : ''}` : '', mos ? `${mos} mo` : ''].filter(Boolean).join(' ')
}

function changeLine(ev) {
  switch (ev.record_type) {
    case 'salary_change':
      return ev.old_gross_salary != null
        ? `PKR ${Number(ev.old_gross_salary).toLocaleString()} → PKR ${Number(ev.new_gross_salary).toLocaleString()} (${ev.change_percentage ?? '—'}%)`
        : `PKR ${Number(ev.new_gross_salary).toLocaleString()}`
    case 'department_change':
      return `${ev.old_department_name || '—'} → ${ev.new_department_name || '—'}`
    case 'designation_change':
      return `${ev.old_designation_name || '—'} → ${ev.new_designation_name || '—'}`
    case 'grade_change':
      return `${ev.old_grade || '—'} → ${ev.new_grade || '—'}`
    case 'location_change':
      return `${ev.old_location || '—'} → ${ev.new_location || '—'}`
    default:
      return ev.change_reason || ''
  }
}

export default function EmployeeHistoryModal({ employee, onClose }) {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [formOpen, setFormOpen] = useState(false)
  const [editingEvent, setEditingEvent] = useState(null)

  const reload = async () => {
    if (!employee?.id) return
    setLoading(true)
    try {
      const rows = await employeeHistoryAPI.list(employee.id)
      setEvents(Array.isArray(rows) ? rows : [])
    } catch (e) {
      toast.error(e.message || 'Failed to load history')
      setEvents([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [employee?.id])

  const filtered = useMemo(() => (
    filter === 'all' ? events : events.filter((e) => e.record_type === filter)
  ), [events, filter])

  const joinEv = useMemo(() => events.find((e) => e.record_type === 'joining'), [events])
  const sepEv  = useMemo(() => events.find((e) => e.record_type === 'last_working_date'), [events])
  const latestSal = useMemo(
    () => [...events].filter((e) => e.record_type === 'salary_change')
      .sort((a, b) => new Date(b.effective_date) - new Date(a.effective_date))[0],
    [events]
  )

  if (!employee) return null

  const initials = ((employee.first_name?.[0] || '') + (employee.last_name?.[0] || '')).toUpperCase()

  return createPortal(
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="ehm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ehm-header">
          <div className="ehm-emp">
            <div className="ehm-avatar">{initials}</div>
            <div>
              <div className="ehm-name">{employee.first_name} {employee.last_name}</div>
              <div className="ehm-meta">{employee.department_name || '—'} · Code: {employee.code || employee.employee_code || '—'}</div>
            </div>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>

        <div className="ehm-stats">
          <div className="ehm-stat"><div className="ehm-stat-label">Joining</div><div className="ehm-stat-val">{fmt(joinEv?.effective_date || employee.join_date)}</div></div>
          <div className="ehm-stat"><div className="ehm-stat-label">Tenure</div><div className="ehm-stat-val">{tenureLabel(joinEv?.effective_date || employee.join_date, sepEv?.effective_date)}</div></div>
          <div className="ehm-stat"><div className="ehm-stat-label">Events</div><div className="ehm-stat-val">{events.length}</div></div>
          <div className="ehm-stat"><div className="ehm-stat-label">Latest Salary</div><div className="ehm-stat-val">{latestSal ? `PKR ${Number(latestSal.new_gross_salary).toLocaleString()}` : '—'}</div></div>
        </div>

        <div className="ehm-filters">
          {TYPES.map((t) => (
            <button key={t.key} type="button"
              className={`ehm-chip ${filter === t.key ? 'active' : ''}`}
              onClick={() => setFilter(t.key)}>{t.label}</button>
          ))}
          <button type="button" className="btn btn-sm btn-primary ehm-add"
            onClick={() => { setEditingEvent(null); setFormOpen(true) }}>
            <Plus size={14} /> Add Event
          </button>
        </div>

        <div className="ehm-body">
          {loading ? (
            <p className="ehm-empty">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="ehm-empty">No events in this category.</p>
          ) : (
            <div className="ehm-timeline">
              <div className="ehm-tl-line" />
              {filtered.map((ev) => {
                const meta = TYPE_META[ev.record_type] || TYPE_META.other
                return (
                  <div key={ev.record_id} className="ehm-tl-item">
                    <span className="ehm-tl-dot" style={{ background: meta.color }} />
                    <div className="ehm-tl-card">
                      <div className="ehm-tl-head">
                        <span className="ehm-badge" style={{ background: `${meta.color}1F`, color: meta.color }}>{meta.label}</span>
                        <span className="ehm-tl-date"><Calendar size={12} /> {fmt(ev.effective_date)}</span>
                      </div>
                      <div className="ehm-tl-change">{changeLine(ev)}</div>
                      {ev.change_reason && <div className="ehm-tl-desc">{ev.change_reason}</div>}
                      {ev.reference_no && <div className="ehm-tl-ref"><FileText size={12} /> Ref: {ev.reference_no}</div>}
                      {ev.approver_name && <div className="ehm-tl-approver"><CheckCircle size={12} /> Approved by: {ev.approver_name}{ev.approver_designation ? ` (${ev.approver_designation})` : ''}</div>}
                      <div className="ehm-tl-actions">
                        <button type="button" className="btn-icon"
                          onClick={() => { setEditingEvent(ev); setFormOpen(true) }}
                          title="Edit"><Edit2 size={14} /></button>
                        <button type="button" className="btn-icon danger"
                          onClick={async () => {
                            if (!window.confirm('Delete this history event? (soft delete — record is preserved for audit)')) return
                            try { await employeeHistoryAPI.remove(employee.id, ev.record_id); toast.success('Deleted'); reload() }
                            catch (e) { toast.error(e.message || 'Delete failed') }
                          }}
                          title="Delete"><Trash2 size={14} /></button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {formOpen && (
          <EventForm
            employeeId={employee.id}
            initial={editingEvent}
            onSaved={() => { setFormOpen(false); setEditingEvent(null); reload() }}
            onCancel={() => { setFormOpen(false); setEditingEvent(null) }}
          />
        )}
      </div>
    </div>,
    document.body
  )
}

function EventForm({ employeeId, initial, onSaved, onCancel }) {
  const isEdit = !!initial
  const [form, setForm] = useState(() => ({
    recordType: initial?.record_type || '',
    effectiveDate: initial?.effective_date || new Date().toISOString().slice(0, 10),
    oldGrossSalary: initial?.old_gross_salary || '',
    newGrossSalary: initial?.new_gross_salary || '',
    oldGrade: initial?.old_grade || '',
    newGrade: initial?.new_grade || '',
    oldLocation: initial?.old_location || '',
    newLocation: initial?.new_location || '',
    changeReason: initial?.change_reason || '',
    referenceNo: initial?.reference_no || '',
    approverName: initial?.approver_name || '',
    approverDesignation: initial?.approver_designation || '',
    notes: initial?.notes || '',
  }))
  const [saving, setSaving] = useState(false)

  const need = (cond) => form.recordType === cond

  const save = async (e) => {
    e.preventDefault()
    if (!form.recordType || !form.effectiveDate) {
      toast.error('Event type and effective date are required')
      return
    }
    setSaving(true)
    try {
      const payload = { ...form }
      if (isEdit) {
        await employeeHistoryAPI.update(employeeId, initial.record_id, payload)
        toast.success('Event updated')
      } else {
        await employeeHistoryAPI.create(employeeId, payload)
        toast.success('Event added')
      }
      onSaved()
    } catch (err) {
      toast.error(err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="ehm-form-overlay" onClick={onCancel}>
      <form className="ehm-form" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div className="ehm-form-title">{isEdit ? 'Edit Event' : 'New History Event'}</div>
        <div className="ehm-form-grid">
          <div className="form-group">
            <label>Event Type *</label>
            <select className="input" value={form.recordType} onChange={(e) => setForm({ ...form, recordType: e.target.value })} required disabled={isEdit}>
              <option value="">— Select —</option>
              <option value="joining">New Joining</option>
              <option value="probation_start">Probation Start</option>
              <option value="confirmation">Confirmation</option>
              <option value="probation_extended">Probation Extended</option>
              <option value="grade_change">Grade Change</option>
              <option value="department_change">Department Change</option>
              <option value="designation_change">Designation Change</option>
              <option value="salary_change">Salary Change</option>
              <option value="location_change">City / Station Change</option>
              <option value="last_working_date">Last Working Day</option>
            </select>
          </div>
          <div className="form-group">
            <label>Effective Date *</label>
            <input type="date" className="input" value={form.effectiveDate} onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })} required />
          </div>
          {need('salary_change') && (
            <>
              <div className="form-group"><label>From Salary (PKR)</label><input type="number" className="input" value={form.oldGrossSalary} onChange={(e) => setForm({ ...form, oldGrossSalary: e.target.value })} /></div>
              <div className="form-group"><label>To Salary (PKR) *</label><input type="number" className="input" value={form.newGrossSalary} onChange={(e) => setForm({ ...form, newGrossSalary: e.target.value })} required /></div>
            </>
          )}
          {need('grade_change') && (
            <>
              <div className="form-group"><label>From Grade</label><input className="input" value={form.oldGrade} onChange={(e) => setForm({ ...form, oldGrade: e.target.value })} /></div>
              <div className="form-group"><label>To Grade *</label><input className="input" value={form.newGrade} onChange={(e) => setForm({ ...form, newGrade: e.target.value })} required /></div>
            </>
          )}
          {need('location_change') && (
            <>
              <div className="form-group"><label>From Location</label><input className="input" value={form.oldLocation} onChange={(e) => setForm({ ...form, oldLocation: e.target.value })} /></div>
              <div className="form-group"><label>To Location *</label><input className="input" value={form.newLocation} onChange={(e) => setForm({ ...form, newLocation: e.target.value })} required /></div>
            </>
          )}
          <div className="form-group"><label>Approved By (Name)</label><input className="input" value={form.approverName} onChange={(e) => setForm({ ...form, approverName: e.target.value })} placeholder="e.g. Aisha Khan" /></div>
          <div className="form-group"><label>Approver Designation</label><input className="input" value={form.approverDesignation} onChange={(e) => setForm({ ...form, approverDesignation: e.target.value })} placeholder="e.g. HR Director" /></div>
          <div className="form-group"><label>Reference / Letter No.</label><input className="input" value={form.referenceNo} onChange={(e) => setForm({ ...form, referenceNo: e.target.value })} placeholder="e.g. HR/2024/0134" /></div>
          <div className="form-group ehm-form-full"><label>Reason / Summary</label><input className="input" value={form.changeReason} onChange={(e) => setForm({ ...form, changeReason: e.target.value })} placeholder="Short summary" /></div>
          <div className="form-group ehm-form-full"><label>Remarks / Notes</label><textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
        <div className="ehm-form-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save Event'}</button>
        </div>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Write the CSS**

Create `d:\Github\Emp_Portal_FrontEnd\src\components\EmployeeHistoryModal.css`:
```css
.ehm-modal {
  background: var(--surface, #fff);
  width: min(900px, 96vw);
  max-height: 92vh;
  border-radius: var(--radius-lg, 10px);
  display: flex; flex-direction: column;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0,0,0,.25);
  position: relative;
}
.ehm-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 22px;
  border-bottom: 1px solid var(--border-light, #e5e7eb);
}
.ehm-emp { display: flex; align-items: center; gap: 12px; }
.ehm-avatar {
  width: 44px; height: 44px; border-radius: 50%;
  background: var(--primary-muted, #eff6ff);
  color: var(--primary-hover, #1d4ed8);
  display: grid; place-items: center; font-weight: 700; font-size: 15px;
}
.ehm-name { font-weight: 700; font-size: 15px; }
.ehm-meta { font-size: 12px; color: var(--text-secondary, #6b7280); margin-top: 2px; }
.ehm-stats {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;
  padding: 14px 22px;
  background: var(--background, #f9fafb);
  border-bottom: 1px solid var(--border-light, #e5e7eb);
}
.ehm-stat {
  background: #fff; border: 1px solid var(--border-light, #e5e7eb);
  border-radius: 6px; padding: 10px 12px;
}
.ehm-stat-label { font-size: 11px; color: var(--text-secondary, #6b7280); text-transform: uppercase; letter-spacing: .04em; }
.ehm-stat-val { font-size: 14px; font-weight: 600; margin-top: 4px; }
.ehm-filters {
  display: flex; gap: 6px; flex-wrap: wrap;
  padding: 12px 22px;
  border-bottom: 1px solid var(--border-light, #e5e7eb);
}
.ehm-chip {
  font-size: 12px; padding: 5px 12px; border-radius: 100px;
  border: 1px solid var(--border-color, #d1d5db); background: transparent;
  color: var(--text-secondary, #6b7280); cursor: pointer;
}
.ehm-chip:hover { background: var(--background, #f9fafb); }
.ehm-chip.active { background: var(--primary, #2563eb); color: #fff; border-color: var(--primary, #2563eb); }
.ehm-add { margin-left: auto; }
.ehm-body { padding: 18px 22px; overflow-y: auto; flex: 1; }
.ehm-empty { text-align: center; color: var(--text-secondary, #6b7280); padding: 28px 0; font-size: 13px; }
.ehm-timeline { position: relative; padding-left: 28px; }
.ehm-tl-line {
  position: absolute; left: 10px; top: 0; bottom: 0;
  width: 1px; background: var(--border-light, #e5e7eb);
}
.ehm-tl-item { position: relative; margin-bottom: 16px; }
.ehm-tl-dot {
  position: absolute; left: -23px; top: 14px;
  width: 12px; height: 12px; border-radius: 50%;
  border: 2px solid #fff;
}
.ehm-tl-card {
  background: #fff; border: 1px solid var(--border-light, #e5e7eb);
  border-radius: 8px; padding: 12px 14px; position: relative;
}
.ehm-tl-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; gap: 8px; }
.ehm-badge { font-size: 11px; font-weight: 600; padding: 3px 9px; border-radius: 100px; }
.ehm-tl-date { font-size: 11px; color: var(--text-secondary, #6b7280); display: inline-flex; align-items: center; gap: 4px; }
.ehm-tl-change { font-size: 13px; font-weight: 500; margin-bottom: 4px; }
.ehm-tl-desc { font-size: 12px; color: var(--text-secondary, #6b7280); line-height: 1.4; }
.ehm-tl-ref { font-size: 11px; color: var(--text-secondary, #6b7280); margin-top: 6px; display: inline-flex; align-items: center; gap: 4px; }
.ehm-tl-approver { font-size: 11px; color: #16a34a; margin-top: 6px; display: inline-flex; align-items: center; gap: 4px; }
.ehm-tl-actions { position: absolute; right: 10px; bottom: 10px; display: flex; gap: 6px; }
.ehm-form-overlay {
  position: absolute; inset: 0; background: rgba(0,0,0,.35);
  display: grid; place-items: center; z-index: 5;
}
.ehm-form {
  background: #fff; width: min(680px, 94%); max-height: 88%; overflow-y: auto;
  border-radius: 10px; padding: 20px;
  box-shadow: 0 12px 32px rgba(0,0,0,.18);
}
.ehm-form-title { font-size: 15px; font-weight: 700; margin-bottom: 14px; }
.ehm-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.ehm-form-full { grid-column: 1 / -1; }
.ehm-form-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }

@media (max-width: 720px) {
  .ehm-stats { grid-template-columns: repeat(2, 1fr); }
  .ehm-form-grid { grid-template-columns: 1fr; }
}
```

- [ ] **Step 3: Build to verify it compiles**

```bash
cd d:/Github/Emp_Portal_FrontEnd && npx vite build
```
Expected: `✓ built in N s`. No errors about missing imports.

- [ ] **Step 4: Commit**

```bash
git add src/components/EmployeeHistoryModal.jsx src/components/EmployeeHistoryModal.css
git commit -m "feat(history): EmployeeHistoryModal timeline component with add/edit/delete"
```

---

### Task 8: Wire into Administration page

**Files:**
- Modify: `d:\Github\Emp_Portal_FrontEnd\src\pages\Administration.jsx`

- [ ] **Step 1: Add the `Eye` icon to the lucide import**

The existing import on line 3 already includes many icons. Add `Eye`:

Old:
```jsx
import { Settings, Building2, Briefcase, Users, UserPlus, Pencil, Trash2, X, MapPin, Radio, Search, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Filter, Package, LayoutGrid, ClipboardList, History, TrendingUp } from 'lucide-react'
```

New:
```jsx
import { Settings, Building2, Briefcase, Users, UserPlus, Pencil, Trash2, X, MapPin, Radio, Search, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Filter, Package, LayoutGrid, ClipboardList, History, TrendingUp, Eye } from 'lucide-react'
```

- [ ] **Step 2: Import the modal component**

After the existing component imports near the top:
```jsx
import EmployeeHistoryModal from '../components/EmployeeHistoryModal'
```

- [ ] **Step 3: Add state for the open modal**

Inside `function Administration()`, near other `useState` hooks (after `setModalOpen` etc.):
```jsx
const [historyEmployee, setHistoryEmployee] = useState(null)
```

- [ ] **Step 4: Replace the Deactivate button with View History**

In the employees row actions block (around lines 1527-1532), replace the Trash2 button. The current code is:
```jsx
<button type="button" className="btn-icon" onClick={() => openEdit(emp)} title="Edit"><Pencil size={14} /></button>
{emp.is_active && (
  <button type="button" className="btn-icon danger" onClick={() => handleDeactivateClick(emp.id)} title="Deactivate"><Trash2 size={14} /></button>
)}
```

Replace with:
```jsx
<button type="button" className="btn-icon" onClick={() => openEdit(emp)} title="Edit"><Pencil size={14} /></button>
<button type="button" className="btn-icon" onClick={() => setHistoryEmployee(emp)} title="View History"><Eye size={14} /></button>
```

(`handleDeactivateClick` is still callable from the Edit form's Active checkbox, so the deactivate path is preserved.)

- [ ] **Step 5: Render the modal**

Near the bottom of the JSX return, alongside other modals (search for `viewLogsModalOpen` or `filterModalOpen` to find a good neighbor):
```jsx
{historyEmployee && (
  <EmployeeHistoryModal
    employee={historyEmployee}
    onClose={() => setHistoryEmployee(null)}
  />
)}
```

- [ ] **Step 6: Build + smoke-test**

```bash
cd d:/Github/Emp_Portal_FrontEnd && npx vite build
```
Expected: `✓ built in N s`.

Refresh the browser → Administration → Employees tab. The Delete trash icon should be gone, replaced by an eye icon. Click it on any employee:
- Modal opens with header (avatar, name, dept), stats (joining, tenure, events, salary), filter chips, timeline.
- If the seed migration was applied, every employee should already have a "joining" event.
- Click "Add Event" → form appears → fill `salary_change` with old=100000 new=125000 → Save → timeline refreshes and shows the new entry with `25%` calculated.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Administration.jsx
git commit -m "feat(history): replace employees Delete action with View History modal"
```

---

### Task 9: Edge-case verification

**Files:**
- No code changes expected unless a case fails.

- [ ] **Step 1: Past effective date**

Add a new event with `effectiveDate = 2018-01-01`. Expected: 201 Created. (HR is allowed to backfill historical records.)

- [ ] **Step 2: Same-day duplicate**

Add a `salary_change` event for an employee on date X. Try to add another `salary_change` event for the same employee on the same date X. Expected: toast "An event of type 'salary_change' already exists for this employee on YYYY-MM-DD." Backend returns 409.

- [ ] **Step 3: Rehire after separation**

Add `last_working_date` on 2024-01-01. Then add `rehire` on 2024-06-01. Expected: both appear in timeline; tenure recalculation isn't broken (tenure currently uses join date → separation date). No automatic tenure reset is performed (manual data entry — fine for v1).

- [ ] **Step 4: Salary slip on hold during separation**

Toggle `salary_slip_on_hold = true` on the employee, then add `last_working_date`. Expected: hold state is independent of history; the history just records the separation date. No auto-changes to the hold flag.

- [ ] **Step 5: Probation flow**

Add three events for the same employee, ascending dates:
1. `probation_start` 2024-01-01
2. `probation_extended` 2024-07-01
3. `confirmation` 2024-10-01

Expected: three separate rows in timeline, all visible, sorted DESC by effective_date.

- [ ] **Step 6: Revert a wrong entry**

Add any event, then click its trash icon. Confirm in dialog. Expected: row disappears from timeline. In DB:
```sql
SELECT record_id, is_deleted, deleted_at, deleted_by
FROM employee_record_history WHERE record_id = <id>;
```
Should return one row with `is_deleted = TRUE`. Re-querying the list endpoint should NOT return this row.

- [ ] **Step 7: Auto-log idempotency**

Edit an employee's department, save. Then immediately save again without changing anything. Expected: `findSameDayDuplicate` prevents a second `department_change` row from being inserted on the same date. Verify via:
```bash
curl -s "http://localhost:5000/api/employees/<id>/history?type=department_change"
```
Expected: only one row for today's date.

---

## Self-Review

**Spec coverage (against the original 6 STEP request):**

- **STEP 1 — Schema** → Task 1 reuses the existing `employee_record_history` table (per the chosen approach) and adds missing event types + soft-delete columns. ✓
- **STEP 2 — REST API (5 endpoints)** → Task 4 implements GET (list), GET (one), POST, PUT, DELETE under `/api/employees/:id/history`. ✓
- **STEP 3 — Service layer (CRUD, diff engine, pct, tenure)** → Task 3 has all of these. ✓
- **STEP 4 — Frontend component** → Task 7 covers timeline, filter chips, add/edit dynamic form, header card with stats, responsive CSS. ✓
- **STEP 5 — Integration** → Task 5 (auto-log hook), Task 8 (replace Delete button with View History), permission gate in Task 4 controller using existing `administration` permission + SuperAdmin. ✓
- **STEP 6 — Edge cases** → Task 9 manually verifies past dates, same-day duplicates, rehire, salary-slip independence, probation flow, soft-delete reversion, auto-log idempotency. ✓

**Placeholder scan:** No "TBD", "TODO", or "implement later". Every step has either complete code, an exact command, or a precise verification action.

**Type consistency:** All references match between tasks:
- Repository function names used by service: `listByEmployee`, `getById`, `insert`, `update`, `softDelete`, `findSameDayDuplicate` ✓
- Service function names used by controller: `listForEmployee`, `getOne`, `createEvent`, `updateEvent`, `deleteEvent`, `autoLogFromDiff` ✓
- API method names used by component: `list`, `getOne`, `create`, `update`, `remove` ✓
- Column names match SQL: `record_id`, `record_type`, `effective_date`, `old_*`/`new_*`, `is_deleted`, `approver_name`, `approver_designation`, `edited_at`, `edited_by` ✓

---

## Operating notes

- **Existing `viewEmployeeLogs` legacy code path** in Administration.jsx is unrelated (it queries `/administration/employee-logs/...` — those routes don't exist in the backend either; that's pre-existing tech debt). This plan does not touch that code. If you want to retire it, that's a separate cleanup.
- **Permission gating** reuses the existing `administration` permission key. If you later want a separate "history_admin" key, add it to `PERMISSION_LABELS` (frontend) and `validPermissionKeys` (backend) and adjust `isHrOrAdmin()` in the new controller.
- **`actorEmployeeId` for auto-log**: the existing `updateEmployee` body doesn't always carry the session user's employee id. The plan's hook checks `body.actorEmployeeId || body.createdBy || null`, so the row's `created_by` may be NULL for now. If you want to enforce it, pass `actorEmployeeId: req.session?.user?.id` from the Administration controller when calling `updateEmployee`.
- **Frontend `viewEmployeeLogs` button** in the existing modal header still exists for backwards compatibility — it points at the old `/employee-logs/...` route. You can remove that button in a follow-up once the new History modal is the canonical entry point.
