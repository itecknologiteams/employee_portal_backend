import * as payrollService from '../services/payrollDb.service.js'
import { getEmployeeIdByCode } from '../repositories/auth.repository.js'

/** Resolve an :employeeCode route param to a numeric employee id (404 if unknown). */
async function resolveEmployeeId(res, employeeCode) {
  const id = await getEmployeeIdByCode(String(employeeCode || '').trim())
  if (!id) {
    res.status(404).json({ error: 'Employee not found' })
    return null
  }
  return id
}

/** POST /structure/sync/:employeeCode — copy one employee's salary structure into the payroll template. */
export async function syncStructure(req, res) {
  try {
    const employeeId = await resolveEmployeeId(res, req.params.employeeCode)
    if (employeeId == null) return
    res.json(await payrollService.syncEmployeeStructure(employeeId))
  } catch (error) {
    console.error('Payroll structure sync error:', error)
    res.status(500).json({ error: 'Failed to sync salary structure' })
  }
}

/** POST /structure/sync-all — sync every employee's salary structure. */
export async function syncAllStructures(_req, res) {
  try {
    res.json(await payrollService.syncAllEmployeeStructures())
  } catch (error) {
    console.error('Payroll structure sync-all error:', error)
    res.status(500).json({ error: 'Failed to sync salary structures' })
  }
}

/** POST /loan/sync/:reqId — manually (re)sync a Finance-approved loan/advance requisition. */
export async function syncLoan(req, res) {
  try {
    const reqId = parseInt(req.params.reqId, 10)
    if (Number.isNaN(reqId)) return res.status(400).json({ error: 'Valid reqId is required' })
    res.json(await payrollService.syncLoanFromRequisition(reqId))
  } catch (error) {
    console.error('Payroll loan sync error:', error)
    res.status(500).json({ error: 'Failed to sync loan' })
  }
}

/** POST /slip/generate — body: { employeeCode, payrollId }. Generate/regenerate a slip. */
export async function generateSlip(req, res) {
  try {
    const employeeId = await resolveEmployeeId(res, req.body?.employeeCode)
    if (employeeId == null) return
    const result = await payrollService.generatePayrollSlip(req.body?.payrollId, employeeId)
    if (result?.error) return res.status(result.status || 400).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('Payroll slip generate error:', error)
    res.status(500).json({ error: 'Failed to generate payroll slip' })
  }
}

/** GET /slip/:employeeCode/:payrollId — one slip (header + element line items). */
export async function getSlip(req, res) {
  try {
    const employeeId = await resolveEmployeeId(res, req.params.employeeCode)
    if (employeeId == null) return
    const slip = await payrollService.getPayrollSlip(req.params.payrollId, employeeId)
    if (!slip) return res.status(404).json({ error: 'Slip not found' })
    res.json(slip)
  } catch (error) {
    console.error('Payroll get slip error:', error)
    res.status(500).json({ error: 'Failed to get payroll slip' })
  }
}

/** GET /slips/:employeeCode — all slips for an employee. */
export async function listSlips(req, res) {
  try {
    const employeeId = await resolveEmployeeId(res, req.params.employeeCode)
    if (employeeId == null) return
    res.json({ slips: await payrollService.listPayrollSlips(employeeId) })
  } catch (error) {
    console.error('Payroll list slips error:', error)
    res.status(500).json({ error: 'Failed to list payroll slips' })
  }
}

/** GET /periods — all payroll periods with slip counts. */
export async function listPeriods(_req, res) {
  try {
    res.json({ periods: await payrollService.listPeriods() })
  } catch (error) {
    console.error('Payroll list periods error:', error)
    res.status(500).json({ error: 'Failed to list payroll periods' })
  }
}

/** GET /periods/:payrollId/slips — all employee slips in a period. */
export async function listPeriodSlips(req, res) {
  try {
    const payrollId = parseInt(req.params.payrollId, 10)
    if (Number.isNaN(payrollId)) return res.status(400).json({ error: 'Valid payrollId is required' })
    res.json({ slips: await payrollService.listSlipsForPeriod(payrollId) })
  } catch (error) {
    console.error('Payroll list period slips error:', error)
    res.status(500).json({ error: 'Failed to list period slips' })
  }
}

/** POST /periods/:payrollId/generate-all — generate slips for all employees with a structure. */
export async function generateAllForPeriod(req, res) {
  try {
    const payrollId = parseInt(req.params.payrollId, 10)
    if (Number.isNaN(payrollId)) return res.status(400).json({ error: 'Valid payrollId is required' })
    const result = await payrollService.generateAllForPeriod(payrollId)
    if (result?.error) return res.status(result.status || 400).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('Payroll generate-all error:', error)
    res.status(500).json({ error: 'Failed to generate slips for period' })
  }
}

/** GET /element-sheet/template?type=allowance|deduction — download the shared Excel template. */
export async function downloadElementSheetTemplate(req, res) {
  try {
    const type = req.query.type
    const { buffer, filename } = await payrollService.buildElementSheetTemplate(type)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.send(buffer)
  } catch (error) {
    console.error('Element sheet template error:', error)
    res.status(500).json({ error: 'Failed to build template' })
  }
}

/** POST /periods/:payrollId/element-sheet?type=allowance|deduction — upload a filled sheet. */
export async function uploadElementSheet(req, res) {
  try {
    if (!req.file?.buffer) return res.status(400).json({ error: 'An Excel file (field "file") is required' })
    const payrollId = parseInt(req.params.payrollId, 10)
    if (Number.isNaN(payrollId)) return res.status(400).json({ error: 'Valid payrollId is required' })
    const result = await payrollService.uploadElementSheet(payrollId, req.query.type, req.file.buffer)
    if (result?.error) return res.status(result.status || 400).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('Element sheet upload error:', error)
    res.status(500).json({ error: 'Failed to upload element sheet' })
  }
}

/** GET /loans/:employeeCode — loans/advances with outstanding balances. */
export async function getLoans(req, res) {
  try {
    const employeeId = await resolveEmployeeId(res, req.params.employeeCode)
    if (employeeId == null) return
    res.json({ loans: await payrollService.getEmployeeLoans(employeeId) })
  } catch (error) {
    console.error('Payroll get loans error:', error)
    res.status(500).json({ error: 'Failed to get loans' })
  }
}
