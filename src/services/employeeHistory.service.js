import * as historyRepo from '../repositories/employeeHistory.repository.js'

const VALID_TYPES = new Set([
  'salary_change','department_change','designation_change','employee_type_change',
  'confirmation','probation_start','probation_extended',
  'joining','last_working_date','rehire','location_change','grade_change','other'
])

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

/** Parse a gross value that may arrive as a number or a "1,234.50" string. Null if empty/invalid. */
function parseGross(v) {
  if (v == null || v === '') return null
  const n = Number(String(v).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : NaN // NaN signals an invalid (non-numeric) value
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Bulk import appraisal / confirmation events from an uploaded sheet.
 * Each row → 1–2 history events:
 *   - Appraisal           → one salary_change (needs Old + New gross)
 *   - Confirmation        → one confirmation; if Old+New gross given and differ, also a salary_change
 *
 * @param {Array} rows  Normalized rows: { employeeCode, type, effectiveDate, oldGross, newGross, notes }
 * @param {Object} opts { mode: 'validate'|'commit', createdBy }
 * Returns { mode, summary, results } — never throws on per-row issues (they are reported).
 */
export async function bulkImportHistory(rows, { mode = 'validate', createdBy = null } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { error: 'No rows to import. Upload a sheet with at least one row.', status: 400 }
  }
  if (rows.length > 1000) {
    return { error: 'Too many rows (max 1000 per upload). Split the sheet.', status: 400 }
  }
  const commit = mode === 'commit'

  const codeMap = await historyRepo.resolveEmployeesByCodes(rows.map((r) => r?.employeeCode))

  const results = []
  let toCreate = 0, duplicates = 0, errors = 0, eventsCreated = 0

  for (let idx = 0; idx < rows.length; idx++) {
    const raw = rows[idx] || {}
    const rowNumber = idx + 1
    const code = String(raw.employeeCode ?? '').trim()
    const typeNorm = String(raw.type ?? '').trim().toLowerCase()
    const effectiveDate = String(raw.effectiveDate ?? '').trim()
    const notes = raw.notes != null && String(raw.notes).trim() !== '' ? String(raw.notes).trim() : null
    const oldGross = parseGross(raw.oldGross)
    const newGross = parseGross(raw.newGross)

    const fail = (message) => {
      errors++
      results.push({ rowNumber, employeeCode: code, name: null, type: raw.type ?? '', status: 'error', message, events: [] })
    }

    if (!code) { fail('Employee_Code is required'); continue }
    const emp = codeMap.get(code)
    if (!emp) { fail(`Unknown employee code: ${code}`); continue }
    if (!['appraisal', 'confirmation'].includes(typeNorm)) { fail(`Type must be "Appraisal" or "Confirmation" (got "${raw.type ?? ''}")`); continue }
    if (!ISO_DATE.test(effectiveDate) || Number.isNaN(new Date(effectiveDate).getTime())) {
      fail('Effective_Date must be a valid date (YYYY-MM-DD)'); continue
    }
    if (Number.isNaN(oldGross) || Number.isNaN(newGross)) { fail('Old_Gross / New_Gross must be numbers'); continue }

    // Build the planned event list for this row.
    const planned = []
    if (typeNorm === 'appraisal') {
      if (oldGross == null || newGross == null) { fail('Appraisal needs both Old_Gross and New_Gross'); continue }
      if (oldGross === newGross) { fail('Appraisal Old_Gross and New_Gross are equal — no change'); continue }
      planned.push({ recordType: 'salary_change', oldGrossSalary: oldGross, newGrossSalary: newGross })
    } else {
      planned.push({ recordType: 'confirmation' })
      if (oldGross != null && newGross != null && oldGross !== newGross) {
        planned.push({ recordType: 'salary_change', oldGrossSalary: oldGross, newGrossSalary: newGross })
      }
    }

    // Resolve each planned event to create/skip(duplicate), and insert on commit.
    const eventsOut = []
    let rowHasCreate = false
    for (const ev of planned) {
      const dup = await historyRepo.findSameDayDuplicate(emp.employeeId, ev.recordType, effectiveDate)
      if (dup) {
        duplicates++
        eventsOut.push({ recordType: ev.recordType, status: 'skip', reason: 'duplicate (same type + date exists)' })
        continue
      }
      rowHasCreate = true
      if (commit) {
        const payload = { employeeId: emp.employeeId, recordType: ev.recordType, effectiveDate, notes, createdBy }
        if (ev.recordType === 'salary_change') {
          payload.oldGrossSalary = ev.oldGrossSalary
          payload.newGrossSalary = ev.newGrossSalary
          payload.changeAmount = ev.newGrossSalary - ev.oldGrossSalary
          payload.changePercentage = pctChange(ev.oldGrossSalary, ev.newGrossSalary)
        }
        try {
          const recordId = await historyRepo.insert(payload)
          eventsCreated++
          eventsOut.push({ recordType: ev.recordType, status: 'created', recordId })
        } catch (e) {
          eventsOut.push({ recordType: ev.recordType, status: 'error', reason: e.message })
        }
      } else {
        eventsOut.push({ recordType: ev.recordType, status: 'create' })
      }
    }

    const status = rowHasCreate ? 'create' : 'skip'
    if (rowHasCreate) toCreate++
    results.push({
      rowNumber, employeeCode: code, name: emp.name, type: raw.type ?? '',
      status, message: rowHasCreate ? '' : 'All events already exist (duplicate)', events: eventsOut
    })
  }

  return {
    mode,
    summary: { rows: rows.length, toCreate, duplicates, errors, eventsCreated },
    results
  }
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
