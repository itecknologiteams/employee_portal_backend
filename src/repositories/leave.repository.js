import { executeQuery } from '../../config/database.js'

/** Default entitlements when inserting a new balance row. */
export const DEFAULT_ANNUAL = 14
export const DEFAULT_CASUAL = 10
export const DEFAULT_SICK = 6

export async function ensureLeaveBalanceRow(employeeId) {
  await executeQuery(
    `INSERT INTO leave_balance (employee_id, annual_leave, casual_leave, sick_leave, personal_leave)
     VALUES ($1, $2, $3, $4, 0)
     ON CONFLICT (employee_id) DO NOTHING`,
    [employeeId, DEFAULT_ANNUAL, DEFAULT_CASUAL, DEFAULT_SICK]
  )
}

export async function getLeaveBalance(employeeId) {
  await ensureLeaveBalanceRow(employeeId)
  return executeQuery(
    `SELECT lb.annual_leave, COALESCE(lb.casual_leave, 10) AS casual_leave, lb.sick_leave, lb.personal_leave
     FROM leave_balance lb WHERE lb.employee_id = $1`,
    [employeeId]
  )
}

/** Deduct annual days if balance sufficient. Returns updated row or []. */
export async function deductAnnualLeave(employeeId, days) {
  const d = Math.max(0, Math.floor(Number(days) || 0))
  if (d === 0) return []
  await ensureLeaveBalanceRow(employeeId)
  return executeQuery(
    `UPDATE leave_balance SET annual_leave = annual_leave - $2, updated_at = CURRENT_TIMESTAMP
     WHERE employee_id = $1 AND annual_leave >= $2
     RETURNING annual_leave, casual_leave, sick_leave`,
    [employeeId, d]
  )
}

/** Add back annual days (rollback). */
export async function refundAnnualLeave(employeeId, days) {
  const d = Math.max(0, Math.floor(Number(days) || 0))
  if (d === 0) return []
  return executeQuery(
    `UPDATE leave_balance SET annual_leave = annual_leave + $2, updated_at = CURRENT_TIMESTAMP
     WHERE employee_id = $1 RETURNING annual_leave`,
    [employeeId, d]
  )
}

/** HR: set full annual / casual / sick totals (non-negative integers). personal_leave stays 0. */
export async function setLeaveBalanceTotals(employeeId, annual, casual, sick) {
  await ensureLeaveBalanceRow(employeeId)
  return executeQuery(
    `UPDATE leave_balance SET
       annual_leave = $2,
       casual_leave = $3,
       sick_leave = $4,
       personal_leave = 0,
       updated_at = CURRENT_TIMESTAMP
     WHERE employee_id = $1
     RETURNING annual_leave, casual_leave, sick_leave`,
    [employeeId, annual, casual, sick]
  )
}

export async function setAnnualDaysDeducted(leaveRequestId, days) {
  return executeQuery(
    `UPDATE leave_requests SET annual_days_deducted = $2 WHERE leave_request_id = $1`,
    [leaveRequestId, Math.max(0, Math.floor(Number(days) || 0))]
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
        COALESCE(lr.annual_days_deducted, 0) AS annual_days_deducted,
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
