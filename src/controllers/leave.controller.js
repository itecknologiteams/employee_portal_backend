import * as leaveService from '../services/leave.service.js'

export async function getLeaveBalance(req, res) {
  try {
    const { employeeId } = req.params
    const balance = await leaveService.getLeaveBalance(employeeId)
    res.json(balance)
  } catch (error) {
    console.error('Leave balance error:', error)
    res.json({ annual: 15, sick: 10, personal: 5 })
  }
}

export async function getLeaveRequests(req, res) {
  try {
    const { employeeId } = req.params
    const requests = await leaveService.getLeaveRequests(employeeId)
    res.json(requests)
  } catch (error) {
    console.error('Leave requests error:', error)
    res.status(500).json({ error: 'Failed to fetch leave requests' })
  }
}

export async function createLeaveRequest(req, res) {
  try {
    const { employeeId, leaveType, startDate, endDate, reason } = req.body
    const result = await leaveService.createLeaveRequest({
      employeeId, leaveType, startDate, endDate, reason
    })
    res.json(result)
  } catch (error) {
    console.error('Create leave request error:', error)
    res.status(500).json({ error: 'Failed to create leave request' })
  }
}
