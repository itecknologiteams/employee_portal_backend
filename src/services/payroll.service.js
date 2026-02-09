import * as repo from '../repositories/payroll.repository.js'

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
      otherDeduction: parseFloat(o.other_deduction) || 0
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
      const hasOverride = days !== defaultDays || otherAllowance !== 0 || otherDeduction !== 0
      if (hasOverride) {
        await repo.upsertOverride(periodId, empId, days, otherAllowance, otherDeduction)
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
      otherDeduction: parseFloat(o.other_deduction) || 0
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

    const struct = structMap.get(eid) || {}
    const basic = parseFloat(struct.basic_salary) || 0
    const medical = parseFloat(struct.medical_allowance) || 0
    const conveyance = parseFloat(struct.conveyance_allowance) || 0
    const hra = parseFloat(struct.house_rent_allowance) || 0
    const utilities = parseFloat(struct.utilities_allowance) || 0
    const meal = parseFloat(struct.meal_allowance) || 0
    const otherAll = parseFloat(struct.other_allowance) || 0
    const desgFixed = emp.designation_id ? (desgAllowanceMap.get(emp.designation_id) || 0) : 0
    const eobiFixed = parseFloat(struct.eobi_fixed) || 130

    let absentDays = 0
    for (const lv of approvedLeaves.filter((l) => l.employee_id === eid)) {
      absentDays += overlapDays(lv.start_date, lv.end_date, startDate, endDate)
    }
    absentDays = Math.min(absentDays, empWorkingDaysClamped)
    const paidDays = Math.max(0, empWorkingDaysClamped - absentDays)

    const totalAllowances = medical + conveyance + hra + utilities + meal + otherAll + desgFixed + periodOtherAllowance
    const grossSalary = (basic + totalAllowances) * (paidDays / empWorkingDaysClamped)
    const eobiDeduction = eobiFixed
    const absentDeduction = (basic + (medical + conveyance + hra + utilities + meal + otherAll + desgFixed + periodOtherAllowance)) * (absentDays / empWorkingDaysClamped)
    const totalDeductions = eobiDeduction + absentDeduction + periodOtherDeduction
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
  return {
    data: rows.map((r) => ({
      id: r.structure_id,
      employeeId: r.employee_id,
      employeeName: [r.first_name, r.last_name].filter(Boolean).join(' ').trim(),
      employeeCode: r.employee_code,
      basicSalary: r.basic_salary != null ? parseFloat(r.basic_salary) : null,
      medicalAllowance: r.medical_allowance != null ? parseFloat(r.medical_allowance) : null,
      conveyanceAllowance: r.conveyance_allowance != null ? parseFloat(r.conveyance_allowance) : null,
      houseRentAllowance: r.house_rent_allowance != null ? parseFloat(r.house_rent_allowance) : null,
      utilitiesAllowance: r.utilities_allowance != null ? parseFloat(r.utilities_allowance) : null,
      mealAllowance: r.meal_allowance != null ? parseFloat(r.meal_allowance) : null,
      otherAllowance: r.other_allowance != null ? parseFloat(r.other_allowance) : null,
      eobiFixed: r.eobi_fixed != null ? parseFloat(r.eobi_fixed) : null,
      effectiveFrom: r.effective_from
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1
  }
}

export async function getSalaryStructureByEmployee(employeeId) {
  const r = await repo.getSalaryStructureByEmployee(employeeId)
  if (!r) return null
  return {
    id: r.id,
    employeeId: r.employee_id,
    basicSalary: parseFloat(r.basic_salary),
    medicalAllowance: parseFloat(r.medical_allowance),
    conveyanceAllowance: parseFloat(r.conveyance_allowance),
    houseRentAllowance: parseFloat(r.house_rent_allowance),
    utilitiesAllowance: parseFloat(r.utilities_allowance),
    mealAllowance: parseFloat(r.meal_allowance),
    otherAllowance: parseFloat(r.other_allowance),
    eobiFixed: parseFloat(r.eobi_fixed),
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to
  }
}

export async function saveSalaryStructure(body) {
  const {
    employeeId,
    basicSalary,
    medicalAllowance,
    conveyanceAllowance,
    houseRentAllowance,
    utilitiesAllowance,
    mealAllowance,
    otherAllowance,
    eobiFixed
  } = body
  const basic = parseFloat(basicSalary) || 0
  const medical = parseFloat(medicalAllowance) || 0
  const conveyance = parseFloat(conveyanceAllowance) || 0
  const hra = parseFloat(houseRentAllowance) || 0
  const utilities = parseFloat(utilitiesAllowance) || 0
  const meal = parseFloat(mealAllowance) || 0
  const other = parseFloat(otherAllowance) || 0
  const eobi = parseFloat(eobiFixed) || 130
  const out = await repo.upsertSalaryStructure({
    employeeId,
    basicSalary: basic,
    medicalAllowance: medical,
    conveyanceAllowance: conveyance,
    houseRentAllowance: hra,
    utilitiesAllowance: utilities,
    mealAllowance: meal,
    otherAllowance: other,
    eobiFixed: eobi
  })
  const r = out[0]
  return {
    id: r.id,
    employeeId: r.employee_id,
    basicSalary: parseFloat(r.basic_salary),
    medicalAllowance: parseFloat(r.medical_allowance),
    conveyanceAllowance: parseFloat(r.conveyance_allowance),
    houseRentAllowance: parseFloat(r.house_rent_allowance),
    utilitiesAllowance: parseFloat(r.utilities_allowance),
    mealAllowance: parseFloat(r.meal_allowance),
    otherAllowance: parseFloat(r.other_allowance),
    eobiFixed: parseFloat(r.eobi_fixed)
  }
}
