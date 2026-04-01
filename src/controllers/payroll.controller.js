import * as payrollService from '../services/payroll.service.js'
import * as repo from '../repositories/payroll.repository.js'
import { getEmployeeIdByCode } from '../repositories/auth.repository.js'

const VALID_STATUSES = ['draft', 'processing', 'processed', 'closed']

// ---------- Employee search (for Gross Salaries etc.) ----------
export async function searchEmployees(req, res) {
  try {
    const search = req.query.search != null ? String(req.query.search).trim() : ''
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50))
    const result = await payrollService.searchEmployees(search, limit)
    res.json(result)
  } catch (err) {
    if (err.code === '42P01') return res.json({ data: [] })
    console.error('Payroll employee search error:', err)
    res.status(500).json({ error: 'Failed to search employees' })
  }
}

// ---------- Gross salaries ----------
export async function addGrossSalary(req, res) {
  try {
    const { employeeCode, grossSalary } = req.body
    if (employeeCode == null || grossSalary == null) {
      return res.status(400).json({ error: 'employeeCode and grossSalary are required' })
    }
    const employeeId = await getEmployeeIdByCode(employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const result = await payrollService.addGrossSalary(employeeId, grossSalary)
    res.status(201).json(result)
  } catch (err) {
    if (err.message && (err.message.includes('Invalid') || err.message.includes('must be'))) {
      return res.status(400).json({ error: err.message })
    }
    if (err.code === '23503') return res.status(400).json({ error: 'Employee not found' })
    console.error('Add gross salary error:', err)
    res.status(500).json({ error: err.message || 'Failed to add gross salary' })
  }
}

export async function listGrossSalaries(req, res) {
  try {
    const search = req.query.search != null ? String(req.query.search).trim() : ''
    const page = Math.max(1, parseInt(req.query.page, 10) || 1)
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100))
    const result = await payrollService.listGrossSalaries(search, page, limit)
    res.json(result)
  } catch (err) {
    if (err.code === '42P01') return res.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 0 })
    console.error('List gross salaries error:', err)
    res.status(500).json({ error: 'Failed to fetch gross salaries' })
  }
}

export async function uploadGrossSalaries(req, res) {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'No file uploaded. Use form field "file".' })
    }
    const result = await payrollService.uploadGrossSalariesFromExcel(req.file.buffer)
    res.json({
      message: `Upload complete. ${result.added} gross salary(ies) saved.`,
      added: result.added,
      totalRows: result.totalRows,
      errors: result.errors
    })
  } catch (err) {
    if (err.message && err.message.includes('Excel')) {
      return res.status(400).json({ error: err.message })
    }
    console.error('Upload gross salaries error:', err)
    res.status(500).json({ error: err.message || 'Failed to upload gross salaries' })
  }
}

/** Upload full payroll sheet (CSV/Excel) with title rows – e.g. "iTecknologi Payroll - February 2026". */
export async function uploadPayrollSheet(req, res) {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'No file uploaded. Use form field "file".' })
    }
    const filename = req.file.originalname || ''
    const result = await payrollService.uploadPayrollSheetFromFile(req.file.buffer, filename)
    res.json({
      message: result.message,
      added: result.added,
      totalRows: result.totalRows,
      errors: result.errors
    })
  } catch (err) {
    if (err.message && (err.message.includes('header') || err.message.includes('Employee ID') || err.message.includes('empty'))) {
      return res.status(400).json({ error: err.message })
    }
    console.error('Upload payroll sheet error:', err)
    res.status(500).json({ error: err.message || 'Failed to upload payroll sheet' })
  }
}

// ---------- Periods ----------
export async function checkUnclosed(req, res) {
  try {
    const result = await payrollService.checkUnclosed()
    res.json(result)
  } catch (err) {
    console.error('Payroll check unclosed error:', err)
    res.status(500).json({ hasUnclosed: false })
  }
}

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
    if (err.code === '42P01') return res.status(500).json({ error: 'Payroll tables not found. Run database/schema.sql.' })
    if (err.message && err.message.includes('Pehle current')) return res.status(400).json({ error: err.message })
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
    const overridesList = Array.isArray(req.body) ? req.body : (req.body?.overrides ?? [])
    const result = await payrollService.saveOverrides(req.params.id, overridesList)
    if (!result) return res.status(404).json({ error: 'Period not found' })
    if (result.error) return res.status(400).json({ error: result.error })
    res.json({ message: 'Overrides saved' })
  } catch (err) {
    if (err.code === '42P01') return res.status(404).json({ error: 'Period not found' })
    res.status(500).json({ error: err.message || 'Failed to save overrides' })
  }
}

