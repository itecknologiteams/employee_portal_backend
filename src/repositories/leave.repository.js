import { executeQuery } from '../../config/database.js'

export async function getLeaveBalance(employeeId) {
  return executeQuery(
    'SELECT lb.annual_leave, lb.sick_leave, lb.personal_leave FROM leave_balance lb WHERE lb.employee_id = $1',
    [employeeId]
  )
}

export async function getLeaveRequests(employeeId) {
  return executeQuery(
    `SELECT lr.leave_request_id, lr.leave_type, lr.start_date, lr.end_date,
        (lr.end_date - lr.start_date + 1) as days, lr.status, lr.reason, lr.created_at
     FROM leave_requests lr WHERE lr.employee_id = $1 ORDER BY lr.created_at DESC`,
    [employeeId]
  )
}

export async function createLeaveRequest(employeeId, leaveType, startDate, endDate, reason, initialStatus = 'Pending') {
  return executeQuery(
    `INSERT INTO leave_requests (employee_id, leave_type, start_date, end_date, reason, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
     RETURNING leave_request_id`,
    [employeeId, leaveType, startDate, endDate, reason, initialStatus]
  )
}

/** Get single leave request by id (for status update). */
export async function getLeaveRequestById(leaveRequestId) {
  const rows = await executeQuery(
    `SELECT lr.leave_request_id, lr.employee_id, lr.leave_type, lr.start_date, lr.end_date,
        (lr.end_date - lr.start_date + 1) AS days, lr.status, lr.reason, lr.created_at,
        e.department_id
     FROM leave_requests lr
     JOIN employees e ON lr.employee_id = e.employee_id
     WHERE lr.leave_request_id = $1`,
    [leaveRequestId]
  )
  return rows[0]
}

/** Update leave request status only when current status matches (for HOD then HR two-step flow). */
export async function updateLeaveRequestStatus(leaveRequestId, newStatus, requiredCurrentStatus) {
  return executeQuery(
    `UPDATE leave_requests SET status = $1 WHERE leave_request_id = $2 AND status = $3 RETURNING leave_request_id, status`,
    [newStatus, leaveRequestId, requiredCurrentStatus]
  )
}

/** Leave requests pending HR approval (status = 'Pending HR'). */
export async function getPendingHrLeaves() {
  return executeQuery(
    `SELECT lr.leave_request_id, lr.employee_id, lr.leave_type, lr.start_date, lr.end_date,
        (lr.end_date - lr.start_date + 1) AS days, lr.status, lr.reason, lr.created_at,
        e.first_name, e.last_name, e.email, d.department_name
     FROM leave_requests lr
     JOIN employees e ON lr.employee_id = e.employee_id
     LEFT JOIN departments d ON e.department_id = d.department_id
     WHERE lr.status = 'Pending HR'
     ORDER BY lr.created_at ASC`,
    []
  )
}

/** Total count of all leave requests (for HR list pagination). */
export async function countAllLeavesForHr() {
  const rows = await executeQuery('SELECT COUNT(*)::int AS total FROM leave_requests', [])
  return rows[0]?.total ?? 0
}

/** All leave requests for HR list with pagination: every department, with applicant and department and status. */
export async function getAllLeavesForHr(limit, offset) {
  return executeQuery(
    `SELECT lr.leave_request_id, lr.employee_id, lr.leave_type, lr.start_date, lr.end_date,
        (lr.end_date - lr.start_date + 1) AS days, lr.status, lr.reason, lr.created_at,
        e.first_name, e.last_name, e.email, d.department_name
     FROM leave_requests lr
     JOIN employees e ON lr.employee_id = e.employee_id
     LEFT JOIN departments d ON e.department_id = d.department_id
     ORDER BY lr.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  )
}

/** Leave requests pending HOD approval: same department as HOD, status 'Pending', exclude HOD's own. */
export async function getPendingHodLeaves(deptId, deptName, excludeEmployeeId) {
  return executeQuery(
    `SELECT lr.leave_request_id, lr.employee_id, lr.leave_type, lr.start_date, lr.end_date,
        (lr.end_date - lr.start_date + 1) AS days, lr.status, lr.reason, lr.created_at,
        e.first_name, e.last_name, e.email, d.department_name
     FROM leave_requests lr
     JOIN employees e ON lr.employee_id = e.employee_id
     LEFT JOIN departments d ON e.department_id = d.department_id
     WHERE lr.status = 'Pending'
       AND lr.employee_id != $3
       AND (e.department_id = $1 OR (LOWER(TRIM(COALESCE(d.department_name, ''))) = $2 AND $2 != ''))
     ORDER BY lr.created_at ASC`,
    [deptId, deptName, excludeEmployeeId]
  )
}
