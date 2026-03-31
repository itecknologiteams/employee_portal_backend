import * as leaveService from '../services/leave.service.js'
import { getEmployeeIdByCode } from '../repositories/auth.repository.js'

export async function getLeaveBalance(req, res) {
  try {
    const { employeeCode } = req.params
    const employeeId = await getEmployeeIdByCode(employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const balance = await leaveService.getLeaveBalance(employeeId)
    res.json(balance)
  } catch (error) {
    console.error('Leave balance error:', error)
    res.json({ annual: 14, casual: 10, sick: 6 })
  }
}

export async function getLeaveRequests(req, res) {
  try {
    const { employeeCode } = req.params
    const employeeId = await getEmployeeIdByCode(employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const requests = await leaveService.getLeaveRequests(employeeId)
    res.json(requests)
  } catch (error) {
    console.error('Leave requests error:', error)
    res.status(500).json({ error: 'Failed to fetch leave requests' })
  }
}

export async function createLeaveRequest(req, res) {
  try {
    const { employeeCode, leaveType, startDate, endDate, reason } = req.body
    if (!employeeCode) return res.status(400).json({ error: 'employeeCode is required' })
    const employeeId = await getEmployeeIdByCode(employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const result = await leaveService.createLeaveRequest({
      employeeId, leaveType, startDate, endDate, reason
    })
    if (result.error) return res.status(result.status || 400).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('Create leave request error:', error)
    res.status(500).json({ error: 'Failed to create leave request' })
  }
}

export async function getPendingHod(req, res) {
  try {
    const { employeeCode } = req.params
    const employeeId = await getEmployeeIdByCode(employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const result = await leaveService.getPendingHod(employeeId)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(Array.isArray(result) ? result : [])
  } catch (error) {
    console.error('Pending HOD leaves error:', error)
    res.status(500).json({ error: 'Failed to fetch pending leave requests' })
  }
}

export async function getHrList(req, res) {
  try {
    const { employeeCode } = req.params
    const employeeId = await getEmployeeIdByCode(employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const result = await leaveService.getHrList(employeeId, req.query)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('HR leave list error:', error)
    res.status(500).json({ error: 'Failed to fetch leave list' })
  }
}

export async function getPendingHr(req, res) {
  try {
    const { employeeCode } = req.params
    const employeeId = await getEmployeeIdByCode(employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const result = await leaveService.getPendingHr(employeeId)
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

/** HR: PUT body { hrEmployeeId, annual, casual, sick } */
export async function hrPutLeaveBalance(req, res) {
  try {
    const { employeeCode: targetCode } = req.params
    const result = await leaveService.hrSetLeaveBalance(req.body?.hrEmployeeId, targetCode, req.body)
    if (result.error) return res.status(result.status || 400).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('HR leave balance update error:', error)
    res.status(500).json({ error: 'Failed to update leave balance' })
  }
}

/** HR: POST body { hrEmployeeId, employeeCode, leaveType, days, reason } */
export async function hrDeductLeave(req, res) {
  try {
    const result = await leaveService.hrDeductLeaveBalance(req.body || {})
    if (result.error) return res.status(result.status || 400).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('HR leave deduction error:', error)
    const message = error?.message ? String(error.message) : 'Failed to deduct leave balance'
    res.status(500).json({ error: message })
  }
}

/** HR: GET /hr/deductions?hrEmployeeId=&employeeCode=&page=&limit= */
export async function getHrDeductionLog(req, res) {
  try {
    const result = await leaveService.getManualDeductionLog(req.query || {})
    if (result.error) return res.status(result.status || 400).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('HR leave deduction log error:', error)
    const message = error?.message ? String(error.message) : 'Failed to fetch leave deduction log'
    res.status(500).json({ error: message })
  }
}

/** HR: PUT /hr/deduction/:deductionId body { hrEmployeeId/hrEmployeeCode, leaveType, days, reason } */
export async function hrEditDeduction(req, res) {
  try {
    const result = await leaveService.hrEditDeduction(req.params.deductionId, req.body || {})
    if (result.error) return res.status(result.status || 400).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('HR leave deduction edit error:', error)
    const message = error?.message ? String(error.message) : 'Failed to edit leave deduction'
    res.status(500).json({ error: message })
  }
}
