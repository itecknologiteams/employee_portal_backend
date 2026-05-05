import * as salaryService from '../services/salary.service.js'
import { employeeHasPermission } from '../services/auth.service.js'
import { getEmployeeIdByCode } from '../repositories/auth.repository.js'
import * as salaryRepo from '../repositories/salary.repository.js'

/** True when viewer may see slips even if employee has salary_slip_on_hold (e.g. HR). */
async function bypassSalarySlipHold(req) {
  const viewerId = req.session?.user?.employeeId
  return employeeHasPermission(viewerId, 'view_salary_slips')
}

/** List salary slips for employee (payroll + old + legacy). Id format: "p-123", "o-456", "s-789". */
export async function listSlips(req, res) {
  try {
    const { employeeCode } = req.params
    const employeeId = await getEmployeeIdByCode(employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const bypass = await bypassSalarySlipHold(req)
    const result = await salaryService.listSlips(employeeId, { bypassHold: bypass })
    res.json(result)
  } catch (error) {
    console.error('Salary slips list error:', error)
    res.status(500).json({ error: 'Failed to fetch salary slips' })
  }
}

/** List only old (imported) salary slips for the "Old salary slips" tab. */
export async function listOldSlips(req, res) {
  try {
    const { employeeCode } = req.params
    const employeeId = await getEmployeeIdByCode(employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const bypass = await bypassSalarySlipHold(req)
    const result = await salaryService.listOldSlipsOnly(employeeId, { bypassHold: bypass })
    res.json(result)
  } catch (error) {
    console.error('Old salary slips list error:', error)
    res.status(500).json({ error: 'Failed to fetch old salary slips' })
  }
}

/** Get one old slip by numeric id. Query: employeeCode required. For GET /old-slip/:id. */
export async function getOldSlip(req, res) {
  try {
    const { id } = req.params
    const employeeCode = req.query.employeeCode
    if (!employeeCode) {
      return res.status(400).json({ error: 'employeeCode required' })
    }
    const employeeId = await getEmployeeIdByCode(employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const bypass = await bypassSalarySlipHold(req)
    const result = await salaryService.getOldSlipById(id, employeeId, { bypassHold: bypass })
    if (!result) {
      if (!bypass && (await salaryRepo.isSalarySlipOnHold(employeeId))) {
        return res.status(403).json({ error: 'Salary slip access is on hold for this employee.', salarySlipOnHold: true })
      }
      return res.status(404).json({ error: 'Slip not found' })
    }
    res.json(result)
  } catch (error) {
    console.error('Old slip get error:', error)
    res.status(500).json({ error: 'Failed to fetch old slip' })
  }
}

/** Get one salary slip by id ("p-123", "o-456", or "s-789"). Query: employeeCode required. */
export async function getSlip(req, res) {
  try {
    const rawId = req.params.id
    const employeeCode = req.query.employeeCode
    if (!employeeCode) {
      return res.status(400).json({ error: 'employeeCode required' })
    }
    const employeeId = await getEmployeeIdByCode(employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const bypass = await bypassSalarySlipHold(req)
    const result = await salaryService.getSlipById(rawId, employeeId, { bypassHold: bypass })
    if (!result) {
      if (!bypass && (await salaryRepo.isSalarySlipOnHold(employeeId))) {
        return res.status(403).json({ error: 'Salary slip access is on hold for this employee.', salarySlipOnHold: true })
      }
      return res.status(404).json({ error: 'Salary slip not found' })
    }
    res.json(result)
  } catch (error) {
    console.error('Salary slip get error:', error)
    res.status(500).json({ error: 'Failed to fetch salary slip' })
  }
}

/** Legacy: current month salary (latest slip for employee via hr_emp_id). */
export async function getCurrentSalary(req, res) {
  try {
    const { employeeCode } = req.params
    const employeeId = await getEmployeeIdByCode(employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const bypass = await bypassSalarySlipHold(req)
    const salary = await salaryService.getCurrentSalary(employeeId, { bypassHold: bypass })
    res.json(salary)
  } catch (error) {
    console.error('Current salary error:', error)
    res.status(500).json({ error: 'Failed to fetch current salary' })
  }
}

/** Legacy: history (same as slips but different response shape). */
export async function getSalaryHistory(req, res) {
  try {
    const { employeeCode } = req.params
    const employeeId = await getEmployeeIdByCode(employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const limit = parseInt(req.query.limit, 10) || 12
    const history = await salaryService.getSalaryHistory(employeeId, limit)
    res.json(history)
  } catch (error) {
    console.error('Salary history error:', error)
    res.status(500).json({ error: 'Failed to fetch salary history' })
  }
}

/** Download: return slip data. Params: salarySlipId ("p-123", "o-456", or "s-789"). Query: employeeCode required. */
export async function downloadSalarySlip(req, res) {
  try {
    const rawId = req.params.salarySlipId
    const employeeCode = req.query.employeeCode
    if (!employeeCode) return res.status(400).json({ error: 'employeeCode required' })
    const employeeId = await getEmployeeIdByCode(employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const bypass = await bypassSalarySlipHold(req)
    const result = await salaryService.getSalarySlipForDownload(rawId, employeeId, { bypassHold: bypass })
    if (!result) {
      if (!bypass && (await salaryRepo.isSalarySlipOnHold(employeeId))) {
        return res.status(403).json({ error: 'Salary slip access is on hold for this employee.', salarySlipOnHold: true })
      }
      return res.status(404).json({ error: 'Salary slip not found' })
    }
    res.json(result)
  } catch (error) {
    console.error('Download salary slip error:', error)
    res.status(500).json({ error: 'Failed to fetch salary slip' })
  }
}

/** Upload/bulk create old salary slips (import from SQL Server). Body: { slips: [{ employeeId, payMonth, periodLabel?, basicSalary?, grossSalary, totalAllowances, totalDeductions, netSalary, status?, remarks?, sourceEmployeeCode? }] } or raw array. */
export async function createOldSlips(req, res) {
  try {
    const slips = Array.isArray(req.body) ? req.body : (req.body?.slips ?? [])
    if (slips.length === 0) {
      return res.status(400).json({ error: 'slips array is required and must not be empty' })
    }
    const result = await salaryService.createOldSalarySlips(slips)
    res.status(201).json({ message: 'Old salary slips created', ...result })
  } catch (error) {
    if (error.code === '23503') return res.status(400).json({ error: 'One or more employeeId not found' })
    console.error('Create old salary slips error:', error)
    res.status(500).json({ error: error.message || 'Failed to create old salary slips' })
  }
}

/** GET /fpin/status/:employeeCode – has the employee set a FPIN? */
export async function getFpinStatus(req, res) {
  try {
    const { employeeCode } = req.params
    const employeeId = await getEmployeeIdByCode(employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const result = await salaryService.getFpinStatus(employeeId)
    res.json(result)
  } catch (error) {
    console.error('FPIN status error:', error)
    res.status(500).json({ error: 'Failed to get FPIN status' })
  }
}

/** POST /fpin/set – body: { employeeCode, pin }. Set or update FPIN (4–8 digits). */
export async function setFpin(req, res) {
  try {
    const { employeeCode, pin } = req.body
    if (!employeeCode) return res.status(400).json({ error: 'employeeCode is required' })
    const employeeId = await getEmployeeIdByCode(employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const result = await salaryService.setFpin(employeeId, pin)
    if (result.error) return res.status(result.status || 400).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('FPIN set error:', error)
    res.status(500).json({ error: 'Failed to set FPIN' })
  }
}

/** POST /fpin/verify – body: { employeeCode, pin }. Verify FPIN for viewing salary. */
export async function verifyFpin(req, res) {
  try {
    const { employeeCode, pin } = req.body
    if (!employeeCode) return res.status(400).json({ error: 'employeeCode is required' })
    const employeeId = await getEmployeeIdByCode(employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const result = await salaryService.verifyFpin(employeeId, pin)
    if (result.error) return res.status(result.status || 401).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('FPIN verify error:', error)
    res.status(500).json({ error: 'Failed to verify FPIN' })
  }
}

/** POST /fpin/reset-request – body: { employeeCode }. Send 6-digit OTP to employee email. */
export async function requestFpinReset(req, res) {
  try {
    const { employeeCode } = req.body
    if (!employeeCode) return res.status(400).json({ error: 'employeeCode is required' })
    const employeeId = await getEmployeeIdByCode(employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const result = await salaryService.requestFpinReset(employeeId)
    if (result.error) return res.status(result.status || 400).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('FPIN reset-request error:', error)
    res.status(500).json({ error: 'Failed to send reset code' })
  }
}

/** POST /fpin/reset – body: { employeeCode, code, newPin }. Verify OTP and set new 4-digit FPIN. */
export async function resetFpinWithCode(req, res) {
  try {
    const { employeeCode, code, newPin } = req.body
    if (!employeeCode) return res.status(400).json({ error: 'employeeCode is required' })
    const employeeId = await getEmployeeIdByCode(employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const result = await salaryService.resetFpinWithCode(employeeId, code, newPin)
    if (result.error) return res.status(result.status || 400).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('FPIN reset error:', error)
    res.status(500).json({ error: 'Failed to reset FPIN' })
  }
}
