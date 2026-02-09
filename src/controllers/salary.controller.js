import * as salaryService from '../services/salary.service.js'

/** List salary slips for employee (payroll + legacy). Id format: "p-123" or "s-456". */
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

/** Get one salary slip by id ("p-123" or "s-456"). Query: employeeId required. */
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

/** Download: return slip data. Params: salarySlipId ("p-123" or "s-456"). Query: employeeId required. */
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
