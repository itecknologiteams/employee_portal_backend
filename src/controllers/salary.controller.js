import * as salaryService from '../services/salary.service.js'

/** List salary slips for employee (payroll + old + legacy). Id format: "p-123", "o-456", "s-789". */
export async function listSlips(req, res) {
  try {
    const { employeeId } = req.params
    const result = await salaryService.listSlips(employeeId)
    res.json(result)
  } catch (error) {
    console.error('Salary slips list error:', error)
    res.status(500).json({ error: 'Failed to fetch salary slips' })
  }
}

/** List only old (imported) salary slips for the "Old salary slips" tab. */
export async function listOldSlips(req, res) {
  try {
    const { employeeId } = req.params
    const result = await salaryService.listOldSlipsOnly(employeeId)
    res.json(result)
  } catch (error) {
    console.error('Old salary slips list error:', error)
    res.status(500).json({ error: 'Failed to fetch old salary slips' })
  }
}

/** Get one old slip by numeric id. Query: employeeId required. For GET /old-slip/:id. */
export async function getOldSlip(req, res) {
  try {
    const { id } = req.params
    const employeeId = req.query.employeeId
    if (!employeeId) {
      return res.status(400).json({ error: 'employeeId required' })
    }
    const result = await salaryService.getOldSlipById(id, employeeId)
    if (!result) return res.status(404).json({ error: 'Slip not found' })
    res.json(result)
  } catch (error) {
    console.error('Old slip get error:', error)
    res.status(500).json({ error: 'Failed to fetch old slip' })
  }
}

/** Get one salary slip by id ("p-123", "o-456", or "s-789"). Query: employeeId required. */
export async function getSlip(req, res) {
  try {
    const rawId = req.params.id
    const employeeId = req.query.employeeId
    if (!employeeId) {
      return res.status(400).json({ error: 'employeeId required' })
    }
    const result = await salaryService.getSlipById(rawId, employeeId)
    if (!result) return res.status(404).json({ error: 'Salary slip not found' })
    res.json(result)
  } catch (error) {
    console.error('Salary slip get error:', error)
    res.status(500).json({ error: 'Failed to fetch salary slip' })
  }
}

/** Legacy: current month salary (latest slip for employee via hr_emp_id). */
export async function getCurrentSalary(req, res) {
  try {
    const { employeeId } = req.params
    const salary = await salaryService.getCurrentSalary(employeeId)
    res.json(salary)
  } catch (error) {
    console.error('Current salary error:', error)
    res.status(500).json({ error: 'Failed to fetch current salary' })
  }
}

/** Legacy: history (same as slips but different response shape). */
export async function getSalaryHistory(req, res) {
  try {
    const { employeeId } = req.params
    const limit = parseInt(req.query.limit, 10) || 12
    const history = await salaryService.getSalaryHistory(employeeId, limit)
    res.json(history)
  } catch (error) {
    console.error('Salary history error:', error)
    res.status(500).json({ error: 'Failed to fetch salary history' })
  }
}

/** Download: return slip data. Params: salarySlipId ("p-123", "o-456", or "s-789"). Query: employeeId required. */
export async function downloadSalarySlip(req, res) {
  try {
    const rawId = req.params.salarySlipId
    const employeeId = req.query.employeeId
    if (!employeeId) return res.status(400).json({ error: 'employeeId required' })
    const result = await salaryService.getSalarySlipForDownload(rawId, employeeId)
    if (!result) return res.status(404).json({ error: 'Salary slip not found' })
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
