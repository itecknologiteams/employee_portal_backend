import * as repo from '../repositories/payroll.repository.js'
import * as XLSX from 'xlsx'

// ---------- Gross salary (add by input) ----------
export async function addGrossSalary(employeeId, grossSalary) {
  const eid = parseInt(employeeId, 10)
  if (!Number.isInteger(eid)) throw new Error('Invalid employee ID')
  const gross = parseFloat(grossSalary)
  if (!Number.isFinite(gross) || gross <= 0) throw new Error('Gross salary must be a positive number')

  const joinDate = await repo.getEmployeeJoinDate(eid)
  const structure = repo.computeStructureFromGross(gross, joinDate)
  if (!structure) throw new Error('Could not compute salary structure')

  await repo.upsertGrossSalary(eid, gross)
  await repo.upsertSalaryStructure({
    employeeId: eid,
    ...structure
  })
  return {
    employeeId: eid,
    grossSalary: gross,
    joinDate: joinDate || null,
    message: 'Gross salary saved. Breakdown (basic, medical, HRA, utilities, etc.) auto-computed from join-date rules.'
  }
}

/** Process one gross salary row (used by upload). Returns { success, error? }. */
async function processGrossSalaryRow(employeeId, grossSalary) {
  const eid = parseInt(employeeId, 10)
  if (!Number.isInteger(eid)) return { success: false, error: 'Invalid employee ID' }
  const gross = parseFloat(grossSalary)
  if (!Number.isFinite(gross) || gross <= 0) return { success: false, error: 'Gross salary must be a positive number' }
  const joinDate = await repo.getEmployeeJoinDate(eid)
  const structure = repo.computeStructureFromGross(gross, joinDate)
  if (!structure) return { success: false, error: 'Could not compute structure' }
  await repo.upsertGrossSalary(eid, gross)
  await repo.upsertSalaryStructure({ employeeId: eid, ...structure })
  return { success: true }
}

export async function uploadGrossSalariesFromExcel(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) throw new Error('Excel file has no sheets')
  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
  if (!rows.length) throw new Error('Excel file is empty')
  const headerRow = rows[0].map((h) => String(h || '').trim().toLowerCase())
  const colEmployee = headerRow.findIndex((h) =>
    /employee\s*(id|code)/i.test(h) || h === 'employee_code' || h === 'employee_id' || h === 'employee id' || h === 'employee code'
  )
  const colGross = headerRow.findIndex((h) =>
    /gross\s*salary/i.test(h) || h === 'gross_salary' || h === 'gross salary'
  )
  if (colEmployee < 0 || colGross < 0) {
    throw new Error('Excel must have columns "employee_code" / "Employee ID" and "gross_salary" / "Gross Salary" in the first row')
  }
  const added = []
  const errors = []
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    const rawId = row[colEmployee]
    const rawGross = row[colGross]
    if (rawId == null && rawGross == null) continue
    const codeOrId = rawId != null ? String(rawId).trim() : ''
    const grossVal = rawGross != null ? parseFloat(String(rawGross).replace(/,/g, '')) : NaN
    if (!codeOrId) {
      errors.push({ row: i + 1, message: 'Missing employee ID/code' })
      continue
    }
    if (!Number.isFinite(grossVal) || grossVal <= 0) {
      errors.push({ row: i + 1, message: 'Invalid or missing gross salary' })
      continue
    }
    const employeeId = await repo.getEmployeeIdByCodeOrId(codeOrId)
    if (!employeeId) {
      errors.push({ row: i + 1, message: `Employee not found: ${codeOrId}` })
      continue
    }
    try {
      await processGrossSalaryRow(employeeId, grossVal)
      added.push({ row: i + 1, employeeId, grossSalary: grossVal })
    } catch (err) {
      errors.push({ row: i + 1, message: err.message || 'Failed to save' })
    }
  }
  return { added: added.length, totalRows: rows.length - 1, errors }
}

/** Parse number from cell (handles "1,234.56", "(1,234.56)" and empty) */
function parseNum(val) {
  if (val == null || val === '') return NaN
  const s = String(val).replace(/,/g, '').replace(/[()]/g, '').trim()
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : NaN
}


/** Excel/CSV often stores codes as numbers (10531 → "10531.0"); normalize for DB lookup */
function normalizeEmployeeCell(val) {
  if (val == null || val === '') return ''
  if (typeof val === 'number') {
    if (Number.isInteger(val)) return String(val)
    const r = Math.round(val)
    if (Math.abs(val - r) < 1e-9) return String(r)
    return String(val).trim()
  }
  let s = String(val).trim()
  if (/^[\d,.\s]+$/.test(s)) {
    const n = parseFloat(s.replace(/,/g, ''))
    if (Number.isFinite(n) && Math.abs(n - Math.round(n)) < 1e-6) return String(Math.round(n))
  }
  return s
}

/** Find row index where header row lists Employee ID / Emp Code (iTecknologi-style title rows above) */
function findPayrollHeaderRow(rows) {
  const headerLike = (cell) => {
    const t = String(cell || '')
      .trim()
      .replace(/\s+/g, ' ')
    return (
      /employee\s*(id|code|no\.?)\b/i.test(t) ||
      /^emp\.?\s*code$/i.test(t) ||
      /^emp\s*code$/i.test(t) ||
      /^staff\s*(id|no\.?)$/i.test(t)
    )
  }
  for (let i = 0; i < Math.min(rows.length, 35); i++) {
    const row = rows[i] || []
    for (let j = 0; j < row.length; j++) {
      if (headerLike(row[j])) return i
    }
  }
  return -1
}

/**
 * Column index by header (case-insensitive). Optional reject(hNorm) skips misleading columns
 * (e.g. "Total Deductions" when searching for gross "Total").
 */
function colIndex(headerRow, patterns, options = {}) {
  const { reject } = options
  const norm = (h) => String(h || '').trim().toLowerCase().replace(/\s+/g, ' ')
  for (let c = 0; c < headerRow.length; c++) {
    const h = norm(headerRow[c])
    if (reject && reject(h)) continue
    for (const p of patterns) {
      if (typeof p === 'string' && h.includes(p.toLowerCase())) return c
      if (p instanceof RegExp && p.test(h)) return c
    }
  }
  return -1
}

const REJECT_GROSS_TOTAL_COL = (h) =>
  /deduction|deduct\b|tax\b|withhold|loan|advance|fine|penalty|eobi\b|provident|pf\b|statutory|nssf|paye\b/i.test(h)

/** Net pay / take-home column (must not match gross). */
function colIndexNetSalary(headerRow) {
  return colIndex(
    headerRow,
    [
      /^net\s*salary\s*payable$/i,
      /^net\s*(salary|pay)$/i,
      /^total\s*net/i,
      /^take\s*home$/i,
      /^take\s*home\s*pay$/i,
      'net salary',
      'net payable',
      'net pay',
      'salary credited',
      'payable to employee',
      'net amount'
    ],
    { reject: (h) => /gross\s*(salary|pay|total)|taxable|before\s*tax/i.test(h) }
  )
}

