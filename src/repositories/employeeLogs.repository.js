import { executeQuery } from '../../config/database.js'

/**
 * Insert a new employee update log entry
 * @param {Object} data - Log entry data
 * @param {number} data.employeeId - Employee ID
 * @param {string} data.changeType - Type of change (salary_increment, department_transfer, designation_change, general_info)
 * @param {string} [data.fieldChanged] - Field name that was changed
 * @param {string} [data.oldValue] - Previous value
 * @param {string} [data.newValue] - New value
 * @param {string} [data.remarks] - Additional remarks
 * @param {string} [data.effectiveDate] - When change takes effect (YYYY-MM-DD)
 * @param {number} [data.updatedBy] - Employee ID of admin who made the change
 * @returns {Promise<Object>} Inserted log entry
 */
export async function insertLog(data) {
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

  const rows = await executeQuery(
    `INSERT INTO employee_update_logs 
     (employee_id, change_type, field_changed, old_value, new_value, remarks, effective_date, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [employeeId, changeType, fieldChanged || null, oldValue || null, newValue || null, remarks || null, effectiveDate || null, updatedBy || null]
  )
  return rows[0]
}

/**
 * Get update logs for a specific employee with optional filtering and pagination
 * @param {number} employeeId - Employee ID
 * @param {Object} [filters] - Filter options
 * @param {string} [filters.changeType] - Filter by change type
 * @param {string} [filters.startDate] - Start date for created_at range
 * @param {string} [filters.endDate] - End date for created_at range
 * @param {number} [filters.page=1] - Page number
 * @param {number} [filters.limit=20] - Items per page
 * @returns {Promise<Object>} { logs: Array, total: number, page: number, limit: number }
 */
export async function getLogsForEmployee(employeeId, filters = {}) {
  const {
    changeType,
    startDate,
    endDate,
    page = 1,
    limit = 20
  } = filters

  const offset = (page - 1) * limit
  const params = [employeeId]
  let paramIndex = 2

  let whereClause = 'WHERE l.employee_id = $1'

  if (changeType) {
    whereClause += ` AND l.change_type = $${paramIndex++}`
    params.push(changeType)
  }

  if (startDate) {
    whereClause += ` AND l.created_at >= $${paramIndex++}`
    params.push(`${startDate}T00:00:00Z`)
  }

  if (endDate) {
    whereClause += ` AND l.created_at <= $${paramIndex++}`
    params.push(`${endDate}T23:59:59Z`)
  }

  // Get total count
  const countResult = await executeQuery(
    `SELECT COUNT(*) as total FROM employee_update_logs l ${whereClause}`,
    params.slice(0, paramIndex - 1)
  )
  const total = parseInt(countResult[0].total, 10)

  // Get logs with employee names for updated_by
  const logs = await executeQuery(
    `SELECT l.*,
            e.first_name || ' ' || e.last_name as employee_name,
            u.first_name || ' ' || u.last_name as updated_by_name
     FROM employee_update_logs l
     JOIN employees e ON e.employee_id = l.employee_id
     LEFT JOIN employees u ON u.employee_id = l.updated_by
     ${whereClause}
     ORDER BY l.created_at DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
    [...params.slice(0, paramIndex - 1), limit, offset]
  )

  return { logs, total, page, limit }
}

/**
 * Get all update logs across employees with optional filtering and pagination
 * @param {Object} [filters] - Filter options
 * @param {number} [filters.employeeId] - Filter by specific employee
 * @param {string} [filters.changeType] - Filter by change type
 * @param {string} [filters.search] - Search by employee name
 * @param {string} [filters.startDate] - Start date for created_at range
 * @param {string} [filters.endDate] - End date for created_at range
 * @param {number} [filters.page=1] - Page number
 * @param {number} [filters.limit=20] - Items per page
 * @returns {Promise<Object>} { logs: Array, total: number, page: number, limit: number }
 */
