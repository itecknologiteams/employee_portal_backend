import bcrypt from 'bcryptjs'
import * as salaryRepo from '../repositories/salary.repository.js'

function monthLabelFromDate(date) {
  return date ? new Date(date).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : null
}

/** List all salary slips for employee: payroll_slip, then old_salary_slip, then legacy. Id format: "p-123", "o-456", "s-789". */
export async function listSlips(employeeId, options = {}) {
  const onHold = await salaryRepo.isSalarySlipOnHold(employeeId)
  if (onHold && !options.bypassHold) {
    return { slips: [], salarySlipOnHold: true }
  }

  const result = []

  const payrollSlips = await salaryRepo.listPayrollSlipsForEmployee(employeeId, {
    excludeHeldSlips: !options.bypassHold
  })
  payrollSlips.forEach((row) => {
    const monthLabel = row.period_name || monthLabelFromDate(row.start_date) || 'Payroll'
    result.push({
      id: `p-${row.id}`,
      source: 'payroll',
      payrollId: row.payroll_period_id,
      month: monthLabel,
      payMonth: row.start_date || null,
      grossSalary: parseFloat(row.gross_salary ?? 0),
      allowances: parseFloat(row.total_allowances ?? 0),
      deductions: parseFloat(row.total_deductions ?? 0),
      netSalary: parseFloat(row.net_salary ?? 0),
      status: row.status || 'Generated',
      remarks: row.remarks || ''
    })
  })

  const oldSlips = await salaryRepo.listOldSlipsForEmployee(employeeId)
  oldSlips.forEach((row) => {
    const monthLabel = row.period_label || monthLabelFromDate(row.pay_month) || 'Old slip'
    result.push({
      id: `o-${row.id}`,
      source: 'old',
      payrollId: null,
      month: monthLabel,
      payMonth: row.pay_month || null,
      grossSalary: parseFloat(row.gross_salary ?? 0),
      allowances: parseFloat(row.total_allowances ?? 0),
      deductions: parseFloat(row.total_deductions ?? 0),
      netSalary: parseFloat(row.net_salary ?? 0),
      status: row.status || 'Paid',
      remarks: row.remarks || ''
    })
  })

  const hrIds = await salaryRepo.getHrEmpIdsForEmployee(employeeId)
  const legacySlips = await salaryRepo.listLegacySlipsForEmployee(hrIds)
  legacySlips.forEach((row) => {
    const monthLabel = row.payroll_label || monthLabelFromDate(row.pay_month) || `Payroll #${row.payroll_id}`
    result.push({
      id: `s-${row.id}`,
      source: 'legacy',
      payrollId: row.payroll_id,
      month: monthLabel,
      payMonth: row.pay_month || null,
      grossSalary: parseFloat(row.tot_gross_salary ?? row.gross_salary ?? 0),
      allowances: parseFloat(row.tot_allowances ?? 0),
      deductions: parseFloat(row.tot_deductions ?? 0),
      netSalary: parseFloat(row.tot_net_salary ?? 0),
      status: row.salary_status || '—',
      remarks: row.remarks || ''
    })
  })

  result.sort((a, b) => {
    const da = a.payMonth ? new Date(a.payMonth) : new Date(0)
    const db = b.payMonth ? new Date(b.payMonth) : new Date(0)
    return db - da
  })
  return { slips: result, salarySlipOnHold: false }
}

/** List only old (imported) salary slips for an employee. For the "Old salary slips" tab. */
export async function listOldSlipsOnly(employeeId, options = {}) {
  const onHold = await salaryRepo.isSalarySlipOnHold(employeeId)
  if (onHold && !options.bypassHold) {
    return { slips: [], salarySlipOnHold: true }
  }

  const oldSlips = await salaryRepo.listOldSlipsForEmployee(employeeId)
  const slips = oldSlips.map((row) => {
    const monthLabel = row.period_label || monthLabelFromDate(row.pay_month) || 'Old slip'
    return {
      id: row.id,
      slipId: `o-${row.id}`,
      source: 'old',
      payrollId: null,
      month: monthLabel,
      payMonth: row.pay_month || null,
      grossSalary: parseFloat(row.gross_salary ?? 0),
      allowances: parseFloat(row.total_allowances ?? 0),
      deductions: parseFloat(row.total_deductions ?? 0),
      netSalary: parseFloat(row.net_salary ?? 0),
      status: row.status || 'Paid',
      remarks: row.remarks || ''
    }
  })
  return { slips, salarySlipOnHold: false }
}