/** Income tax column only — values from sheet; never auto-calculated here. */
function colIndexIncomeTax(headerRow) {
  return colIndex(
    headerRow,
    [
      /^income\s*tax$/i,
      /^withholding\s*tax$/i,
      /^paye$/i,
      /^wht$/i,
      'income tax',
      'withholding tax',
      'tax (pkr)',
      'tax deducted',
      'i. tax',
      'itax',
      'deduction tax'
    ],
    {
      reject: (h) =>
        /sales|gst|vat\b|advance\s*tax|minimum\s*tax|surcharge|provident|nssf/i.test(h) &&
        !/income|withhold|paye|wht|deduction\s*tax/i.test(h)
    }
  )
}

/** Load first grid sheet that has Employee ID header (same as salary upload). */
function readPayrollGridRows(buffer, filename = '') {
  const isCsv = /\.csv$/i.test(filename)
  const jsonOpts = { header: 1, defval: '', raw: true, dense: true }
  if (isCsv) {
    let str = (buffer.toString && buffer.toString('utf8')) || String(buffer)
    str = str.replace(/^\uFEFF/, '')
    const wb = XLSX.read(str, { type: 'string', raw: true })
    const sheet = wb.SheetNames[0] ? wb.Sheets[wb.SheetNames[0]] : null
    if (!sheet) throw new Error('CSV file is empty or invalid')
    return XLSX.utils.sheet_to_json(sheet, jsonOpts)
  }
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false })
  if (!wb.SheetNames?.length) throw new Error('Excel file has no sheets')
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name]
    if (!sheet) continue
    const candidate = XLSX.utils.sheet_to_json(sheet, jsonOpts)
    if (findPayrollHeaderRow(candidate) >= 0) return candidate
  }
  throw new Error(
    'Could not find a sheet with Employee ID / Emp Code columns. Use the main payroll grid tab (not only Summary).'
  )
}

/**
 * When Basic / allowance columns are missing: derive monthly gross from Total/Gross column,
 * or from Net + (Income Tax, EOBI, Loan, etc. deduction columns), or Net alone as last resort.
 */
function deriveGrossForStructureFromRow(row, idx) {
  const totalFromSheet = idx.total >= 0 ? parseNum(row[idx.total]) : NaN
  if (Number.isFinite(totalFromSheet) && totalFromSheet > 0) return totalFromSheet

  const netVal = idx.netSalary >= 0 ? parseNum(row[idx.netSalary]) : NaN
  if (!Number.isFinite(netVal) || netVal < 0) return NaN

  let ded = 0
  if (idx.incomeTaxDed >= 0) ded += Math.abs(parseNum(row[idx.incomeTaxDed]) || 0)
  if (idx.loanDed >= 0) ded += Math.abs(parseNum(row[idx.loanDed]) || 0)
  if (idx.salaryAdvanceDed >= 0) ded += Math.abs(parseNum(row[idx.salaryAdvanceDed]) || 0)
  if (idx.otherDeductionForGross >= 0) ded += Math.abs(parseNum(row[idx.otherDeductionForGross]) || 0)
  if (idx.eobi >= 0) ded += Math.abs(parseNum(row[idx.eobi]) || 0)

  const sum = netVal + ded
  if (Number.isFinite(sum) && sum > 0) return sum
  return netVal > 0 ? netVal : NaN
}

/**
 * Upload payroll sheet (CSV or Excel) with title rows: "iTecknologi Payroll - February 2026" style.
 * Finds the row containing "Employee ID", then reads Basic Salary, allowances, etc. and upserts
 * salary structure + gross salary per employee.
 */