export async function getAllLogs(filters = {}) {
  const {
    employeeId,
    changeType,
    search,
    startDate,
    endDate,
    page = 1,
    limit = 20
  } = filters

  const offset = (page - 1) * limit
  const params = []
  let paramIndex = 1
  const conditions = []

  if (employeeId) {
    conditions.push(`l.employee_id = $${paramIndex++}`)
    params.push(employeeId)
  }

  if (changeType) {
    conditions.push(`l.change_type = $${paramIndex++}`)
    params.push(changeType)
  }

  if (search) {
    conditions.push(`(e.first_name ILIKE $${paramIndex} OR e.last_name ILIKE $${paramIndex} OR e.employee_code ILIKE $${paramIndex})`)
    params.push(`%${search}%`)
    paramIndex++
  }

  if (startDate) {
    conditions.push(`l.created_at >= $${paramIndex++}`)
    params.push(`${startDate}T00:00:00Z`)
  }

  if (endDate) {
    conditions.push(`l.created_at <= $${paramIndex++}`)
    params.push(`${endDate}T23:59:59Z`)
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  // Debug logging
  console.log('Search params:', { employeeId, changeType, search, startDate, endDate, page, limit })
  console.log('SQL conditions:', conditions)
  console.log('SQL params:', params)

  // Get total count
  const countQuery = `SELECT COUNT(*) as total 
                      FROM employee_update_logs l
                      JOIN employees e ON e.employee_id = l.employee_id
                      ${whereClause}`
  console.log('Count query:', countQuery)
  const countResult = await executeQuery(countQuery, params)
  const total = parseInt(countResult[0].total, 10)

  // Get logs
  const logsQuery = `SELECT l.*,
                            e.first_name || ' ' || e.last_name as employee_name,
                            e.employee_code,
                            u.first_name || ' ' || u.last_name as updated_by_name
                     FROM employee_update_logs l
                     JOIN employees e ON e.employee_id = l.employee_id
                     LEFT JOIN employees u ON u.employee_id = l.updated_by
                     ${whereClause}
                     ORDER BY l.created_at DESC
                     LIMIT $${paramIndex++} OFFSET $${paramIndex++}`
  console.log('Logs query:', logsQuery)
  const logs = await executeQuery(logsQuery, [...params, limit, offset])

  return { logs, total, page, limit }
}

/**
 * Get current employee department memberships
 * @param {number} employeeId - Employee ID
 * @returns {Promise<Array>} Array of department IDs
 */
export async function getCurrentDepartmentIds(employeeId) {
  try {
    const rows = await executeQuery(
      `SELECT department_id FROM employee_department_memberships WHERE employee_id = $1`,
      [employeeId]
    )
    return rows.map(r => r.department_id).sort((a, b) => a - b)
  } catch (e) {
    // Table might not exist yet, fall back to legacy
    if (e.code === '42P01') {
      const emp = await executeQuery(
        `SELECT department_id FROM employees WHERE employee_id = $1`,
        [employeeId]
      )
      return emp[0]?.department_id ? [emp[0].department_id] : []
    }
    throw e
  }
}

/**
 * Get current employee designation
 * @param {number} employeeId - Employee ID
 * @returns {Promise<Object>} { designationId, designationName }
 */
export async function getCurrentDesignation(employeeId) {
  const rows = await executeQuery(
    `SELECT e.designation_id, d.desg_name as designation_name
     FROM employees e
     LEFT JOIN designation d ON d.desg_id = e.designation_id
     WHERE e.employee_id = $1`,
    [employeeId]
  )
  return rows[0] || { designationId: null, designationName: null }
}

/**
 * Get department names by IDs
 * @param {Array<number>} departmentIds - Array of department IDs
 * @returns {Promise<Array>} Array of { id, name } objects
 */
export async function getDepartmentNames(departmentIds) {
  if (!departmentIds || departmentIds.length === 0) return []
  const rows = await executeQuery(
    `SELECT department_id as id, department_name as name 
     FROM departments 
     WHERE department_id = ANY($1)`,
    [departmentIds]
  )
  return rows
}

/**
 * Get designation name by ID
 * @param {number} designationId - Designation ID
 * @returns {Promise<string|null>} Designation name or null
 */
export async function getDesignationName(designationId) {
  if (!designationId) return null
  const rows = await executeQuery(
    `SELECT desg_name FROM designation WHERE desg_id = $1`,
    [designationId]
  )
  return rows[0]?.desg_name || null
}
