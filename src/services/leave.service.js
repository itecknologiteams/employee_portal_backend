import * as leaveRepo from '../repositories/leave.repository.js'

const defaultBalance = { annual: 15, sick: 10, personal: 5 }

export async function getLeaveBalance(employeeId) {
  const result = await leaveRepo.getLeaveBalance(employeeId)
  if (result.length === 0) return defaultBalance
  const b = result[0]
  return {
    annual: parseInt(b.annual_leave || 0),
    sick: parseInt(b.sick_leave || 0),
    personal: parseInt(b.personal_leave || 0)
  }
}

export async function getLeaveRequests(employeeId) {
  const result = await leaveRepo.getLeaveRequests(employeeId)
  return result.map(r => ({
    id: r.leave_request_id,
    type: r.leave_type || 'Annual Leave',
    startDate: r.start_date,
    endDate: r.end_date,
    days: parseInt(r.days || 0),
    status: r.status || 'Pending',
    reason: r.reason || '',
    date: r.created_at
  }))
}

export async function createLeaveRequest(data) {
  const { employeeId, leaveType, startDate, endDate, reason } = data
  const result = await leaveRepo.createLeaveRequest(employeeId, leaveType, startDate, endDate, reason)
  return {
    message: 'Leave request submitted successfully',
    leaveRequestId: result[0].leave_request_id
  }
}