export async function uploadPayrollSheetFromFile(buffer, filename = '') {
  const rows = readPayrollGridRows(buffer, filename)

  if (!rows || rows.length < 2) throw new Error('File has no data rows')

  const headerRowIndex = findPayrollHeaderRow(rows)
  if (headerRowIndex < 0) {
    throw new Error(
      'Could not find header row with "Employee ID" or "Emp Code". Ensure your payroll sheet has a header row with Employee ID / Employee Code.'
    )
  }
  // Normalise newlines/spaces so "Over\nTime" and "Over Time" both match
  const headerRow = (rows[headerRowIndex] || []).map((h) =>
    String(h || '')
      .trim()
      .replace(/\s+/g, ' ')
  )
  const getCol = (...patterns) => colIndex(headerRow, patterns)
  const getColGrossTotal = (...patterns) => colIndex(headerRow, patterns, { reject: REJECT_GROSS_TOTAL_COL })

  const idx = {
    employeeId: colIndex(headerRow, [
      /^employee\s*(id|code|no\.?)$/i,
      /employee\s*id/,
      /employee\s*code/,
      /^emp\.?\s*code$/i,
      /^emp\s*code$/i,
      /^staff\s*(id|no\.?)$/i,
      'employee id',
      'employee code'
    ]),
    basic: colIndex(headerRow, ['basic salary', 'basic pay', 'basic'], {
      reject: (h) => /deduction|deduct|tax|adjustment/.test(h)
    }),
    medical: getCol('medical allowance', 'medical allowance', 'medical'),
    conveyance: getCol('fixed conveyance', 'conveyance'),
    conveyanceLiters: getCol('conveyance in liters', 'conveyance liters'),
    communication: getCol('communication'),
    houseRent: getCol('house allow', 'house rent', 'hra', 'house allowance'),
    utilities: getCol('utilities'),
    meal: getCol('meal allowance', 'meal'),
    arrears: getCol('arrears'),
    incrementalArrears: getCol('incremental arrears'),
    bikeMaintenance: getCol('bike maintenance'),
    incentives: getCol('incentives'),
    deviceReimbursement: getCol('device reimbursement'),
    overTime: getCol('overtime', 'over time', /over\s*time/),
    total: getColGrossTotal(
      /^gross\s*total$/i,
      /^total\s*gross$/i,
      /grand\s*total/i,
      /monthly\s*gross/i,
      /^total\s*salary$/i,
      /^gross\s*salary$/i,
      'gross total',
      'total gross',
      'gross',
      'total'
    ),
    netSalary: colIndexNetSalary(headerRow),
    incomeTaxDed: colIndexIncomeTax(headerRow),
    loanDed: getCol('loan'),
    salaryAdvanceDed: getCol('salary advance'),
    otherDeductionForGross: getCol('other deduction'),
    eobi: getCol('eobi')
  }
  if (idx.employeeId < 0) {
    throw new Error('Column "Employee ID" / "Emp Code" not found in header row.')
  }
  if (idx.basic < 0 && idx.total < 0 && idx.netSalary < 0) {
    throw new Error(
      'Sheet has no Basic Salary column. Add either a Gross/Total column or a Net Salary column (optionally with Income Tax, EOBI, Loan columns) so gross can be derived from join-date rules.'
    )
  }

  const added = []
  const errors = []
  const dataStart = headerRowIndex + 1
  const deriveMode = idx.basic < 0

  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i] || []
    const rawId = row[idx.employeeId]
    const codeOrId = normalizeEmployeeCell(rawId)
    if (!codeOrId) continue
    if (/^(total|sub-?total|grand\s*total)$/i.test(codeOrId)) continue

    const employeeId = await repo.getEmployeeIdByCodeOrId(codeOrId)
    if (!employeeId) {
      errors.push({ row: i + 1, message: `Employee not found: ${codeOrId}` })
      continue
    }

    if (deriveMode) {
      const grossSalary = deriveGrossForStructureFromRow(row, idx)
      if (!Number.isFinite(grossSalary) || grossSalary <= 0) {
        errors.push({
          row: i + 1,
          message: `Could not derive gross for ${codeOrId}` + ' (need Total/Gross, or Net + deductions, or Net only)'
        })
        continue
      }
      const joinDate = await repo.getEmployeeJoinDate(employeeId)
      const structure = repo.computeStructureFromGross(grossSalary, joinDate)
      if (!structure) {
        errors.push({ row: i + 1, message: `Could not compute salary structure for ${codeOrId}` })
        continue
      }
      try {
        await repo.upsertGrossSalary(employeeId, grossSalary)
        await repo.upsertSalaryStructure({ employeeId, ...structure })
        added.push({ row: i + 1, employeeId, grossSalary })
      } catch (err) {
        errors.push({ row: i + 1, message: err.message || 'Failed to save' })
      }
      continue
    }

    const basic = idx.basic >= 0 ? parseNum(row[idx.basic]) : 0
    const medical = idx.medical >= 0 ? parseNum(row[idx.medical]) : 0
    const conveyance = idx.conveyance >= 0 ? parseNum(row[idx.conveyance]) : 0
    const conveyanceLiters = idx.conveyanceLiters >= 0 ? parseNum(row[idx.conveyanceLiters]) : 0
    const communication = idx.communication >= 0 ? parseNum(row[idx.communication]) : 0
    const houseRent = idx.houseRent >= 0 ? parseNum(row[idx.houseRent]) : 0
    const utilities = idx.utilities >= 0 ? parseNum(row[idx.utilities]) : 0
    const meal = idx.meal >= 0 ? parseNum(row[idx.meal]) : 0
    const arrears = idx.arrears >= 0 ? parseNum(row[idx.arrears]) : 0
    const incrementalArrears = idx.incrementalArrears >= 0 ? parseNum(row[idx.incrementalArrears]) : 0
    const bikeMaintenance = idx.bikeMaintenance >= 0 ? parseNum(row[idx.bikeMaintenance]) : 0
    const incentives = idx.incentives >= 0 ? parseNum(row[idx.incentives]) : 0
    const deviceReimbursement = idx.deviceReimbursement >= 0 ? parseNum(row[idx.deviceReimbursement]) : 0
    const overTime = idx.overTime >= 0 ? parseNum(row[idx.overTime]) : 0
    const eobiFixed = idx.eobi >= 0 ? parseNum(row[idx.eobi]) : 130
    if (Number.isNaN(basic) || basic < 0) {
      errors.push({ row: i + 1, message: `Invalid or missing Basic Salary for ${codeOrId}` })
      continue
    }

    const totalFromSheet = idx.total >= 0 ? parseNum(row[idx.total]) : NaN
    const sumComponents = basic + medical + conveyance + conveyanceLiters + communication + houseRent + utilities + meal + arrears + incrementalArrears + bikeMaintenance + incentives + deviceReimbursement + (Number.isFinite(overTime) ? overTime : 0)
    const grossSalary = Number.isFinite(totalFromSheet) && totalFromSheet > 0 ? totalFromSheet : sumComponents

    try {
      await repo.upsertGrossSalary(employeeId, grossSalary)
      await repo.upsertSalaryStructure({
        employeeId,
        basicSalary: basic,
        medicalAllowance: medical,
        conveyanceAllowance: conveyance,
        conveyanceLitersAllowance: conveyanceLiters,
        communicationAllowance: communication,
        houseRentAllowance: houseRent,
        utilitiesAllowance: utilities,
        mealAllowance: meal,
        otherAllowance: 0,
        overtimeAllowance: Number.isFinite(overTime) ? overTime : 0,
        arrears,
        incrementalArrears,
        bikeMaintenanceAllowance: bikeMaintenance,
        incentives,
        deviceReimbursement,
        eobiFixed: Number.isFinite(eobiFixed) && eobiFixed >= 0 ? eobiFixed : 130
      })
      added.push({ row: i + 1, employeeId, grossSalary })
    } catch (err) {
      errors.push({ row: i + 1, message: err.message || 'Failed to save' })
    }
  }

  return {
    added: added.length,
    totalRows: rows.length - dataStart,
    errors,
    message: `Payroll sheet imported: ${added.length} employee(s) updated.`
  }
}

export async function listGrossSalaries(search, page = 1, limit = 100) {
  const safeLimit = Math.min(500, Math.max(1, parseInt(limit, 10) || 100))
  const offset = (Math.max(1, parseInt(page, 10) || 1) - 1) * safeLimit
  const searchParam = search && String(search).trim() ? `%${String(search).trim()}%` : ''
  const data = await repo.listGrossSalaries(searchParam, safeLimit, offset)
  const total = await repo.countGrossSalaries(searchParam)
  return {
    data: data.map((r) => ({
      employeeId: r.employee_id,
      employeeName: [r.first_name, r.last_name].filter(Boolean).join(' ') || null,
      employeeCode: r.employee_code,
      grossSalary: parseFloat(r.gross_salary) ?? 0,
      updatedAt: r.updated_at
    })),
    total,
    page: Math.max(1, parseInt(page, 10) || 1),
    limit: safeLimit,
    totalPages: Math.ceil(total / safeLimit) || 1
  }
}

// ---------- Employee search (for Gross Salaries dropdown) ----------
export async function searchEmployees(search, limit = 50) {
  const rows = await repo.searchEmployees(search, limit)
  return { data: rows }
}

function overlapDays(leaveStart, leaveEnd, periodStart, periodEnd) {
  const s = new Date(Math.max(new Date(leaveStart), new Date(periodStart)))
  const e = new Date(Math.min(new Date(leaveEnd), new Date(periodEnd)))
  if (s > e) return 0
  return Math.ceil((e - s) / (24 * 60 * 60 * 1000)) + 1
}

