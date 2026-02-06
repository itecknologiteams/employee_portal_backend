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

export async function createLeaveRequest(employeeId, leaveType, startDate, endDate, reason) {
  return executeQuery(
    `INSERT INTO leave_requests (employee_id, leave_type, start_date, end_date, reason, status, created_at)
     VALUES ($1, $2, $3, $4, $5, 'Pending', CURRENT_TIMESTAMP)
     RETURNING leave_request_id`,
    [employeeId, leaveType, startDate, endDate, reason]
  )
}
