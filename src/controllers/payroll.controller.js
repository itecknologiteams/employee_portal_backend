import * as payrollService from '../services/payroll.service.js'
import * as repo from '../repositories/payroll.repository.js'

const VALID_STATUSES = ['draft', 'processing', 'processed', 'closed']

// ---------- Periods ----------
export async function listPeriods(req, res) {
  try {
    const status = req.query.status && VALID_STATUSES.includes(req.query.status) ? req.query.status : null
    const page = Math.max(1, parseInt(req.query.page, 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10))
    const result = await payrollService.listPeriods(status, page, limit)
    res.json(result)
  } catch (err) {
    if (err.code === '42P01') return res.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 0 })
    console.error('Payroll periods list error:', err)
    res.status(500).json({ error: 'Failed to fetch payroll periods' })
  }
}

export async function createPeriod(req, res) {
  try {
    const { name, startDate, endDate, workingDays } = req.body
    if (!name || !startDate || !endDate) {
      return res.status(400).json({ error: 'name, startDate and endDate are required' })
    }
    const days = workingDays != null ? parseInt(workingDays, 10) : 30
    if (isNaN(days) || days < 1) {
      return res.status(400).json({ error: 'workingDays must be a positive number' })
    }
    const result = await payrollService.createPeriod({ name, startDate, endDate, workingDays: days })
    res.status(201).json(result)
  } catch (err) {
    if (err.code === '42P01') return res.status(500).json({ error: 'Payroll tables not found. Run payroll-schema.sql.' })
    console.error('Payroll period create error:', err)
    res.status(500).json({ error: err.message || 'Failed to create period' })
  }
}

export async function getPeriodById(req, res) {
  try {
    const result = await payrollService.getPeriodById(req.params.id)
    if (!result) return res.status(404).json({ error: 'Period not found' })
    res.json(result)
  } catch (err) {
    if (err.code === '42P01') return res.status(404).json({ error: 'Period not found' })
    res.status(500).json({ error: 'Failed to fetch period' })
  }
}

export async function deletePeriod(req, res) {
  try {
    const result = await payrollService.deletePeriod(req.params.id)
    if (!result) return res.status(404).json({ error: 'Period not found' })
    res.json({ message: 'Payroll period deleted', id: result.id })
  } catch (err) {
    if (err.code === '42P01') return res.status(404).json({ error: 'Period not found' })
    console.error('Payroll period delete error:', err)
    res.status(500).json({ error: err.message || 'Failed to delete period' })
  }
}

export async function getOverrides(req, res) {
  try {
    const result = await payrollService.getOverrides(req.params.id)
    if (!result) return res.status(404).json({ error: 'Period not found' })
    res.json(result)
  } catch (err) {
    if (err.code === '42P01') return res.status(404).json({ error: 'Period not found' })
    res.status(500).json({ error: 'Failed to fetch overrides' })
  }
}

export async function saveOverrides(req, res) {
  try {
    const { overrides: overridesList } = req.body || {}
    const result = await payrollService.saveOverrides(req.params.id, overridesList)
    if (!result) return res.status(404).json({ error: 'Period not found' })
    if (result.error) return res.status(400).json({ error: result.error })
    res.json({ message: 'Overrides saved' })
  } catch (err) {
    if (err.code === '42P01') return res.status(404).json({ error: 'Period not found' })
    res.status(500).json({ error: err.message || 'Failed to save overrides' })
  }
}

export async function runPayroll(req, res) {
  try {
    const result = await payrollService.runPayroll(req.params.id)
    if (result.error === 'not_found') return res.status(404).json({ error: 'Payroll period not found' })
    if (result.error) return res.status(400).json({ error: result.error })
    res.json({
      message: 'Payroll run completed',
      periodId: result.periodId,
      employeesProcessed: result.employeesProcessed,
      workingDays: result.workingDays,
      status: result.status
    })
  } catch (err) {
    if (err.code === '42P01') {
      return res.status(500).json({ error: 'Payroll tables not found. Run payroll-schema.sql.' })
    }
    console.error('Payroll run error:', err)
    await repo.setPeriodDraft(req.params.id).catch(() => {})
    res.status(500).json({ error: err.message || 'Payroll run failed' })
  }
}

export async function closePeriod(req, res) {
  try {
    const result = await payrollService.closePeriod(req.params.id)
    if (!result) return res.status(400).json({ error: 'Period not found or already closed' })
    res.json({ message: 'Period closed', id: result.id })
  } catch (err) {
    if (err.code === '42P01') return res.status(500).json({ error: 'Payroll tables not found' })
    res.status(500).json({ error: 'Failed to close period' })
  }
}

export async function listSlips(req, res) {
  try {
    const search = (req.query.search || '').trim().replace(/%/g, '\\%')
    const page = Math.max(1, parseInt(req.query.page, 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10))
    const result = await payrollService.listSlips(req.params.id, search, page, limit)
    res.json(result)
  } catch (err) {
    if (err.code === '42P01') return res.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 0 })
    res.status(500).json({ error: 'Failed to fetch slips' })
  }
}

// ---------- Designation allowances ----------
export async function listDesignationAllowances(req, res) {
  try {
    const result = await payrollService.listDesignationAllowances()
    res.json(result)
  } catch (err) {
    if (err.code === '42P01') return res.json([])
    console.error('Designation allowances error:', err)
    res.status(500).json({ error: 'Failed to fetch designation allowances' })
  }
}

export async function saveDesignationAllowances(req, res) {
  try {
    const { allowances } = req.body || {}
    const result = await payrollService.saveDesignationAllowances(allowances)
    if (result.error) return res.status(400).json({ error: result.error })
    res.json({ message: 'Designation allowances saved' })
  } catch (err) {
    if (err.code === '42P01') return res.status(404).json({ error: 'designation_allowance table not found' })
    console.error('Save designation allowances error:', err)
    res.status(500).json({ error: err.message || 'Failed to save' })
  }
}

// ---------- Salary structures ----------
export async function listSalaryStructures(req, res) {
  try {
    const search = (req.query.search || '').trim().replace(/%/g, '\\%')
    const page = Math.max(1, parseInt(req.query.page, 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10))
    const result = await payrollService.listSalaryStructures(search, page, limit)
    res.json(result)
  } catch (err) {
    if (err.code === '42P01') return res.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 0 })
    res.status(500).json({ error: 'Failed to fetch salary structures' })
  }
}

export async function getSalaryStructureByEmployee(req, res) {
  try {
    const result = await payrollService.getSalaryStructureByEmployee(req.params.employeeId)
    if (!result) return res.json(null)
    res.json(result)
  } catch (err) {
    if (err.code === '42P01') return res.json(null)
    res.status(500).json({ error: 'Failed to fetch structure' })
  }
}

export async function saveSalaryStructure(req, res) {
  try {
    if (!req.body.employeeId) {
      return res.status(400).json({ error: 'employeeId is required' })
    }
    const result = await payrollService.saveSalaryStructure(req.body)
    res.status(201).json(result)
  } catch (err) {
    if (err.code === '42P01') return res.status(500).json({ error: 'Payroll tables not found' })
    if (err.code === '23503') return res.status(400).json({ error: 'Employee not found' })
    console.error('Salary structure save error:', err)
    res.status(500).json({ error: err.message || 'Failed to save structure' })
  }
}