// ---------- Periods ----------
export async function listPeriods(status, page, limit) {
  const offset = (page - 1) * limit
  const total = await repo.countPeriods(status)
  const rows = await repo.listPeriods(status, limit, offset)
  return {
    data: rows.map((r) => ({
      id: r.id,
      name: r.name,
      startDate: r.start_date,
      endDate: r.end_date,
      status: r.status,
      workingDays: r.working_days,
      slipCount: parseInt(r.slip_count, 10) || 0,
      createdAt: r.created_at,
      processedAt: r.processed_at,
      closedAt: r.closed_at
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1
  }
}

/** Returns { hasUnclosed: boolean, unclosedName?: string } for frontend to block new period and show message */
export async function checkUnclosed() {
  const row = await repo.getUnclosedPeriod()
  if (!row) return { hasUnclosed: false }
  return { hasUnclosed: true, unclosedName: row.name }
}

export async function createPeriod(body) {
  const hasUnclosed = await repo.hasUnclosedPeriod()
  if (hasUnclosed) {
    return Promise.reject(new Error('Pehle current payroll period close karein. Jab tak koi period closed nahi hoga, naya period create nahi ho sakta.'))
  }
  const { name, startDate, endDate, workingDays } = body
  const start = new Date(startDate)
  const end = new Date(endDate)
  const days = workingDays != null ? parseInt(workingDays, 10) : 30
  const result = await repo.createPeriod(name, start, end, days)
  return {
    id: result.id,
    name: result.name,
    startDate: result.start_date,
    endDate: result.end_date,
    workingDays: result.working_days,
    status: result.status,
    createdAt: result.created_at
  }
}

export async function getPeriodById(id) {
  const r = await repo.getPeriodById(id)
  if (!r) return null
  return {
    id: r.id,
    name: r.name,
    startDate: r.start_date,
    endDate: r.end_date,
    status: r.status,
    workingDays: r.working_days,
    createdAt: r.created_at,
    processedAt: r.processed_at,
    closedAt: r.closed_at
  }
}

export async function deletePeriod(id) {
  const result = await repo.deletePeriod(id)
  return result ? { id: result.id } : null
}

export async function getOverrides(periodId) {
  const periodRow = await repo.getPeriodById(periodId)
  if (!periodRow) return null
  const defaultDays = parseInt(periodRow.working_days, 10) || 30
  const overrides = await repo.getOverridesByPeriod(periodId)
  const overrideByEmp = new Map(overrides.map((o) => [
    o.employee_id,
    {
      workingDays: parseInt(o.working_days, 10),
      otherAllowance: parseFloat(o.other_allowance) || 0,
      otherDeduction: parseFloat(o.other_deduction) || 0,
      loan: parseFloat(o.loan) || 0,
      salaryAdvance: parseFloat(o.salary_advance) || 0
    }
  ]))
  const employees = await repo.getActiveEmployees()
  return employees.map((e) => {
    const ov = overrideByEmp.get(e.employee_id)
    return {
      employeeId: e.employee_id,
      employeeName: [e.first_name, e.last_name].filter(Boolean).join(' ').trim(),
      employeeCode: e.employee_code,
      workingDays: ov ? ov.workingDays : defaultDays,
      otherAllowance: ov ? ov.otherAllowance : 0,
      otherDeduction: ov ? ov.otherDeduction : 0,
      loan: ov ? ov.loan : 0,
      salaryAdvance: ov ? ov.salaryAdvance : 0,
      isOverride: !!ov
    }
  })
}

export async function saveOverrides(periodId, overridesList) {
  const periodRow = await repo.getPeriodById(periodId)
  if (!periodRow) return null
  if (periodRow.status !== 'draft') {
    return { error: 'Working days can only be set for draft periods' }
  }
  const defaultDays = parseInt(periodRow.working_days, 10) || 30
  await repo.deleteOverridesForPeriod(periodId)
  if (Array.isArray(overridesList) && overridesList.length > 0) {
    for (const item of overridesList) {
      const empId = item.employeeId
      let days = parseInt(item.workingDays, 10)
      if (isNaN(days) || days < 0) days = defaultDays
      const otherAllowance = parseFloat(item.otherAllowance) || 0
      const otherDeduction = parseFloat(item.otherDeduction) || 0
      const loan = parseFloat(item.loan) || 0
      const salaryAdvance = parseFloat(item.salaryAdvance) || 0
      const hasOverride = days !== defaultDays || otherAllowance !== 0 || otherDeduction !== 0 || loan !== 0 || salaryAdvance !== 0
      if (hasOverride) {
        await repo.upsertOverride(periodId, empId, days, otherAllowance, otherDeduction, loan, salaryAdvance)
      }
    }
  }
  return { saved: true }
}

/**
 * Upload period overrides from CSV/Excel (e.g. Allowances Sheet February 2026).
 * Expects columns: Employee Code (or Employee ID), and either "OT PKR" + "PKR amount" (incentives)
 * or "Other Allowance", "Other Deduction", "Loan", "Salary Advance", "Working Days".
 */
export async function uploadPeriodOverridesFromFile(periodId, buffer, filename = '') {
  const periodRow = await repo.getPeriodById(periodId)
  if (!periodRow) return { error: 'Period not found' }
  if (periodRow.status !== 'draft') {
    return { error: 'Overrides can only be uploaded for draft periods' }
  }
  const defaultDays = parseInt(periodRow.working_days, 10) || 30

  const isCsv = /\.csv$/i.test(filename)
  let rows
  if (isCsv) {
    const str = (buffer.toString && buffer.toString('utf8')) || String(buffer)
    const wb = XLSX.read(str, { type: 'string', raw: true })
    const sheet = wb.SheetNames[0] ? wb.Sheets[wb.SheetNames[0]] : null
    if (!sheet) return { error: 'CSV file is empty or invalid' }
    rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
  } else {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false })
    const sheet = wb.SheetNames[0] ? wb.Sheets[wb.SheetNames[0]] : null
    if (!sheet) return { error: 'Excel file has no sheets' }
    rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
  }
  if (!rows || rows.length < 2) return { error: 'File has no data rows' }

  let headerRowIndex = 0
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const row = (rows[r] || []).map((h) => String(h || '').trim().toLowerCase())
    if (row.some((h) => /employee\s*(code|id)/i.test(h))) {
      headerRowIndex = r
      break
    }
  }
  const headerRow = (rows[headerRowIndex] || []).map((h) => String(h || '').trim().toLowerCase())
  const getCol = (...patterns) => {
    for (let c = 0; c < headerRow.length; c++) {
      const h = headerRow[c]
      for (const p of patterns) {
        if (typeof p === 'string' && h.includes(p.toLowerCase())) return c
        if (p instanceof RegExp && p.test(h)) return c
      }
    }
    return -1
  }
  const colEmp = getCol('employee code', 'employee id', 'emp id')
  if (colEmp < 0) return { error: 'Column "Employee Code" or "Employee ID" not found in first row.' }

  const colOtPkr = getCol('ot pkr', 'ot pkr')
  const colPkrAmount = getCol('pkr amount', 'pkramount')
  const colOtherAllowance = getCol('other allowance')
  const colOtherDeduction = getCol('other deduction')
  const colLoan = getCol('loan')
  const colSalaryAdvance = getCol('salary advance')
  const colWorkingDays = getCol('working days', 'wd')

  const added = []
  const errors = []
  const dataStart = headerRowIndex + 1
  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i] || []
    const codeOrId = row[colEmp] != null ? String(row[colEmp]).trim() : ''
    if (!codeOrId) continue

    const employeeId = await repo.getEmployeeIdByCodeOrId(codeOrId)
    if (!employeeId) {
      errors.push({ row: i + 1, message: `Employee not found: ${codeOrId}` })
      continue
    }

    let otherAllowance = 0
    if (colOtPkr >= 0 || colPkrAmount >= 0) {
      otherAllowance = (colOtPkr >= 0 ? parseNum(row[colOtPkr]) : 0) + (colPkrAmount >= 0 ? parseNum(row[colPkrAmount]) : 0)
    } else if (colOtherAllowance >= 0) {
      otherAllowance = parseNum(row[colOtherAllowance])
    }
    const otherDeduction = colOtherDeduction >= 0 ? parseNum(row[colOtherDeduction]) : 0
    const loan = colLoan >= 0 ? parseNum(row[colLoan]) : 0
    const salaryAdvance = colSalaryAdvance >= 0 ? parseNum(row[colSalaryAdvance]) : 0
    let workingDays = defaultDays
    if (colWorkingDays >= 0) {
      const wd = parseInt(String(row[colWorkingDays] || '').trim(), 10)
      if (!Number.isNaN(wd) && wd >= 0) workingDays = wd
    }
    const hasOverride = otherAllowance !== 0 || otherDeduction !== 0 || loan !== 0 || salaryAdvance !== 0 || workingDays !== defaultDays
    if (hasOverride) {
      try {
        await repo.upsertOverride(periodId, employeeId, workingDays, otherAllowance, otherDeduction, loan, salaryAdvance)
        added.push({ row: i + 1, employeeId, otherAllowance, otherDeduction, loan, salaryAdvance })
      } catch (err) {
        errors.push({ row: i + 1, message: err.message || 'Failed to save override' })
      }
    }
  }
  return {
    added: added.length,
    totalRows: rows.length - dataStart,
    errors,
    message: `Overrides uploaded: ${added.length} employee(s) updated for this period.`
  }
}

