/**
 * Sync Legacy Employee History → employee_record_history (PostgreSQL)
 *
 * Reads from a legacy MS SQL Server (LEGACY_HR_*) and inserts a "smart diff"
 * timeline into the new portal's employee_record_history table.
 *
 * ============================================================================
 * BEFORE RUNNING — TWO STEPS:
 *
 * 1) Add these to your .env (legacy MS SQL):
 *    LEGACY_HR_HOST=192.168.21.33
 *    LEGACY_HR_PORT=1433
 *    LEGACY_HR_DB=YourOldHrDb
 *    LEGACY_HR_USER=hr_reader
 *    LEGACY_HR_PASS=...
 *
 * 2) Edit the LEGACY constants below (lines 30-55) to match your old DB
 *    table/column names. Defaults assume the sample data you shared.
 * ============================================================================
 *
 * Run:
 *    node scripts/sync_legacy_employee_history.js
 *    node scripts/sync_legacy_employee_history.js --dry-run    (print only, no inserts)
 *    node scripts/sync_legacy_employee_history.js --limit 50   (test on first 50 rows)
 */

import dotenv from 'dotenv'
import { executeQuery } from '../config/database.js'

dotenv.config()

// ====== EDIT THESE TO MATCH YOUR LEGACY DB ===================================
const LEGACY_TABLES = {
  history: 'HR_Emp_Sal_Update_Mstr',              // table holding history rows
  departments: 'HR_Department',          // lookup: Dept_ID → Dept_Name
  designations: 'HR_Designation',        // lookup: Dsg_ID → Dsg_Name
  grades: 'HR_Grade',                    // lookup: Grade_ID → Grade_Name
}

const LEGACY_COLUMNS = {
  history: {
    employeeCode:   'HR_Emp_ID',      // matches employees.employee_code in new system
    effectiveDate:  'Emp_Up_Date',
    lastSalary:     'Last_GrossSalary',
    newSalary:      'GrossSalary',
    deptId:         'Dept_ID',
    dsgId:          'Dsg_ID',
    gradeId:        'Grade_ID',
    remarks:        'Remarks',
  },
  departments:  { id: 'Dept_ID',  name: 'Dept_Descr' },
  designations: { id: 'DSG_ID',   name: 'DSG_Descr' },
  grades:       { id: 'Grade_ID', name: 'Grade_Descr' },
}
// =============================================================================

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const LIMIT_IDX = args.indexOf('--limit')
const LIMIT = LIMIT_IDX >= 0 ? parseInt(args[LIMIT_IDX + 1], 10) : null
const MIGRATION_MARKER = 'Migrated from legacy HR system'

let mssqlConn = null

