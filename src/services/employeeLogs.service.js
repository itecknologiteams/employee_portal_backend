import * as logRepo from '../repositories/employeeLogs.repository.js'

/**
 * Valid change types for employee update logs
 */
const VALID_CHANGE_TYPES = [
  'salary_increment',
  'department_transfer',
  'designation_change',
  'general_info'
]

/**
 * Add a new employee update log entry
 * @param {Object} data - Log entry data
 * @param {number} data.employeeId - Employee ID
 * @param {string} data.changeType - Type of change
 * @param {string} [data.fieldChanged] - Field name
 * @param {string} [data.oldValue] - Previous value
 * @param {string} [data.newValue] - New value
 * @param {string} [data.remarks] - Remarks
 * @param {string} [data.effectiveDate] - Effective date (YYYY-MM-DD)
 * @param {number} [data.updatedBy] - Admin employee ID who made the change
 * @returns {Promise<Object>} Created log entry
 */
export async function addLog(data) {
  const {
    employeeId,
    changeType,
    fieldChanged,
    oldValue,
    newValue,
    remarks,
    effectiveDate,
    updatedBy
  } = data

  // Validation
  if (!employeeId || isNaN(parseInt(employeeId, 10))) {
    const err = new Error('Employee ID is required and must be a valid number')
    err.status = 400
    throw err
  }

  if (!changeType || !VALID_CHANGE_TYPES.includes(changeType)) {
    const err = new Error(`Change type must be one of: ${VALID_CHANGE_TYPES.join(', ')}`)
    err.status = 400
    throw err
  }

  // For salary_increment, effective_date is required
  if (changeType === 'salary_increment' && !effectiveDate) {
    const err = new Error('Effective date is required for salary increments')
    err.status = 400
    throw err
  }

  // Format values for storage (convert objects/arrays to JSON strings)
  const formatValue = (val) => {
    if (val === null || val === undefined) return null
    if (typeof val === 'object') return JSON.stringify(val)
    return String(val)
  }

  return await logRepo.insertLog({
    employeeId: parseInt(employeeId, 10),
    changeType,
    fieldChanged: fieldChanged || null,
    oldValue: formatValue(oldValue),
    newValue: formatValue(newValue),
    remarks: remarks || null,
    effectiveDate: effectiveDate || null,
    updatedBy: updatedBy ? parseInt(updatedBy, 10) : null
  })
}

/**
 * Get update logs for a specific employee
 * @param {number} employeeId - Employee ID
 * @param {Object} options - Query options
 * @param {string} [options.changeType] - Filter by change type
 * @param {string} [options.startDate] - Start date filter
 * @param {string} [options.endDate] - End date filter
 * @param {number} [options.page=1] - Page number
 * @param {number} [options.limit=20] - Items per page
 * @returns {Promise<Object>} { logs: Array, total: number, page: number, limit: number }
 */
export async function getEmployeeLogs(employeeId, options = {}) {
  if (!employeeId || isNaN(parseInt(employeeId, 10))) {
    const err = new Error('Employee ID is required')
    err.status = 400
    throw err
  }

  return await logRepo.getLogsForEmployee(parseInt(employeeId, 10), {
    changeType: options.changeType,
    startDate: options.startDate,
    endDate: options.endDate,
    page: parseInt(options.page, 10) || 1,
    limit: Math.min(parseInt(options.limit, 10) || 20, 100)
  })
}

/**
 * Get all update logs across employees (admin overview)
 * @param {Object} options - Query options
 * @param {number} [options.employeeId] - Filter by specific employee
 * @param {string} [options.changeType] - Filter by change type
 * @param {string} [options.search] - Search by employee name
 * @param {string} [options.startDate] - Start date filter
 * @param {string} [options.endDate] - End date filter
 * @param {number} [options.page=1] - Page number
 * @param {number} [options.limit=20] - Items per page
 * @returns {Promise<Object>} { logs: Array, total: number, page: number, limit: number }
 */
export async function getAllEmployeeLogs(options = {}) {
  return await logRepo.getAllLogs({
    employeeId: options.employeeId ? parseInt(options.employeeId, 10) : null,
    changeType: options.changeType,
    search: options.search,
    startDate: options.startDate,
    endDate: options.endDate,
    page: parseInt(options.page, 10) || 1,
    limit: Math.min(parseInt(options.limit, 10) || 20, 100)
  })
}

