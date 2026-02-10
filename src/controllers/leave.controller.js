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

export async function getPendingHod(req, res) {
  try {
    const result = await leaveService.getPendingHod(req.params.employeeId)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(Array.isArray(result) ? result : [])
  } catch (error) {
    console.error('Pending HOD leaves error:', error)
    res.status(500).json({ error: 'Failed to fetch pending leave requests' })
  }
}

export async function getHrList(req, res) {
  try {
    const result = await leaveService.getHrList(req.params.employeeId, req.query)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('HR leave list error:', error)
    res.status(500).json({ error: 'Failed to fetch leave list' })
  }
}

export async function getPendingHr(req, res) {
  try {
    const result = await leaveService.getPendingHr(req.params.employeeId)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(Array.isArray(result) ? result : [])
  } catch (error) {
    console.error('HR pending leaves error:', error)
    res.status(500).json({ error: 'Failed to fetch HR pending list' })
  }
}

export async function updateLeaveStatus(req, res) {
  try {
    const result = await leaveService.updateLeaveStatus(req.params.leaveRequestId, req.body)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json({ message: result.message, status: result.status })
  } catch (error) {
    console.error('Update leave status error:', error)
    res.status(500).json({ error: 'Failed to update leave status' })
  }
}
