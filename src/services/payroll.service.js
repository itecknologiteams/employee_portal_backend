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
    message: 'Gross salary saved; structure updated from join-date rules.'
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

export async function createPeriod(body) {
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
    const totalDeductions = eobiDeduction + absentDeduction + periodOtherDeduction + periodLoan + periodSalaryAdvance
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
      otherAllowance: periodOtherAllowance
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
  const result = await repo.closePeriod(id)
  return result ? { id: result.id } : null
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
      status: r.status,
      remarks: r.remarks
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1
  }
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