/** Get one old slip by numeric id (for GET /old-slip/:id). Same shape as getSlipById for old slips. */
export async function getOldSlipById(id, employeeId, options = {}) {
  return getSlipById(`o-${id}`, employeeId, options)
}

/** Get one slip by id ("p-123", "o-456", or "s-789") with employeeId for auth. */
export async function getSlipById(rawId, employeeId, options = {}) {
  const onHold = await salaryRepo.isSalarySlipOnHold(employeeId)
  if (onHold && !options.bypassHold) return null

  const isPayroll = String(rawId).startsWith('p-')
  const isOld = String(rawId).startsWith('o-')
  const numericId = isPayroll ? String(rawId).replace(/^p-/, '') : isOld ? String(rawId).replace(/^o-/, '') : String(rawId).replace(/^s-/, '')

  if (isPayroll) {
    const slip = await salaryRepo.getPayrollSlipById(numericId, employeeId)
    if (!slip) return null
    const held = slip.slip_on_hold === true || slip.slip_on_hold === 't'
    if (held && !options.bypassHold) return null
    const emp = await salaryRepo.getEmployeeBasicInfo(employeeId)
    const structure = await salaryRepo.getEmployeeSalaryStructure(employeeId)
    const monthLabel = slip.period_name || monthLabelFromDate(slip.pay_month) || 'Payroll'
    const name = emp ? [emp.first_name, emp.last_name].filter(Boolean).join(' ').trim() : '—'
    const gross = parseFloat(slip.gross_salary ?? 0)
    const totAll = parseFloat(slip.total_allowances ?? 0)
    const totDed = parseFloat(slip.total_deductions ?? 0)
    const net = parseFloat(slip.net_salary ?? 0)
    const eobi = parseFloat(slip.eobi_deduction ?? 0)
    const absentDed = parseFloat(slip.absent_deduction ?? 0)
    const otherDed = parseFloat(slip.other_deduction ?? 0)
    const otherAll = parseFloat(slip.other_allowance ?? 0)
    const incomeTax = (slip.income_tax != null && slip.income_tax !== '') ? (parseFloat(slip.income_tax) || 0) : 0
    const f = (v) => (v != null && v !== '' && !Number.isNaN(parseFloat(v))) ? parseFloat(v) : 0
    const basicVal = structure ? f(structure.basic_salary) : gross
    const medicalVal = structure ? f(structure.medical_allowance) : 0
    const conveyanceVal = structure ? f(structure.conveyance_allowance) : 0
    const houseRentVal = structure ? f(structure.house_rent_allowance) : 0
    const utilitiesVal = structure ? f(structure.utilities_allowance) : 0
    const mealVal = structure ? f(structure.meal_allowance) : 0
    const arrearsVal = structure ? f(structure.arrears) : 0
    const bikeVal = structure ? f(structure.bike_maintenance_allowance) : 0
    const incentivesVal = structure ? f(structure.incentives) : 0
    const deviceVal = structure ? f(structure.device_reimbursement) : 0
    const communicationVal = structure ? f(structure.communication_allowance) : 0
    const otherAllVal = structure ? f(structure.other_allowance) : otherAll
    const conveyanceLitersVal = structure ? f(structure.conveyance_liters_allowance) : 0
    const incrementalArrearsVal = structure ? f(structure.incremental_arrears) : 0
    const overtimeVal = structure ? f(structure.overtime_allowance) : 0
    // Line-item breakdown comes from salary structure (monthly components). Summary totals must match
    // payroll_slip so "Total Gross", "Total Deductions", and "Net" reconcile (gross − deductions = net).
    // Do not use only basic+medical+house+utilities as "Total Gross" — that omitted conveyance, meal,
    // communication, etc. and made net look wrong vs the displayed gross row.
    return {
      id: slip.id,
      payrollId: slip.payroll_period_id,
      month: monthLabel,
      payMonth: slip.pay_month || null,
      employeeName: name || '—',
      employeeCode: emp?.employee_code || '—',
      email: emp?.email || '—',
      totGrossSalary: gross,
      totAllowances: totAll,
      totDeductions: totDed,
      totNetSalary: net,
      remarks: slip.remarks || '',
      salaryStatus: slip.status || 'Generated',
      mDays: slip.working_days,
      wDays: slip.paid_days,
      aDays: slip.absent_days,
      // Gross breakdown: basic_salary, medical, house_rent, utilities, etc. (overtime separate, not part of gross)
      basicSalary1: basicVal,
      medicalAllowance2: medicalVal,
      conveyanceFixed3: conveyanceVal,
      overtime4: overtimeVal,
      houseRent5: houseRentVal,
      utilities6: utilitiesVal,
      meal7: mealVal,
      arrears8: arrearsVal,
      bikeMaintainence9: bikeVal,
      incentivesTech10: incentivesVal,
      deviceReimbursment11: deviceVal,
      communication12: communicationVal,
      incentivesKpi13: 0,
      otherAllowance14: otherAllVal,
      conveyanceLiters28: conveyanceLitersVal,
      incrementalArrears31: incrementalArrearsVal,
      eobi17: eobi,
      incomeTax18: incomeTax,
      absentDays19: absentDed,
      otherDeduction25: otherDed,
      loan15: parseFloat(slip.loan_deduction ?? 0) || 0,
      advanceSalary16: parseFloat(slip.salary_advance_deduction ?? 0) || 0,
      lateDays24: parseFloat(slip.late_deduction ?? 0) || 0,
      deviceDeduction20: parseFloat(slip.device_deduction ?? 0) || 0,
      mobileInstallment26: parseFloat(slip.cellphone_installment_deduction ?? 0) || 0,
      foodPanda27: parseFloat(slip.foodpanda_deduction ?? 0) || 0,
      vehicleFuel22: parseFloat(slip.fuel_overusage_deduction ?? 0) || 0,
      overUtilizationMobile21: parseFloat(slip.over_utilization_mobile_deduction ?? 0) || 0
    }
  }

  if (isOld) {
    const slip = await salaryRepo.getOldSlipById(numericId, employeeId)
    if (!slip) return null
    const emp = await salaryRepo.getEmployeeBasicInfo(employeeId)
    const monthLabel = slip.period_label || monthLabelFromDate(slip.pay_month) || 'Old slip'
    const name = emp ? [emp.first_name, emp.last_name].filter(Boolean).join(' ').trim() : '—'
    const f = (v) => parseFloat(v ?? 0)
    return {
      id: `o-${slip.id}`,
      payrollId: slip.payroll_id ?? null,
      month: monthLabel,
      payMonth: slip.pay_month || null,
      employeeName: name || '—',
      employeeCode: emp?.employee_code || '—',
      email: emp?.email || '—',
      mDays: slip.m_days,
      wDays: slip.w_days,
      aDays: slip.a_days,
      jlDays: slip.j_l_days,
      grossSalary: f(slip.gross_salary),
      basicSalary1: f(slip.basic_salary_1),
      medicalAllowance2: f(slip.medical_allowance_2),
      conveyanceFixed3: f(slip.conveyance_fixed_allowance_3),
      overtime4: f(slip.overtime_allowance_4),
      houseRent5: f(slip.house_rent_allowance_5),
      utilities6: f(slip.utilities_allowance_6),
      meal7: f(slip.meal_allowance_7),
      arrears8: f(slip.arrears_8),
      bikeMaintainence9: f(slip.bike_maintainence_9),
      incentivesTech10: f(slip.incentives_tech_10),
      deviceReimbursment11: f(slip.device_reimbursment_11),
      communication12: f(slip.communication_12),
      incentivesKpi13: f(slip.incentives_kpi_13),
      otherAllowance14: f(slip.other_allowance_14),
      loan15: f(slip.loan_15),
      advanceSalary16: f(slip.advance_salary_16),
      eobi17: f(slip.eobi_17),
      incomeTax18: f(slip.income_tax_18),
      absentDays19: f(slip.absent_days_19),
      deviceDeduction20: f(slip.device_deduction_20),
      overUtilizationMobile21: f(slip.over_utilization_mobile_21),
      vehicleFuel22: f(slip.vehicle_fuel_deduction_22),
      pandamic23: f(slip.pandamic_deduction_23),
      lateDays24: f(slip.late_days_24),
      otherDeduction25: f(slip.other_deduction_25),
      mobileInstallment26: f(slip.mobile_installment_26),
      foodPanda27: f(slip.food_panda_27),
      conveyanceLiters28: f(slip.conveyance_liters_allowance_28),
      leaves29: f(slip.leaves_29),
      incrementalArrears31: f(slip.incremental_arrears_31),
      totGrossSalary: f(slip.tot_gross_salary) || f(slip.gross_salary),
      totAllowances: f(slip.tot_allowances) || f(slip.total_allowances),
      totNetGrossAllowances: f(slip.tot_net_gross_allowances),
      totDeductions: f(slip.tot_deductions) || f(slip.total_deductions),
      totAcToWd: f(slip.tot_ac_to_wd),
      totNetSalary: f(slip.tot_net_salary) || f(slip.net_salary),
      remarks: slip.remarks || '',
      salaryStatus: slip.salary_status || slip.status || 'Paid',
      source: 'old'
    }
  }

  const hrIds = await salaryRepo.getHrEmpIdsForEmployee(employeeId)
  const slip = await salaryRepo.getLegacySlipById(numericId, hrIds)
  if (!slip) return null
  const emp = await salaryRepo.getEmployeeBasicInfo(employeeId)
  const monthLabel = slip.payroll_label || monthLabelFromDate(slip.pay_month) || `Payroll #${slip.payroll_id}`
  const name = emp ? [emp.first_name, emp.last_name].filter(Boolean).join(' ').trim() : '—'

  return {
    id: slip.id,
    payrollId: slip.payroll_id,
    month: monthLabel,
    payMonth: slip.pay_month || null,
    employeeName: name || '—',
    employeeCode: emp?.employee_code || '—',
    email: emp?.email || '—',
    mDays: slip.m_days,
    wDays: slip.w_days,
    aDays: slip.a_days,
    jlDays: slip.j_l_days,
    grossSalary: parseFloat(slip.gross_salary ?? 0),
    basicSalary1: parseFloat(slip.basic_salary_1 ?? 0),
    medicalAllowance2: parseFloat(slip.medical_allowance_2 ?? 0),
    conveyanceFixed3: parseFloat(slip.conveyance_fixed_allowance_3 ?? 0),
    overtime4: parseFloat(slip.overtime_allowance_4 ?? 0),
    houseRent5: parseFloat(slip.house_rent_allowance_5 ?? 0),
    utilities6: parseFloat(slip.utilities_allowance_6 ?? 0),
    meal7: parseFloat(slip.meal_allowance_7 ?? 0),
    arrears8: parseFloat(slip.arrears_8 ?? 0),
    bikeMaintainence9: parseFloat(slip.bike_maintainence_9 ?? 0),
    incentivesTech10: parseFloat(slip.incentives_tech_10 ?? 0),
    deviceReimbursment11: parseFloat(slip.device_reimbursment_11 ?? 0),
    communication12: parseFloat(slip.communication_12 ?? 0),
    incentivesKpi13: parseFloat(slip.incentives_kpi_13 ?? 0),
    otherAllowance14: parseFloat(slip.other_allowance_14 ?? 0),
    loan15: parseFloat(slip.loan_15 ?? 0),
    advanceSalary16: parseFloat(slip.advance_salary_16 ?? 0),
    eobi17: parseFloat(slip.eobi_17 ?? 0),
    incomeTax18: parseFloat(slip.income_tax_18 ?? 0),
    absentDays19: parseFloat(slip.absent_days_19 ?? 0),
    deviceDeduction20: parseFloat(slip.device_deduction_20 ?? 0),
    overUtilizationMobile21: parseFloat(slip.over_utilization_mobile_21 ?? 0),
    vehicleFuel22: parseFloat(slip.vehicle_fuel_deduction_22 ?? 0),
    pandamic23: parseFloat(slip.pandamic_deduction_23 ?? 0),
    lateDays24: parseFloat(slip.late_days_24 ?? 0),
    otherDeduction25: parseFloat(slip.other_deduction_25 ?? 0),
    mobileInstallment26: parseFloat(slip.mobile_installment_26 ?? 0),
    foodPanda27: parseFloat(slip.food_panda_27 ?? 0),
    conveyanceLiters28: parseFloat(slip.conveyance_liters_allowance_28 ?? 0),
    leaves29: parseFloat(slip.leaves_29 ?? 0),
    incrementalArrears31: parseFloat(slip.incremental_arrears_31 ?? 0),
    totGrossSalary: parseFloat(slip.tot_gross_salary ?? 0),
    totAllowances: parseFloat(slip.tot_allowances ?? 0),
    totNetGrossAllowances: parseFloat(slip.tot_net_gross_allowances ?? 0),
    totDeductions: parseFloat(slip.tot_deductions ?? 0),
    totAcToWd: parseFloat(slip.tot_ac_to_wd ?? 0),
    totNetSalary: parseFloat(slip.tot_net_salary ?? 0),
    remarks: slip.remarks || '',
    salaryStatus: slip.salary_status || ''
  }
}