/**
 * Apply deduction columns from the main payroll CSV/Excel to existing slips for a period.
 * Works for draft or processed periods. Reads: WD, Income Tax, Loan, Salary Advance,
 * Other Deduction, EOBI, Late, Absent (amount in PKR) and updates payroll_slip accordingly.
 * Sheet column "Absent Days/Late Joining" is treated as deduction amount, not day count.
 */
export async function applyPayrollSheetDeductionsToPeriod(periodId, buffer, filename = '') {
  const periodRow = await repo.getPeriodById(periodId)
  if (!periodRow) return { error: 'Period not found' }

  let rows
  try {
    rows = readPayrollGridRows(buffer, filename)
  } catch (e) {
    return { error: e.message || 'Invalid payroll file' }
  }
  if (!rows || rows.length < 2) return { error: 'File has no data rows' }

  const headerRowIndex = findPayrollHeaderRow(rows)
  if (headerRowIndex < 0) {
    return { error: 'Could not find header row containing "Employee ID".' }
  }
  const headerRow = (rows[headerRowIndex] || []).map((h) =>
    String(h || '')
      .trim()
      .replace(/\s+/g, ' ')
  )
  const getCol = (...patterns) => colIndex(headerRow, patterns)
  const getColGrossTotal = (...patterns) => colIndex(headerRow, patterns, { reject: REJECT_GROSS_TOTAL_COL })

  const idx = {
    employeeId: colIndex(headerRow, [
      /^employee\s*(id|code|no\.?)$/i,
      /employee\s*id/,
      /employee\s*code/,
      /^emp\.?\s*code$/i,
      /^emp\s*code$/i,
      /^staff\s*(id|no\.?)$/i,
      'employee id',
      'employee code'
    ]),
    wd: getCol('wd', 'working days'),
    basic: getCol('basic salary', 'basic'),
    medical: getCol('medical allowance', 'medical'),
    conveyance: getCol('fixed conveyance', 'conveyance'),
    conveyanceLiters: getCol('conveyance in liters', 'conveyance liters'),
    communication: getCol('communication'),
    houseRent: getCol('house allow', 'house rent', 'hra'),
    utilities: getCol('utilities'),
    meal: getCol('meal allowance', 'meal'),
    arrears: getCol('arrears'),
    incrementalArrears: getCol('incremental arrears'),
    bikeMaintenance: getCol('bike maintenance'),
    incentives: getCol('incentives'),
    deviceReimbursement: getCol('device reimbursement'),
    otherAllowance: getCol('other allowance'),
    overTime: getCol('overtime', 'over time', /over\s*time/),
    total: getColGrossTotal(
      /^gross\s*total$/i,
      /^total\s*gross$/i,
      /grand\s*total/i,
      /^total\s*salary$/i,
      /^gross\s*salary$/i,
      'gross total',
      'total gross',
      'gross',
      'total'
    ),
    netSalaryPayable: getCol('net salary payable', 'net salary'),
    incomeTax: colIndexIncomeTax(headerRow),
    loan: getCol('loan'),
    salaryAdvance: getCol('salary advance'),
    otherDeduction: getCol('other deduction'),
    eobi: getCol('eobi'),
    late: getCol('late'),
    absentAmount: getCol('absent days', 'absent', 'absent days/'),
    deviceDeduction: getCol('device deduction'),
    cellphoneInstallment: getCol('cellphone installment', 'cellphone'),
    foodpandaDeduction: getCol('foodpanda deduction', 'foodpanda'),
    fuelOverusage: getCol('fuel overusage', 'fuel over'),
    overUtilizationMobile: getCol('over utilization', 'over utilization of mobile', 'mobile')
  }
  if (idx.employeeId < 0) {
    return { error: 'Column "Employee ID" not found in header row.' }
  }

  const updated = []
  const errors = []
  const dataStart = headerRowIndex + 1

  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i] || []
    const codeOrId = normalizeEmployeeCell(row[idx.employeeId])
    if (!codeOrId) continue

    const employeeId = await repo.getEmployeeIdByCodeOrId(codeOrId)
    if (!employeeId) {
      errors.push({ row: i + 1, message: `Employee not found: ${codeOrId}` })
      continue
    }

    let slip = await repo.getSlipByPeriodAndEmployee(periodId, employeeId)

    const wd = idx.wd >= 0 ? parseInt(String(row[idx.wd] || '').trim(), 10) : null
    const workingDays = wd != null && !Number.isNaN(wd) && wd >= 0 ? wd : (slip?.working_days ?? 30)
    // Gross and total_allowances from sheet as-is (Total column)
    const totalFromSheet = idx.total >= 0 ? parseNum(row[idx.total]) : NaN
    const gross = Number.isFinite(totalFromSheet) ? totalFromSheet : (slip ? parseFloat(slip.gross_salary) || 0 : 0)
    const totalAllowancesFromSheet = Number.isFinite(totalFromSheet) ? totalFromSheet : null

    const eobiDeduction = idx.eobi >= 0 ? Math.abs(parseNum(row[idx.eobi]) || 0) : (slip?.eobi_deduction ?? 0)
    // Income tax: only from sheet column — no slab auto-calc; if column missing, 0
    const incomeTax = idx.incomeTax >= 0 ? Math.abs(parseNum(row[idx.incomeTax]) || 0) : 0
    const loan = idx.loan >= 0 ? Math.abs(parseNum(row[idx.loan]) || 0) : 0
    const salaryAdvance = idx.salaryAdvance >= 0 ? Math.abs(parseNum(row[idx.salaryAdvance]) || 0) : 0
    const otherDeductionCol = idx.otherDeduction >= 0 ? Math.abs(parseNum(row[idx.otherDeduction]) || 0) : 0
    const late = idx.late >= 0 ? Math.abs(parseNum(row[idx.late]) || 0) : 0
    const deviceDed = idx.deviceDeduction >= 0 ? Math.abs(parseNum(row[idx.deviceDeduction]) || 0) : 0
    const cellphoneInst = idx.cellphoneInstallment >= 0 ? Math.abs(parseNum(row[idx.cellphoneInstallment]) || 0) : 0
    const foodpanda = idx.foodpandaDeduction >= 0 ? Math.abs(parseNum(row[idx.foodpandaDeduction]) || 0) : 0
    const fuelOver = idx.fuelOverusage >= 0 ? Math.abs(parseNum(row[idx.fuelOverusage]) || 0) : 0
    const overUtilMobile = idx.overUtilizationMobile >= 0 ? Math.abs(parseNum(row[idx.overUtilizationMobile]) || 0) : 0
    const otherDeduction = otherDeductionCol

    const absentDeduction =
      idx.absentAmount >= 0 ? Math.abs(parseNum(row[idx.absentAmount]) || 0) : (slip?.absent_deduction ?? 0)
    const effectiveWd = (workingDays ?? 0) > 0 ? workingDays : 1
    const dayRate = effectiveWd > 0 && gross > 0 ? gross / effectiveWd : 0
    const absentDaysComputed =
      dayRate > 0 && absentDeduction > 0 ? absentDeduction / dayRate : (slip?.absent_days ?? 0)
    const absentDays = Number.isFinite(absentDaysComputed) ? Math.round(absentDaysComputed) : 0
    const paidDays = Math.max(0, (workingDays ?? 0) - absentDays)

    const totalDeductions =
      (eobiDeduction || 0) + (absentDeduction || 0) + (otherDeduction || 0) + (incomeTax || 0) +
      (loan || 0) + (salaryAdvance || 0) + (late || 0) + (deviceDed || 0) + (cellphoneInst || 0) +
      (foodpanda || 0) + (fuelOver || 0) + (overUtilMobile || 0)
    const netFromSheet = idx.netSalaryPayable >= 0 ? parseNum(row[idx.netSalaryPayable]) : NaN
    const netSalary = Number.isFinite(netFromSheet) ? Math.round(netFromSheet * 100) / 100 : Math.round((gross - totalDeductions) * 100) / 100

    // If no slip exists for this period+employee, create one from sheet (sheet-only payroll flow)
    if (!slip) {
      try {
        await repo.upsertPayrollSlip({
          periodId,
          employeeId,
          workingDays: workingDays ?? 30,
          paidDays,
          absentDays,
          grossSalary: gross,
          totalAllowances: totalAllowancesFromSheet ?? gross,
          totalDeductions,
          netSalary,
          eobiDeduction,
          absentDeduction,
          otherDeduction,
          otherAllowance: 0,
          incomeTax
        })
        slip = await repo.getSlipByPeriodAndEmployee(periodId, employeeId)
      } catch (err) {
        errors.push({ row: i + 1, message: `Could not create slip: ${err.message || 'Unknown error'}` })
        continue
      }
    }
    if (!slip) {
      errors.push({ row: i + 1, message: `Slip not found after create: ${codeOrId}` })
      continue
    }

    try {
      await repo.updatePayrollSlipDeductions(slip.id, {
        working_days: workingDays,
        paid_days: paidDays,
        absent_days: absentDays,
        gross_salary: totalAllowancesFromSheet ?? undefined,
        total_allowances: totalAllowancesFromSheet ?? undefined,
        eobi_deduction: eobiDeduction,
        absent_deduction: absentDeduction,
        other_deduction: otherDeduction,
        income_tax: incomeTax,
        loan_deduction: loan,
        salary_advance_deduction: salaryAdvance,
        late_deduction: late,
        device_deduction: deviceDed,
        cellphone_installment_deduction: cellphoneInst,
        foodpanda_deduction: foodpanda,
        fuel_overusage_deduction: fuelOver,
        over_utilization_mobile_deduction: overUtilMobile,
        total_deductions: totalDeductions,
        net_salary: netSalary
      })
      updated.push({ row: i + 1, employeeId, netSalary })

      // Update salary structure from sheet as-is: use sheet value when column present, else keep existing
      const existingStructure = await repo.getSalaryStructureByEmployee(employeeId)
      const n = (v, def) => (v != null && !Number.isNaN(parseFloat(v))) ? parseFloat(v) : def
      const fromSheet = (colIdx, existingVal, def = 0) =>
        (colIdx >= 0 && Number.isFinite(parseNum(row[colIdx]))) ? parseNum(row[colIdx]) : (existingStructure ? n(existingVal, def) : def)
      const payload = {
        employeeId,
        basicSalary: fromSheet(idx.basic, existingStructure?.basic_salary),
        medicalAllowance: fromSheet(idx.medical, existingStructure?.medical_allowance),
        conveyanceAllowance: fromSheet(idx.conveyance, existingStructure?.conveyance_allowance),
        conveyanceLitersAllowance: fromSheet(idx.conveyanceLiters, existingStructure?.conveyance_liters_allowance),
        communicationAllowance: fromSheet(idx.communication, existingStructure?.communication_allowance),
        houseRentAllowance: fromSheet(idx.houseRent, existingStructure?.house_rent_allowance),
        utilitiesAllowance: fromSheet(idx.utilities, existingStructure?.utilities_allowance),
        mealAllowance: fromSheet(idx.meal, existingStructure?.meal_allowance),
        otherAllowance: fromSheet(idx.otherAllowance, existingStructure?.other_allowance),
        overtimeAllowance: fromSheet(idx.overTime, existingStructure?.overtime_allowance),
        arrears: fromSheet(idx.arrears, existingStructure?.arrears),
        incrementalArrears: fromSheet(idx.incrementalArrears, existingStructure?.incremental_arrears),
        bikeMaintenanceAllowance: fromSheet(idx.bikeMaintenance, existingStructure?.bike_maintenance_allowance),
        incentives: fromSheet(idx.incentives, existingStructure?.incentives),
        deviceReimbursement: fromSheet(idx.deviceReimbursement, existingStructure?.device_reimbursement),
        eobiFixed: existingStructure ? n(existingStructure.eobi_fixed, 130) : 130
      }
      await repo.upsertSalaryStructure(payload).catch(() => {})
    } catch (err) {
      errors.push({ row: i + 1, message: err.message || 'Failed to update slip' })
    }
  }

  return {
    updated: updated.length,
    totalRows: rows.length - dataStart,
    errors,
    message: `Sheet applied: ${updated.length} slip(s) updated. Income Tax and other deductions match the sheet (not auto-calculated).`
  }
}