/** Upload period overrides from CSV/Excel (e.g. Allowances Sheet). */
export async function uploadPeriodOverrides(req, res) {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'No file uploaded. Use form field "file".' })
    }
    const result = await payrollService.uploadPeriodOverridesFromFile(
      req.params.id,
      req.file.buffer,
      req.file.originalname || ''
    )
    if (result.error) return res.status(400).json({ error: result.error })
    res.json({
      message: result.message,
      added: result.added,
      totalRows: result.totalRows,
      errors: result.errors
    })
  } catch (err) {
    if (err.code === '42P01') return res.status(404).json({ error: 'Period not found' })
    console.error('Upload period overrides error:', err)
    res.status(500).json({ error: err.message || 'Failed to upload overrides' })
  }
}

/** Apply deduction columns from main payroll CSV/Excel to existing slips (draft or processed). */
export async function applyDeductionsSheet(req, res) {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'No file uploaded. Use form field "file".' })
    }
    const result = await payrollService.applyPayrollSheetDeductionsToPeriod(
      req.params.id,
      req.file.buffer,
      req.file.originalname || ''
    )
    if (result.error) return res.status(400).json({ error: result.error })
    res.json({
      message: result.message,
      updated: result.updated,
      totalRows: result.totalRows,
      errors: result.errors
    })
  } catch (err) {
    if (err.code === '42P01') return res.status(404).json({ error: 'Period not found' })
    console.error('Apply deductions sheet error:', err)
    res.status(500).json({ error: err.message || 'Failed to apply deductions from sheet' })
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
      return res.status(500).json({ error: 'Payroll tables not found. Run database/schema.sql.' })
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
    const message = result.employeesProcessed != null
      ? `Period closed. ${result.employeesProcessed} salary slip(s) generated.`
      : 'Period closed'
    res.json({ message, id: result.id, employeesProcessed: result.employeesProcessed })
  } catch (err) {
    if (err.code === '42P01') return res.status(500).json({ error: 'Payroll tables not found. Run database/schema.sql.' })
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

/**
 * GET same URL — browser only sends GET; hold/update requires POST.
 * Explains why opening the link in the address bar does not change data.
 */
export function getSlipHoldInfo(req, res) {
  const base = `${req.protocol}://${req.get('host')}/api/payroll/periods/${req.params.id}/slips/${req.params.slipId}/hold`
  res.status(200).json({
    message:
      'Yeh endpoint POST se chalta hai. Browser address bar se URL open karne par sirf GET aata hai — isliye update nahi hota. Payroll page par dropdown se use karein, ya neeche curl/Postman se POST bhejein.',
    requiredMethod: 'POST',
    contentType: 'application/json',
    body: { slipOnHold: 'true = hold (employee ko slip nahi dikhegi), false = active' },
    exampleCurl: `curl -X POST "${base}" -H "Content-Type: application/json" -d "{\\"slipOnHold\\":true}"`
  })
}

/** POST body: { slipOnHold: boolean } — hide/show this month’s slip on employee Salary Slip page. */
export async function postSlipHold(req, res) {
  try {
    const periodId = req.params.id
    const slipId = req.params.slipId
    const slipOnHold = req.body?.slipOnHold === true
    const result = await payrollService.setSlipHold(periodId, slipId, slipOnHold)
    if (result.error === 'migration_required') {
      return res.status(503).json({
        error:
          'Database column slip_on_hold missing. Run migration: database/migrations/payroll_slip_slip_on_hold_pg.sql'
      })
    }
    if (result.error === 'not_found') {
      return res.status(404).json({ error: 'Slip not found for this period.' })
    }
    res.json({ message: slipOnHold ? 'Slip on hold for employees' : 'Slip visible to employees', slipOnHold })
  } catch (err) {
    console.error('postSlipHold:', err)
    res.status(500).json({ error: 'Failed to update slip' })
  }
}

/** POST body: { slipOnHold: boolean } — apply to all slips in period. */
export async function postHoldAllSlips(req, res) {
  try {
    const periodId = req.params.id
    const slipOnHold = req.body?.slipOnHold === true
    const result = await payrollService.holdAllSlipsInPeriod(periodId, slipOnHold)
    if (result.error === 'migration_required') {
      return res.status(503).json({
        error:
          'Database column slip_on_hold missing. Run migration: database/migrations/payroll_slip_slip_on_hold_pg.sql'
      })
    }
    if (result.error) {
      return res.status(500).json({ error: 'Failed to update slips' })
    }
    res.json({ message: slipOnHold ? 'All slips on hold for employees' : 'All slips visible to employees', slipOnHold })
  } catch (err) {
    console.error('postHoldAllSlips:', err)
    res.status(500).json({ error: 'Failed to update slips' })
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
    const allowances = Array.isArray(req.body) ? req.body : (req.body?.allowances ?? [])
    const result = await payrollService.saveDesignationAllowances(allowances)
    if (result.error) return res.status(400).json({ error: result.error })
    res.json({ message: 'Designation allowances saved' })
  } catch (err) {
    if (err.code === '42P01') return res.status(404).json({ error: 'Payroll tables not found. Run database/schema.sql.' })
    console.error('Save designation allowances error:', err)
    res.status(500).json({ error: err.message || 'Failed to save' })
  }
}

// ---------- Income tax slabs ----------
export async function getTaxSlabs(req, res) {
  try {
    const result = await payrollService.getActiveTaxSlabsForApi()
    res.json(result)
  } catch (err) {
    if (err.code === '42P01') return res.json({ activeVersion: null, slabs: [] })
    console.error('Get tax slabs error:', err)
    res.status(500).json({ error: 'Failed to fetch tax slabs' })
  }
}

export async function listTaxSlabVersions(req, res) {
  try {
    const list = await payrollService.listTaxSlabVersions()
    res.json(list)
  } catch (err) {
    if (err.code === '42P01') return res.json([])
    res.status(500).json({ error: 'Failed to fetch tax slab versions' })
  }
}

export async function getTaxSlabVersionById(req, res) {
  try {
    const result = await payrollService.getTaxSlabVersionWithSlabs(req.params.id)
    if (!result) return res.status(404).json({ error: 'Tax slab version not found' })
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch tax slab version' })
  }
}

export async function createTaxSlabVersion(req, res) {
  try {
    const result = await payrollService.createTaxSlabVersionWithSlabs(req.body)
    if (result.error) return res.status(400).json({ error: result.error })
    res.status(201).json(result)
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Version name already exists' })
    console.error('Create tax slab version error:', err)
    res.status(500).json({ error: err.message || 'Failed to create' })
  }
}

export async function setActiveTaxSlabVersion(req, res) {
  try {
    await payrollService.setActiveTaxSlabVersion(req.params.id)
    res.json({ message: 'Active tax slab version updated' })
  } catch (err) {
    res.status(500).json({ error: 'Failed to set active version' })
  }
}

export async function deleteTaxSlabVersion(req, res) {
  try {
    const result = await payrollService.deleteTaxSlabVersion(req.params.id)
    if (!result) return res.status(404).json({ error: 'Tax slab version not found' })
    res.json({ message: 'Tax slab version deleted', id: result.deleted })
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete' })
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
    const employeeId = await getEmployeeIdByCode(req.params.employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const result = await payrollService.getSalaryStructureByEmployee(employeeId)
    if (!result) return res.json(null)
    res.json(result)
  } catch (err) {
    if (err.code === '42P01') return res.json(null)
    res.status(500).json({ error: 'Failed to fetch structure' })
  }
}

export async function saveSalaryStructure(req, res) {
  try {
    const { employeeCode, ...rest } = req.body
    if (!employeeCode) {
      return res.status(400).json({ error: 'employeeCode is required' })
    }
    const employeeId = await getEmployeeIdByCode(employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const result = await payrollService.saveSalaryStructure({ ...rest, employeeId })
    res.status(201).json(result)
  } catch (err) {
    if (err.code === '42P01') return res.status(500).json({ error: 'Payroll tables not found. Run database/schema.sql.' })
    if (err.code === '23503') return res.status(400).json({ error: 'Employee not found' })
    console.error('Salary structure save error:', err)
    res.status(500).json({ error: err.message || 'Failed to save structure' })
  }
}