/** Bulk create old salary slips (for import from SQL Server). Each item: employeeId, payMonth, periodLabel?, basicSalary?, grossSalary, totalAllowances, totalDeductions, netSalary, status?, remarks?, sourceEmployeeCode? */
export async function createOldSalarySlips(slips) {
  if (!Array.isArray(slips) || slips.length === 0) return { created: 0, ids: [] }
  const created = await salaryRepo.createOldSalarySlips(slips)
  return { created: created.length, ids: created.map((c) => c.id) }
}

/** Get current salary from newest available source:
 *  1. payroll_slip (new payroll system)
 *  2. old_salary_slip (imported from SQL Server)
 *  3. salary_slip legacy via HR emp_id mapping
 */
export async function getCurrentSalary(employeeId) {
  // 1. Try new payroll system first (payroll_slip)
  const payrollSlip = await salaryRepo.getLatestPayrollSlip(employeeId)
  if (payrollSlip && payrollSlip.gross_salary) {
    return {
      basicSalary: parseFloat(payrollSlip.gross_salary ?? 0) * 0.7,
      gross_salary: parseFloat(payrollSlip.gross_salary ?? 0),
      allowances: parseFloat(payrollSlip.total_allowances ?? 0),
      bonuses: 0,
      deductions: parseFloat(payrollSlip.total_deductions ?? 0),
      total: parseFloat(payrollSlip.net_salary ?? 0),
      month: payrollSlip.period_name || null,
      source: 'payroll'
    }
  }

  // 2. Try old_salary_slip (imported from SQL Server)
  const oldSlip = await salaryRepo.getLatestOldSalarySlip(employeeId)
  if (oldSlip && oldSlip.gross_salary) {
    return {
      basicSalary: parseFloat(oldSlip.gross_salary ?? 0) * 0.7,
      gross_salary: parseFloat(oldSlip.gross_salary ?? 0),
      allowances: parseFloat(oldSlip.total_allowances ?? 0),
      bonuses: 0,
      deductions: parseFloat(oldSlip.total_deductions ?? 0),
      total: parseFloat(oldSlip.net_salary ?? 0),
      month: oldSlip.period_label || oldSlip.pay_month || null,
      source: 'old_slip'
    }
  }

  // 3. Fall back to legacy salary_slip via HR emp_id mapping
  const hrIds = await salaryRepo.getHrEmpIdsForEmployee(employeeId)
  if (hrIds.length > 0) {
    const s = await salaryRepo.getLegacyCurrentSalary(hrIds)
    if (s && s.tot_gross_salary) {
      return {
        basicSalary: parseFloat(s.tot_gross_salary ?? 0) * 0.7,
        gross_salary: parseFloat(s.tot_gross_salary ?? 0),
        allowances: parseFloat(s.tot_allowances ?? 0),
        bonuses: 0,
        deductions: parseFloat(s.tot_deductions ?? 0),
        total: parseFloat(s.tot_net_salary ?? 0),
        month: null,
        source: 'legacy'
      }
    }
  }

  // No salary data found anywhere
  return {
    basicSalary: 0,
    gross_salary: 0,
    allowances: 0,
    bonuses: 0,
    deductions: 0,
    total: 0,
    month: null,
    source: null
  }
}