async function connectLegacy() {
  const mssql = (await import('mssql')).default
  const host = (process.env.LEGACY_HR_HOST || '192.168.20.166').replace(/^['"]|['"]$/g, '').trim()
  const user = (process.env.LEGACY_HR_USER || 'tech').replace(/^['"]|['"]$/g, '').trim()
  const pass = (process.env.LEGACY_HR_PASS || 'tech').replace(/^['"]|['"]$/g, '').trim()
  const db   = (process.env.LEGACY_HR_DB   || 'ATS_HRMS').replace(/^['"]|['"]$/g, '').trim()
  const port = parseInt(process.env.LEGACY_HR_PORT || '1433', 10)
  if (!host || !user || !pass || !db) {
    throw new Error('Missing LEGACY_HR_* env vars (HOST, USER, PASS, DB)')
  }
  const pool = new mssql.ConnectionPool({
    server: host, port, user, password: pass, database: db,
    options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true, connectTimeout: 15000 },
    pool: { max: 5, idleTimeoutMillis: 30000 }
  })
  await pool.connect()
  console.log(`✅ Legacy MS SQL connected: ${host}/${db}`)
  return pool
}

async function loadLegacyLookup(pool, tableName, idCol, nameCol) {
  const r = await pool.request().query(`SELECT [${idCol}] AS id, [${nameCol}] AS name FROM [${tableName}]`)
  const map = new Map()
  for (const row of (r.recordset || [])) {
    if (row.id != null && row.name) map.set(Number(row.id), String(row.name).trim())
  }
  return map
}

async function loadNewLookup(table, idCol, nameCol) {
  const rows = await executeQuery(`SELECT ${idCol} AS id, ${nameCol} AS name FROM ${table}`)
  const map = new Map()
  for (const r of rows) {
    if (r.id != null && r.name) map.set(String(r.name).trim().toLowerCase(), Number(r.id))
  }
  return map
}

async function loadEmployeeCodeMap() {
  const rows = await executeQuery('SELECT employee_id, employee_code FROM employees WHERE employee_code IS NOT NULL')
  const map = new Map()
  for (const r of rows) {
    if (r.employee_code) map.set(String(r.employee_code).trim(), Number(r.employee_id))
  }
  return map
}

async function fetchLegacyHistory(pool) {
  const c = LEGACY_COLUMNS.history
  const sql = `
    SELECT
      [${c.employeeCode}]   AS employee_code,
      [${c.effectiveDate}]  AS effective_date,
      [${c.lastSalary}]     AS last_salary,
      [${c.newSalary}]      AS new_salary,
      [${c.deptId}]         AS dept_id,
      [${c.dsgId}]          AS dsg_id,
      [${c.gradeId}]        AS grade_id,
      [${c.remarks}]        AS remarks
    FROM [${LEGACY_TABLES.history}]
    ORDER BY [${c.employeeCode}], [${c.effectiveDate}]
  `
  const r = await pool.request().query(sql)
  return r.recordset || []
}

async function findExistingByMarker(employeeId, recordType, effectiveDateIso) {
  const rows = await executeQuery(
    `SELECT record_id FROM employee_record_history
     WHERE employee_id = $1 AND record_type = $2 AND effective_date = $3
       AND change_reason = $4 AND is_deleted = FALSE`,
    [employeeId, recordType, effectiveDateIso, MIGRATION_MARKER]
  )
  return rows[0]?.record_id || null
}

async function insertEvent(data) {
  if (DRY_RUN) return -1
  const cols = ['employee_id', 'record_type', 'effective_date', 'change_reason']
  const vals = [data.employeeId, data.recordType, data.effectiveDate, MIGRATION_MARKER]
  const placeholders = ['$1', '$2', '$3', '$4']
  let i = 5
  const add = (col, v) => {
    if (v === undefined || v === null || v === '') return
    cols.push(col); vals.push(v); placeholders.push(`$${i++}`)
  }
  add('old_gross_salary',   data.oldGrossSalary)
  add('new_gross_salary',   data.newGrossSalary)
  add('old_department_id',  data.oldDepartmentId)
  add('new_department_id',  data.newDepartmentId)
  add('old_designation_id', data.oldDesignationId)
  add('new_designation_id', data.newDesignationId)
  add('old_grade',          data.oldGrade)
  add('new_grade',          data.newGrade)
  add('change_amount',      data.changeAmount)
  add('change_percentage',  data.changePercentage)
  add('reference_no',       data.referenceNo)
  add('notes',              data.notes)
  const sql = `INSERT INTO employee_record_history (${cols.join(',')}) VALUES (${placeholders.join(',')}) RETURNING record_id`
  const rows = await executeQuery(sql, vals)
  return rows[0]?.record_id
}

function pctChange(oldVal, newVal) {
  const o = Number(oldVal), n = Number(newVal)
  if (!isFinite(o) || !isFinite(n) || o === 0) return null
  return Math.round(((n - o) / o) * 10000) / 100
}

function toIso(date) {
  if (!date) return null
  const d = (date instanceof Date) ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

async function main() {
  console.log(`\n${'='.repeat(70)}`)
  console.log(`Legacy Employee History → employee_record_history sync`)
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN (no DB writes)' : 'LIVE'}${LIMIT ? `, limit ${LIMIT} rows` : ''}`)
  console.log('='.repeat(70))

  mssqlConn = await connectLegacy()

  // 1) Load legacy lookups (id → name)
  console.log('\n→ Loading legacy lookups...')
  const legacyDept = await loadLegacyLookup(mssqlConn, LEGACY_TABLES.departments,
    LEGACY_COLUMNS.departments.id, LEGACY_COLUMNS.departments.name)
  const legacyDsg = await loadLegacyLookup(mssqlConn, LEGACY_TABLES.designations,
    LEGACY_COLUMNS.designations.id, LEGACY_COLUMNS.designations.name)
  const legacyGrade = await loadLegacyLookup(mssqlConn, LEGACY_TABLES.grades,
    LEGACY_COLUMNS.grades.id, LEGACY_COLUMNS.grades.name)
  console.log(`  legacy departments: ${legacyDept.size}, designations: ${legacyDsg.size}, grades: ${legacyGrade.size}`)

  // 2) Load new system lookups (name → id)
  console.log('\n→ Loading new system lookups...')
  const newDept = await loadNewLookup('departments', 'department_id', 'department_name')
  const newDsg = await loadNewLookup('designation', 'desg_id', 'desg_name')
  console.log(`  new departments: ${newDept.size}, designations: ${newDsg.size}`)

  // 3) Load employee_code → employee_id
  console.log('\n→ Loading employee map...')
  const empMap = await loadEmployeeCodeMap()
  console.log(`  employees with code: ${empMap.size}`)

  // 4) Build legacy_id → new_id maps via name matching (lowercased)
  const deptIdMap = new Map()  // legacy Dept_ID (int) → new department_id
  for (const [legId, name] of legacyDept) {
    const newId = newDept.get(name.trim().toLowerCase())
    if (newId) deptIdMap.set(legId, newId)
  }
  const dsgIdMap = new Map()
  for (const [legId, name] of legacyDsg) {
    const newId = newDsg.get(name.trim().toLowerCase())
    if (newId) dsgIdMap.set(legId, newId)
  }
  console.log(`  resolved Dept legacy→new: ${deptIdMap.size}/${legacyDept.size}`)
  console.log(`  resolved Dsg  legacy→new: ${dsgIdMap.size}/${legacyDsg.size}`)
  const unresolvedDept = [...legacyDept.entries()].filter(([id]) => !deptIdMap.has(id))
  const unresolvedDsg = [...legacyDsg.entries()].filter(([id]) => !dsgIdMap.has(id))
  if (unresolvedDept.length) console.warn(`  ⚠️  unresolved departments (no name match):`, unresolvedDept.slice(0, 10).map(([id, n]) => `${id}=${n}`).join(', '), unresolvedDept.length > 10 ? `… +${unresolvedDept.length - 10} more` : '')
  if (unresolvedDsg.length) console.warn(`  ⚠️  unresolved designations:`, unresolvedDsg.slice(0, 10).map(([id, n]) => `${id}=${n}`).join(', '), unresolvedDsg.length > 10 ? `… +${unresolvedDsg.length - 10} more` : '')

  // 5) Fetch legacy history sorted by employee + date
  console.log('\n→ Fetching legacy history rows...')
  let legacyRows = await fetchLegacyHistory(mssqlConn)
  if (LIMIT) legacyRows = legacyRows.slice(0, LIMIT)
  console.log(`  total rows: ${legacyRows.length}`)

  // 6) Walk per-employee, emit diff events
  console.log('\n→ Diffing & inserting...')
  let totalInserted = 0
  let totalSkipped = 0
  let totalDupes = 0
  let totalEmpMissing = 0
  let lastEmpCode = null
  let prev = null  // previous row for the current employee

  for (const r of legacyRows) {
    const empCode = String(r.employee_code ?? '').trim()
    if (!empCode) { totalSkipped++; continue }
    const employeeId = empMap.get(empCode)
    if (!employeeId) {
      totalEmpMissing++
      if (totalEmpMissing <= 5) console.warn(`  ⚠️  employee_code ${empCode} not found in new system`)
      continue
    }
    const effDate = toIso(r.effective_date)
    if (!effDate) { totalSkipped++; continue }

    const curDeptId = r.dept_id != null ? Number(r.dept_id) : null
    const curDsgId  = r.dsg_id  != null ? Number(r.dsg_id)  : null
    const curGradeId = r.grade_id != null ? Number(r.grade_id) : null
    const curSalary = r.new_salary != null ? Number(r.new_salary) : null

    // Reset prev when employee changes
    if (empCode !== lastEmpCode) { prev = null; lastEmpCode = empCode }

    // For the very first row of an employee — baseline "other" snapshot (no prior state)
    if (!prev) {
      const newDeptResolved = curDeptId != null ? (deptIdMap.get(curDeptId) || null) : null
      const newDsgResolved  = curDsgId != null ? (dsgIdMap.get(curDsgId) || null) : null
      const gradeName = curGradeId != null ? (legacyGrade.get(curGradeId) || null) : null

      const dup = await findExistingByMarker(employeeId, 'other', effDate)
      if (dup) { totalDupes++ }
      else {
        await insertEvent({
          employeeId, recordType: 'other', effectiveDate: effDate,
          newDepartmentId: newDeptResolved, newDesignationId: newDsgResolved,
          newGrade: gradeName, newGrossSalary: curSalary,
          notes: r.remarks || null,
        })
        totalInserted++
      }
      prev = { deptId: curDeptId, dsgId: curDsgId, gradeId: curGradeId, salary: curSalary }
      continue
    }

    // Diff vs previous row — emit one event per changed dimension
    const events = []
    if (prev.salary !== curSalary && curSalary != null) {
      events.push({
        recordType: 'salary_change',
        oldGrossSalary: prev.salary ?? null,
        newGrossSalary: curSalary,
        changeAmount: prev.salary != null ? curSalary - prev.salary : null,
        changePercentage: pctChange(prev.salary, curSalary),
      })
    }
    if (prev.deptId !== curDeptId && curDeptId != null) {
      events.push({
        recordType: 'department_change',
        oldDepartmentId: prev.deptId != null ? (deptIdMap.get(prev.deptId) || null) : null,
        newDepartmentId: deptIdMap.get(curDeptId) || null,
      })
    }
    if (prev.dsgId !== curDsgId && curDsgId != null) {
      events.push({
        recordType: 'designation_change',
        oldDesignationId: prev.dsgId != null ? (dsgIdMap.get(prev.dsgId) || null) : null,
        newDesignationId: dsgIdMap.get(curDsgId) || null,
      })
    }
    if (prev.gradeId !== curGradeId && curGradeId != null) {
      events.push({
        recordType: 'grade_change',
        oldGrade: prev.gradeId != null ? (legacyGrade.get(prev.gradeId) || null) : null,
        newGrade: legacyGrade.get(curGradeId) || null,
      })
    }

    for (const ev of events) {
      const dup = await findExistingByMarker(employeeId, ev.recordType, effDate)
      if (dup) { totalDupes++; continue }
      await insertEvent({
        employeeId, effectiveDate: effDate, notes: r.remarks || null, ...ev
      })
      totalInserted++
    }

    prev = { deptId: curDeptId, dsgId: curDsgId, gradeId: curGradeId, salary: curSalary }
  }

  console.log(`\n${'='.repeat(70)}`)
  console.log(`Summary:`)
  console.log(`  ✅ Inserted: ${totalInserted}`)
  console.log(`  ↩ Skipped duplicates (already migrated): ${totalDupes}`)
  console.log(`  ⚠ Skipped (missing employee_code in new DB): ${totalEmpMissing}`)
  console.log(`  ⚠ Skipped (invalid row): ${totalSkipped}`)
  console.log('='.repeat(70))
}

main()
  .catch((err) => { console.error('\n❌ Sync failed:', err); process.exit(1) })
  .finally(async () => {
    if (mssqlConn) try { await mssqlConn.close() } catch (_) {}
    process.exit(0)
  })