export async function runPayroll(periodId) {
  const period = await repo.getPeriodForRun(periodId)
  if (!period) return { error: 'not_found' }
  if (period.status !== 'draft') {
    return { error: 'Only draft periods can be run. Current status: ' + period.status }
  }
  const startDate = period.start_date
  const endDate = period.end_date
  const workingDays = Math.max(1, parseInt(period.working_days, 10) || 30)

  await repo.setPeriodProcessing(periodId)

  const employees = await repo.getEmployeesForPayroll()
  const designationAllowances = await repo.getDesignationAllowances()
  const desgAllowanceMap = new Map(designationAllowances.map((d) => [d.desg_id, parseFloat(d.fixed_allowance) || 0]))
  const structures = await repo.getSalaryStructures()
  const structMap = new Map(structures.map((s) => [s.employee_id, s]))
  const approvedLeaves = await repo.getApprovedLeavesInRange(startDate, endDate)
  const overrides = await repo.getOverridesForRun(periodId)
  const overrideMap = new Map(overrides.map((o) => [
    o.employee_id,
    {
      workingDays: parseInt(o.working_days, 10),
      otherAllowance: parseFloat(o.other_allowance) || 0,
      otherDeduction: parseFloat(o.other_deduction) || 0,
      loan: parseFloat(o.loan) || 0,
      salaryAdvance: parseFloat(o.salary_advance) || 0
    }
  ]))

  let inserted = 0
  for (const emp of employees) {
    const eid = emp.employee_id
    const override = overrideMap.get(eid)
    const empWorkingDays = override ? override.workingDays : workingDays
    const empWorkingDaysClamped = Math.max(1, Math.min(empWorkingDays, workingDays))
    const periodOtherAllowance = override ? override.otherAllowance : 0
    const periodOtherDeduction = override ? override.otherDeduction : 0
    const periodLoan = override ? override.loan : 0
    const periodSalaryAdvance = override ? override.salaryAdvance : 0

    const struct = structMap.get(eid) || {}
    const basic = parseFloat(struct.basic_salary) || 0
    const medical = parseFloat(struct.medical_allowance) || 0
    const conveyance = parseFloat(struct.conveyance_allowance) || 0
    const conveyanceLiters = parseFloat(struct.conveyance_liters_allowance) || 0
    const communication = parseFloat(struct.communication_allowance) || 0
    const hra = parseFloat(struct.house_rent_allowance) || 0
    const utilities = parseFloat(struct.utilities_allowance) || 0
    const meal = parseFloat(struct.meal_allowance) || 0
    const otherAll = parseFloat(struct.other_allowance) || 0
    const arrears = parseFloat(struct.arrears) || 0
    const incrementalArrears = parseFloat(struct.incremental_arrears) || 0
    const bikeMaintenance = parseFloat(struct.bike_maintenance_allowance) || 0
    const incentives = parseFloat(struct.incentives) || 0
    const deviceReimb = parseFloat(struct.device_reimbursement) || 0
    const desgFixed = emp.designation_id ? (desgAllowanceMap.get(emp.designation_id) || 0) : 0
    const eobiFixed = parseFloat(struct.eobi_fixed) || 130

    let absentDays = 0
    for (const lv of approvedLeaves.filter((l) => l.employee_id === eid)) {
      absentDays += overlapDays(lv.start_date, lv.end_date, startDate, endDate)
    }
    absentDays = Math.min(absentDays, empWorkingDaysClamped)
    const paidDays = Math.max(0, empWorkingDaysClamped - absentDays)

    const totalAllowances = medical + conveyance + conveyanceLiters + communication + hra + utilities + meal + otherAll + arrears + incrementalArrears + bikeMaintenance + incentives + deviceReimb + desgFixed + periodOtherAllowance
    const grossSalary = (basic + totalAllowances) * (paidDays / empWorkingDaysClamped)
    const eobiDeduction = eobiFixed
    const absentDeduction = (basic + (medical + conveyance + conveyanceLiters + communication + hra + utilities + meal + otherAll + arrears + incrementalArrears + bikeMaintenance + incentives + deviceReimb + desgFixed + periodOtherAllowance)) * (absentDays / empWorkingDaysClamped)
    // Income tax is not auto-calculated from tax slabs. Slips show 0 until you apply deductions from
    // the payroll sheet (Income Tax column) or set amounts manually on slips.
    const incomeTaxMonthly = 0
    const totalDeductions = eobiDeduction + absentDeduction + periodOtherDeduction + periodLoan + periodSalaryAdvance + incomeTaxMonthly
    const netSalary = Math.max(0, grossSalary - totalDeductions)

    await repo.upsertPayrollSlip({
      periodId,
      employeeId: eid,
      workingDays: empWorkingDaysClamped,
      paidDays,
      absentDays,
      grossSalary,
      totalAllowances,
      totalDeductions,
      netSalary,
      eobiDeduction,
      absentDeduction,
      otherDeduction: periodOtherDeduction,
      otherAllowance: periodOtherAllowance,
      incomeTax: incomeTaxMonthly
    })
    inserted++
  }

  await repo.setPeriodProcessed(periodId)
  return {
    periodId: parseInt(periodId, 10),
    employeesProcessed: inserted,
    workingDays,
    status: 'processed'
  }
}