/** Legacy: history (same source as listSlips but different shape). */
export async function getSalaryHistory(employeeId, limit = 12, options = {}) {
  const onHold = await salaryRepo.isSalarySlipOnHold(employeeId)
  if (onHold && !options.bypassHold) return []

  const hrIds = await salaryRepo.getHrEmpIdsForEmployee(employeeId)
  const slips = await salaryRepo.getLegacyHistory(hrIds, limit)
  return slips.map((s) => ({
    id: s.id,
    month: s.pay_month ? monthLabelFromDate(s.pay_month) : `Payroll #${s.payroll_id}`,
    amount: `$${parseFloat(s.tot_net_salary ?? 0).toLocaleString()}`,
    status: s.salary_status || 'Paid',
    date: s.pay_month || null
  }))
}

/** Download: return slip data. rawId = "p-123", "o-456", or "s-789", employeeId required. */
export async function getSalarySlipForDownload(rawId, employeeId, options = {}) {
  const onHold = await salaryRepo.isSalarySlipOnHold(employeeId)
  if (onHold && !options.bypassHold) return null

  const isPayroll = String(rawId).startsWith('p-')
  const isOld = String(rawId).startsWith('o-')
  const numericId = String(rawId).replace(/^p-|^o-|^s-/, '')

  if (isPayroll) {
    const slip = await salaryRepo.getPayrollSlipById(numericId, employeeId)
    if (!slip) return null
    const held = slip.slip_on_hold === true || slip.slip_on_hold === 't'
    if (held && !options.bypassHold) return null
    const emp = await salaryRepo.getEmployeeBasicInfo(employeeId)
    const monthLabel = slip.period_name || monthLabelFromDate(slip.pay_month) || 'Payroll'
    const totGross = parseFloat(slip.gross_salary ?? 0) + parseFloat(slip.total_allowances ?? 0)
    const name = emp ? [emp.first_name, emp.last_name].filter(Boolean).join(' ').trim() : '—'
    return {
      message: 'Salary slip data',
      data: {
        id: slip.id,
        payrollId: slip.payroll_period_id,
        month: monthLabel,
        employeeName: name || '—',
        employeeCode: emp?.employee_code || '—',
        email: emp?.email || '—',
        totNetSalary: parseFloat(slip.net_salary ?? 0),
        totGrossSalary: totGross,
        totAllowances: parseFloat(slip.total_allowances ?? 0),
        totDeductions: parseFloat(slip.total_deductions ?? 0),
        salaryStatus: slip.status || '',
        remarks: slip.remarks || '',
        slip
      }
    }
  }

  if (isOld) {
    const slip = await salaryRepo.getOldSlipById(numericId, employeeId)
    if (!slip) return null
    const emp = await salaryRepo.getEmployeeBasicInfo(employeeId)
    const monthLabel = slip.period_label || monthLabelFromDate(slip.pay_month) || 'Old slip'
    const name = emp ? [emp.first_name, emp.last_name].filter(Boolean).join(' ').trim() : '—'
    const totNet = parseFloat(slip.tot_net_salary ?? slip.net_salary ?? 0)
    const totGross = parseFloat(slip.tot_gross_salary ?? slip.gross_salary ?? 0)
    const totAll = parseFloat(slip.tot_allowances ?? slip.total_allowances ?? 0)
    const totDed = parseFloat(slip.tot_deductions ?? slip.total_deductions ?? 0)
    return {
      message: 'Salary slip data',
      data: {
        id: `o-${slip.id}`,
        payrollId: slip.payroll_id ?? null,
        month: monthLabel,
        employeeName: name || '—',
        employeeCode: emp?.employee_code || '—',
        email: emp?.email || '—',
        totNetSalary: totNet,
        totGrossSalary: totGross,
        totAllowances: totAll,
        totDeductions: totDed,
        salaryStatus: slip.salary_status || slip.status || '',
        remarks: slip.remarks || '',
        slip,
        source: 'old'
      }
    }
  }

  const hrIds = await salaryRepo.getHrEmpIdsForEmployee(employeeId)
  const slip = await salaryRepo.getLegacySlipRaw(numericId, hrIds)
  if (!slip) return null
  const emp = await salaryRepo.getEmployeeBasicInfo(employeeId)
  const pay = await salaryRepo.getPayrollById(slip.payroll_id)
  const monthLabel = pay?.label || monthLabelFromDate(pay?.pay_month) || `Payroll #${slip.payroll_id}`
  const name = emp ? [emp.first_name, emp.last_name].filter(Boolean).join(' ').trim() : '—'

  return {
    message: 'Salary slip data',
    data: {
      id: slip.id,
      payrollId: slip.payroll_id,
      month: monthLabel,
      employeeName: name || '—',
      employeeCode: emp?.employee_code || '—',
      email: emp?.email || '—',
      totNetSalary: parseFloat(slip.tot_net_salary ?? 0),
      totGrossSalary: parseFloat(slip.tot_gross_salary ?? 0),
      totAllowances: parseFloat(slip.tot_allowances ?? 0),
      totDeductions: parseFloat(slip.tot_deductions ?? 0),
      salaryStatus: slip.salary_status || '',
      remarks: slip.remarks || '',
      slip
    }
  }
}