/**
 * Auto-detect and log department changes when updating employee
 * This should be called from administration.service.js before saving employee changes
 * @param {number} employeeId - Employee ID being updated
 * @param {Array<number>} newDepartmentIds - New department IDs array
 * @param {number} updatedBy - Admin employee ID making the change
 * @returns {Promise<void>}
 */
export async function logDepartmentChangeIfNeeded(employeeId, newDepartmentIds, updatedBy) {
  // Get current department memberships
  const currentDeptIds = await logRepo.getCurrentDepartmentIds(employeeId)

  // Sort both arrays for comparison
  const sortedCurrent = [...currentDeptIds].sort((a, b) => a - b)
  const sortedNew = [...(newDepartmentIds || [])].sort((a, b) => a - b)

  // Check if different
  const isDifferent = sortedCurrent.length !== sortedNew.length ||
    sortedCurrent.some((id, idx) => id !== sortedNew[idx])

  if (!isDifferent) return

  // Get department names for better logging
  const [oldDepts, newDepts] = await Promise.all([
    logRepo.getDepartmentNames(sortedCurrent),
    logRepo.getDepartmentNames(sortedNew)
  ])

  const oldNames = oldDepts.map(d => d.name).join(', ') || 'None'
  const newNames = newDepts.map(d => d.name).join(', ') || 'None'

  await addLog({
    employeeId,
    changeType: 'department_transfer',
    fieldChanged: 'department_ids',
    oldValue: oldNames,
    newValue: newNames,
    remarks: `Department transfer: ${oldNames} → ${newNames}`,
    updatedBy
  })
}

/**
 * Auto-detect and log designation changes when updating employee
 * @param {number} employeeId - Employee ID being updated
 * @param {number|null} newDesignationId - New designation ID
 * @param {number} updatedBy - Admin employee ID making the change
 * @returns {Promise<void>}
 */
export async function logDesignationChangeIfNeeded(employeeId, newDesignationId, updatedBy) {
  // Get current designation
  const current = await logRepo.getCurrentDesignation(employeeId)
  const currentId = current?.designationId || null

  // Normalize for comparison (handle null/undefined/empty)
  const normalizedCurrent = currentId ? parseInt(currentId, 10) : null
  const normalizedNew = newDesignationId ? parseInt(newDesignationId, 10) : null

  if (normalizedCurrent === normalizedNew) return

  const oldName = current?.designationName || 'None'

  // Get new designation name if we have the ID
  let newName = 'None'
  if (normalizedNew) {
    newName = await logRepo.getDesignationName(normalizedNew) || 'Unknown'
  }

  await addLog({
    employeeId,
    changeType: 'designation_change',
    fieldChanged: 'designation_id',
    oldValue: oldName,
    newValue: newName,
    remarks: `Designation change: ${oldName} → ${newName}`,
    updatedBy
  })
}

/**
 * Log a salary increment
 * @param {Object} data - Salary increment data
 * @param {number} data.employeeId - Employee ID
 * @param {number} data.oldGrossSalary - Previous gross salary
 * @param {number} data.newGrossSalary - New gross salary
 * @param {number} data.incrementAmount - Increment amount
 * @param {string} data.effectiveDate - Effective date (YYYY-MM-DD)
 * @param {string} [data.remarks] - Additional remarks
 * @param {number} data.updatedBy - Admin employee ID
 * @returns {Promise<Object>} Created log entry
 */
export async function logSalaryIncrement(data) {
  const {
    employeeId,
    oldGrossSalary,
    newGrossSalary,
    incrementAmount,
    effectiveDate,
    remarks,
    updatedBy
  } = data

  if (!employeeId || !effectiveDate || !updatedBy) {
    const err = new Error('Employee ID, effective date, and updated by are required')
    err.status = 400
    throw err
  }

  return await addLog({
    employeeId,
    changeType: 'salary_increment',
    fieldChanged: 'gross_salary',
    oldValue: `PKR ${Number(oldGrossSalary || 0).toLocaleString()}`,
    newValue: `PKR ${Number(newGrossSalary || 0).toLocaleString()}`,
    remarks: remarks || `Salary increment: PKR ${Number(incrementAmount || 0).toLocaleString()} (Effective: ${effectiveDate})`,
    effectiveDate,
    updatedBy
  })
}