export async function closePeriod(id) {
  const period = await repo.getPeriodById(id)
  if (!period) return null
  if (period.status === 'closed') return null
  let employeesProcessed = null
  if (period.status === 'draft') {
    try {
      const runResult = await runPayroll(id)
      if (runResult.error === 'not_found') return null
      if (runResult.error) throw new Error(runResult.error)
      employeesProcessed = runResult.employeesProcessed
    } catch (err) {
      await repo.setPeriodDraft(id).catch(() => {})
      throw err
    }
  }
  const result = await repo.closePeriod(id)
  if (!result) return null
  return { id: result.id, employeesProcessed }
}

// ---------- Slips ----------
export async function listSlips(periodId, search, page, limit) {
  const searchParam = search ? `%${search}%` : null
  const offset = (page - 1) * limit
  const total = await repo.countSlips(periodId, searchParam)
  const rows = await repo.listSlips(periodId, searchParam, limit, offset)
  return {
    data: rows.map((r) => ({
      id: r.id,
      employeeId: r.employee_id,
      employeeName: [r.first_name, r.last_name].filter(Boolean).join(' ').trim(),
      employeeCode: r.employee_code,
      workingDays: r.working_days,
      paidDays: r.paid_days,
      absentDays: r.absent_days,
      grossSalary: parseFloat(r.gross_salary),
      totalAllowances: parseFloat(r.total_allowances),
      totalDeductions: parseFloat(r.total_deductions),
      netSalary: parseFloat(r.net_salary),
      incomeTax: parseFloat(r.income_tax) || 0,
      status: r.status,
      remarks: r.remarks,
      slipOnHold: !!r.slip_on_hold
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1
  }
}

/** Per slip: hide/show this month on employee Salary Slip page. */
export async function setSlipHold(periodId, slipId, slipOnHold) {
  const r = await repo.setPayrollSlipHold(periodId, slipId, slipOnHold)
  if (r.missingColumn) return { error: 'migration_required' }
  if (!r.ok) return { error: 'not_found' }
  return { ok: true }
}

/** All slips in this period: hold or release for employees’ Salary Slip view. */
export async function holdAllSlipsInPeriod(periodId, slipOnHold) {
  const r = await repo.setAllPayrollSlipsHoldForPeriod(periodId, slipOnHold)
  if (r.missingColumn) return { error: 'migration_required' }
  if (!r.ok) return { error: 'failed' }
  return { ok: true }
}

// ---------- Income tax slabs ----------
export async function listTaxSlabVersions() {
  const rows = await repo.listTaxSlabVersions()
  return rows.map((r) => ({
    id: r.id,
    versionName: r.version_name,
    effectiveFrom: r.effective_from,
    isActive: !!r.is_active,
    createdAt: r.created_at
  }))
}

export async function getActiveTaxSlabsForApi() {
  const version = await repo.getActiveTaxSlabVersion()
  const slabs = await repo.getActiveTaxSlabs()
  return {
    activeVersion: version ? { id: version.id, versionName: version.version_name } : null,
    slabs: slabs.map((s) => ({
      id: s.id,
      minAmt: parseFloat(s.min_amt),
      maxAmt: parseFloat(s.max_amt),
      taxableAmt: parseFloat(s.taxable_amt),
      taxPercent: parseFloat(s.tax_percent),
      displayOrder: s.display_order
    }))
  }
}

export async function getTaxSlabVersionWithSlabs(versionId) {
  const row = await repo.getTaxSlabVersionWithSlabs(versionId)
  if (!row) return null
  return {
    id: row.id,
    versionName: row.version_name,
    effectiveFrom: row.effective_from,
    isActive: !!row.is_active,
    createdAt: row.created_at,
    slabs: (row.slabs || []).map((s) => ({
      id: s.id,
      minAmt: parseFloat(s.min_amt),
      maxAmt: parseFloat(s.max_amt),
      taxableAmt: parseFloat(s.taxable_amt),
      taxPercent: parseFloat(s.tax_percent),
      displayOrder: s.display_order
    }))
  }
}

export async function createTaxSlabVersionWithSlabs(body) {
  const { versionName, effectiveFrom, slabs } = body
  if (!versionName || !String(versionName).trim()) return { error: 'versionName is required' }
  if (!Array.isArray(slabs) || slabs.length === 0) return { error: 'At least one slab row is required' }
  const version = await repo.createTaxSlabVersion(versionName.trim(), effectiveFrom || null)
  let order = 0
  for (const s of slabs) {
    const minAmt = parseFloat(s.minAmt) ?? 0
    const maxAmt = parseFloat(s.maxAmt) ?? 0
    const taxableAmt = parseFloat(s.taxableAmt) ?? 0
    const taxPercent = parseFloat(s.taxPercent) ?? 0
    await repo.insertTaxSlab(version.id, minAmt, maxAmt, taxableAmt, taxPercent, ++order)
  }
  return { id: version.id, versionName: version.version_name, slabsCount: slabs.length }
}

export async function setActiveTaxSlabVersion(versionId) {
  await repo.setActiveTaxSlabVersion(versionId)
  return { ok: true }
}

export async function deleteTaxSlabVersion(versionId) {
  const row = await repo.deleteTaxSlabVersion(versionId)
  return row ? { deleted: row.id } : null
}

// ---------- Designation allowances ----------
export async function listDesignationAllowances() {
  const rows = await repo.listDesignationAllowances()
  return rows.map((r) => ({
    desgId: r.desg_id,
    desgName: r.desg_name,
    fixedAllowance: parseFloat(r.fixed_allowance) || 0
  }))
}

export async function saveDesignationAllowances(allowances) {
  if (!Array.isArray(allowances)) return { error: 'allowances array is required' }
  for (const item of allowances) {
    const desgId = parseInt(item.desgId, 10)
    const fixedAllowance = parseFloat(item.fixedAllowance) || 0
    if (isNaN(desgId) || desgId < 1) continue
    await repo.upsertDesignationAllowance(desgId, fixedAllowance)
  }
  return { saved: true }
}

// ---------- Salary structures ----------
export async function listSalaryStructures(search, page, limit) {
  const searchParam = search ? `%${search}%` : null
  const offset = (page - 1) * limit
  const total = await repo.countActiveEmployees(searchParam)
  const rows = await repo.listSalaryStructures(searchParam, limit, offset)
  const num = (v) => (v != null && v !== '') ? parseFloat(v) : null
  return {
    data: rows.map((r) => ({
      id: r.structure_id,
      employeeId: r.employee_id,
      employeeName: [r.first_name, r.last_name].filter(Boolean).join(' ').trim(),
      employeeCode: r.employee_code,
      basicSalary: num(r.basic_salary),
      medicalAllowance: num(r.medical_allowance),
      conveyanceAllowance: num(r.conveyance_allowance),
      conveyanceLitersAllowance: num(r.conveyance_liters_allowance),
      communicationAllowance: num(r.communication_allowance),
      houseRentAllowance: num(r.house_rent_allowance),
      utilitiesAllowance: num(r.utilities_allowance),
      mealAllowance: num(r.meal_allowance),
      otherAllowance: num(r.other_allowance),
      overtimeAllowance: num(r.overtime_allowance),
      arrears: num(r.arrears),
      incrementalArrears: num(r.incremental_arrears),
      bikeMaintenanceAllowance: num(r.bike_maintenance_allowance),
      incentives: num(r.incentives),
      deviceReimbursement: num(r.device_reimbursement),
      eobiFixed: num(r.eobi_fixed),
      effectiveFrom: r.effective_from
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1
  }
}

const mapStructureRow = (r) => {
  const num = (v) => (v != null && v !== '') ? parseFloat(v) : null
  return {
    id: r.id,
    employeeId: r.employee_id,
    basicSalary: num(r.basic_salary),
    medicalAllowance: num(r.medical_allowance),
    conveyanceAllowance: num(r.conveyance_allowance),
    conveyanceLitersAllowance: num(r.conveyance_liters_allowance),
    communicationAllowance: num(r.communication_allowance),
    houseRentAllowance: num(r.house_rent_allowance),
    utilitiesAllowance: num(r.utilities_allowance),
    mealAllowance: num(r.meal_allowance),
    otherAllowance: num(r.other_allowance),
    overtimeAllowance: num(r.overtime_allowance),
    arrears: num(r.arrears),
    incrementalArrears: num(r.incremental_arrears),
    bikeMaintenanceAllowance: num(r.bike_maintenance_allowance),
    incentives: num(r.incentives),
    deviceReimbursement: num(r.device_reimbursement),
    eobiFixed: num(r.eobi_fixed),
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to
  }
}

export async function getSalaryStructureByEmployee(employeeId) {
  const r = await repo.getSalaryStructureByEmployee(employeeId)
  if (!r) return null
  return mapStructureRow(r)
}

export async function saveSalaryStructure(body) {
  const n = (v) => parseFloat(v) || 0
  const payload = {
    employeeId: body.employeeId,
    basicSalary: n(body.basicSalary),
    medicalAllowance: n(body.medicalAllowance),
    conveyanceAllowance: n(body.conveyanceAllowance),
    conveyanceLitersAllowance: n(body.conveyanceLitersAllowance),
    communicationAllowance: n(body.communicationAllowance),
    houseRentAllowance: n(body.houseRentAllowance),
    utilitiesAllowance: n(body.utilitiesAllowance),
    mealAllowance: n(body.mealAllowance),
    otherAllowance: n(body.otherAllowance),
    overtimeAllowance: n(body.overtimeAllowance),
    arrears: n(body.arrears),
    incrementalArrears: n(body.incrementalArrears),
    bikeMaintenanceAllowance: n(body.bikeMaintenanceAllowance),
    incentives: n(body.incentives),
    deviceReimbursement: n(body.deviceReimbursement),
    eobiFixed: n(body.eobiFixed) || 130
  }
  const out = await repo.upsertSalaryStructure(payload)
  const r = out[0]
  return mapStructureRow(r)
}
