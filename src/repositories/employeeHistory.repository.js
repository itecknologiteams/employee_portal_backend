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