// ---------- FPIN (salary slip view PIN) ----------
const FPIN_SALT_ROUNDS = 10

/** GET status: has the employee set a FPIN? */
export async function getFpinStatus(employeeId) {
  const row = await salaryRepo.getFpinByEmployeeId(employeeId)
  return { hasSet: !!row }
}

/** POST set: set or update FPIN. Body: { employeeId, pin } – pin 4–8 digits. */
export async function setFpin(employeeId, pin) {
  const p = String(pin).trim()
  if (!/^\d{4,8}$/.test(p)) {
    return { error: 'FPIN must be 4 to 8 digits', status: 400 }
  }
  const pinHash = await bcrypt.hash(p, FPIN_SALT_ROUNDS)
  await salaryRepo.upsertFpin(employeeId, pinHash)
  return { message: 'FPIN set successfully' }
}

const FPIN_MAX_ATTEMPTS = 5
const FPIN_LOCK_MINUTES = 3

/** POST verify: verify FPIN to allow viewing salary. Body: { employeeId, pin }. 5 wrong attempts -> lock 3 min. */
export async function verifyFpin(employeeId, pin) {
  const row = await salaryRepo.getFpinByEmployeeId(employeeId)
  if (!row) return { error: 'FPIN not set', status: 400 }
  const now = new Date()
  const lockedUntil = row.locked_until ? new Date(row.locked_until) : null
  if (lockedUntil && lockedUntil > now) {
    const mins = Math.ceil((lockedUntil - now) / 60000)
    return { error: `Too many wrong attempts. Try again after ${mins} minute(s).`, status: 429 }
  }
  const match = await bcrypt.compare(String(pin).trim(), row.pin_hash)
  if (match) {
    await salaryRepo.updateFpinAttempts(employeeId, 0, null)
    return { verified: true }
  }
  const failed = (row.failed_attempts || 0) + 1
  const lockUntil = failed >= FPIN_MAX_ATTEMPTS ? new Date(now.getTime() + FPIN_LOCK_MINUTES * 60 * 1000) : null
  await salaryRepo.updateFpinAttempts(employeeId, failed, lockUntil)
  const remaining = Math.max(0, FPIN_MAX_ATTEMPTS - failed)
  if (remaining === 0) {
    return { error: `Too many wrong attempts. Try again after ${FPIN_LOCK_MINUTES} minutes.`, status: 429 }
  }
  return { error: `Invalid FPIN. ${remaining} attempt(s) remaining.`, status: 401, remainingAttempts: remaining }
}
