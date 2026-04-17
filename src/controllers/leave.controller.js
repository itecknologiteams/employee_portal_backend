import * as leaveService from '../services/leave.service.js'
import * as leaveRepo from '../repositories/leave.repository.js'
import { getEmployeeIdByCode } from '../repositories/auth.repository.js'

/** GET /types - Get all active leave types */
export async function getLeaveTypes(req, res) {
  try {
    const types = await leaveRepo.getAllLeaveTypes()
    res.json({
      leaveTypes: types.map(t => ({
        id: t.leave_type_id,
        name: t.leave_type_name,
        description: t.description,
        isActive: t.is_active,
        createdAt: t.created_at,
        updatedAt: t.updated_at
      }))
    })
  } catch (error) {
    console.error('Get leave types error:', error)
    res.status(500).json({ error: 'Failed to fetch leave types' })
  }
}

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
    const { employeeCode, leaveTypeId, leaveType, startDate, endDate, reason } = req.body
    if (!employeeCode) return res.status(400).json({ error: 'employeeCode is required' })
    const employeeId = await getEmployeeIdByCode(employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const result = await leaveService.createLeaveRequest({
      employeeId, leaveTypeId, leaveType, startDate, endDate, reason
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

/** GET /balance-with-code/:employeeCode - Returns balance with employee_code field */
export async function getLeaveBalanceWithCode(req, res) {
  try {
    const { employeeCode } = req.params
    if (!employeeCode?.trim()) return res.status(400).json({ error: 'Employee code is required' })
    const balance = await leaveService.getLeaveBalanceByCode(employeeCode.trim())
    res.json(balance)
  } catch (error) {
    console.error('Leave balance with code error:', error)
    res.status(500).json({ error: 'Failed to fetch leave balance' })
  }
}

/** HR: GET /hr/all-balances?hrEmployeeId=&limit=&offset= - Returns all balances with employee_code */
export async function getAllLeaveBalances(req, res) {
  try {
    const hrEmployeeId = req.query?.hrEmployeeId || req.body?.hrEmployeeId
    const limit = Math.min(1000, Math.max(1, parseInt(req.query?.limit || req.body?.limit || 100, 10)))
    const offset = Math.max(0, parseInt(req.query?.offset || req.body?.offset || 0, 10))
    const result = await leaveService.getAllLeaveBalances(hrEmployeeId, limit, offset)
    if (result.error) return res.status(result.status || 400).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('Get all leave balances error:', error)
    res.status(500).json({ error: 'Failed to fetch leave balances' })
  }
}

/** HR: POST /hr/bulk-import body { hrEmployeeId, data: [{ employeeCode, annual, casual, sick, carried, marriage, maternity, paternal, pilgrimage }] } */
export async function hrBulkImportBalances(req, res) {
  try {
    const hrEmployeeId = req.body?.hrEmployeeId || req.body?.hrEmployeeCode
    const data = req.body?.data || req.body?.rows || []
    const result = await leaveService.hrBulkImportLeaveBalances(hrEmployeeId, data)
    if (result.error) return res.status(result.status || 400).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('Bulk import leave balances error:', error)
    res.status(500).json({ error: 'Failed to import leave balances' })
  }
}

/** HR: POST /hr/allocate-all body { hrEmployeeId }
 * Allocates default leave quotas to ALL active employees at once.
 * Uses prorated annual leave for < 1 year, full 14 days for 1+ year.
 * Gender-based assignment: Female (maternity=90), Male (paternal=7)
 */
export async function allocateAllEmployees(req, res) {
  try {
    const hrEmployeeId = req.body?.hrEmployeeId || req.query?.hrEmployeeId
    const result = await leaveService.allocateAllEmployeesLeaveQuota(hrEmployeeId)
    if (result.error) return res.status(result.status || 400).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('Allocate all employees error:', error)
    res.status(500).json({ error: 'Failed to allocate leave quotas to all employees' })
  }
}

/** HR: POST /hr/import-carried-forward body { hrEmployeeId, data: [{ employeeCode, carried }] }
 * Import carried forward leaves only (one-time setup).
 * This ONLY updates carried_forward field and does NOT modify other leave types.
 */
export async function importCarriedForward(req, res) {
  try {
    const hrEmployeeId = req.body?.hrEmployeeId || req.body?.hrEmployeeCode
    const data = req.body?.data || req.body?.rows || []
    const result = await leaveService.importCarriedForwardOnly(hrEmployeeId, data)
    if (result.error) return res.status(result.status || 400).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('Import carried forward error:', error)
    res.status(500).json({ error: 'Failed to import carried forward leaves' })
  }
}

/** GET /calculate-annual-leave/:employeeCode - Calculate prorated annual leave based on join date */
export async function calculateAnnualLeave(req, res) {
  try {
    const { employeeCode } = req.params
    if (!employeeCode?.trim()) return res.status(400).json({ error: 'Employee code is required' })
    const result = await leaveService.calculateEmployeeAnnualLeaveByCode(employeeCode.trim())
    if (result.error) return res.status(result.status || 400).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('Calculate annual leave error:', error)
    res.status(500).json({ error: 'Failed to calculate annual leave' })
  }
}

/** HR: POST /hr/rollover-annual-leave body { hrEmployeeId, employeeCode } - Rollover annual leave for one employee */
export async function hrRolloverAnnualLeave(req, res) {
  try {
    const { employeeCode } = req.params
    const hrEmployeeId = req.body?.hrEmployeeId || req.body?.hrEmployeeCode
    const result = await leaveService.rolloverAnnualLeaveForEmployee(hrEmployeeId, employeeCode)
    if (result.error) return res.status(result.status || 400).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('Rollover annual leave error:', error)
    res.status(500).json({ error: 'Failed to rollover annual leave' })
  }
}

/** HR: POST /hr/bulk-rollover body { hrEmployeeId } - Bulk rollover for all eligible employees */
export async function hrBulkRollover(req, res) {
  try {
    const hrEmployeeId = req.body?.hrEmployeeId || req.body?.hrEmployeeCode
    const result = await leaveService.bulkRolloverAnnualLeaves(hrEmployeeId)
    if (result.error) return res.status(result.status || 400).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('Bulk rollover error:', error)
    res.status(500).json({ error: 'Failed to perform bulk rollover' })
  }
}

/** HR: GET /hr/rollover-eligibility/:employeeCode - Check if employee is eligible for rollover */
export async function checkRolloverEligibility(req, res) {
  try {
    const { employeeCode } = req.params
    if (!employeeCode?.trim()) return res.status(400).json({ error: 'Employee code is required' })
    const result = await leaveService.checkRolloverEligibility(employeeCode.trim())
    if (result.error) return res.status(result.status || 400).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('Check rollover eligibility error:', error)
    res.status(500).json({ error: 'Failed to check rollover eligibility' })
  }
}

/** Proxy to external Attendance System API for casual/sick leaves */
export async function getExternalLeaves(req, res) {
  try {
    const { emp_id, year } = req.body
    
    if (!emp_id || !year) {
      return res.status(400).json({ error: 'emp_id and year are required' })
    }

    const EXTERNAL_API_URL = 'http://192.168.20.244:3002/leaves/view-allocated-leaves-by-emp'
    
    const response = await fetch(EXTERNAL_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emp_id, year }),
      timeout: 10000
    })

    if (!response.ok) {
      throw new Error(`External API returned ${response.status}`)
    }

    const data = await response.json()
    res.json(data)
  } catch (error) {
    console.error('External leaves API error:', error)
    res.status(500).json({ 
      error: 'Failed to fetch external leaves',
      message: error.message 
    })
  }
}

/** CEO: Get pending leave requests for CEO approval (HOD requests for Annual/Other leaves) */
export async function getPendingCeo(req, res) {
  try {
    const { employeeCode } = req.params
    const result = await leaveService.getPendingCeo(employeeCode)
    if (result.error) return res.status(result.status || 500).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('Pending CEO leaves error:', error)
    res.status(500).json({ error: 'Failed to fetch CEO pending list' })
  }
}
