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
