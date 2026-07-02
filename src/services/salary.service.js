import bcrypt from 'bcryptjs'
import * as salaryRepo from '../repositories/salary.repository.js'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { APP_NAME, EMAIL_FROM, EMAIL_LOGO_PATH, getEmailTransport, isEmailConfigured } from '../../config/email.js'
import { getOfficialEmailFromCrm } from '../../config/crmDatabase.js'

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
      remarks: row.remarks || '',
      onHold: row.slip_on_hold === true || row.slip_on_hold === 't'
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
      remarks: row.remarks || '',
      onHold: false
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
      remarks: row.remarks || '',
      onHold: false
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
    // other_allowance is stored per-slip on payroll_slip (ad-hoc, varies by month); prefer it over the
    // structure template, which is often 0 even when the slip has a value. Fall back to structure if slip has none.
    const otherAllVal = otherAll || (structure ? f(structure.other_allowance) : 0)
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
      overUtilizationMobile21: parseFloat(slip.over_utilization_mobile_deduction ?? 0) || 0,
      pandamic23: parseFloat(slip.pandamic_deduction_23 ?? 0) || 0,
      leaves29: parseFloat(slip.leaves_29 ?? 0) || 0
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
 *  1. employee_gross_salary (primary source for loan/advance requisitions)
 *  2. payroll_slip (new payroll system)
 *  3. old_salary_slip (imported from SQL Server)
 *  4. salary_slip legacy via HR emp_id mapping
 */
export async function getCurrentSalary(employeeId) {
  // 1. Try employee_gross_salary table first (primary source)
  const grossSalaryRecord = await salaryRepo.getEmployeeGrossSalary(employeeId)
  if (grossSalaryRecord && grossSalaryRecord.gross_salary) {
    const gross = parseFloat(grossSalaryRecord.gross_salary ?? 0)
    return {
      basicSalary: gross * 0.7,
      gross_salary: gross,
      allowances: 0,
      bonuses: 0,
      deductions: 0,
      total: gross,
      month: null,
      source: 'employee_gross_salary',
      updatedAt: grossSalaryRecord.updated_at || null
    }
  }

  // 2. Try new payroll system (payroll_slip)
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

  // 3. Try old_salary_slip (imported from SQL Server)
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

  // 4. Fall back to legacy salary_slip via HR emp_id mapping
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

// ---------- FPIN Reset (email OTP flow) ----------
// In-memory store: employeeId -> { codeHash, expiresAt }. Short-lived (10 min), cleared on use or re-request.
const fpinResetStore = new Map()
const FPIN_RESET_EXPIRY_MS = 10 * 60 * 1000
const FPIN_RESET_SALT_ROUNDS = 6 // lower rounds for short-lived OTP — speed matters here

function maskEmail(email) {
  const [local, domain] = String(email).split('@')
  if (!domain) return email
  const visible = local.slice(0, Math.min(3, local.length))
  return `${visible}${'*'.repeat(Math.max(0, local.length - visible.length))}@${domain}`
}

/** Send a 6-digit verification code to the employee's CRM (official) email to initiate FPIN reset. */
export async function requestFpinReset(employeeId) {
  const emp = await salaryRepo.getEmployeeEmailById(employeeId)
  if (!emp) return { error: 'Employee not found', status: 404 }

  // Always send to CRM email (official work email from ERP_Tracking.dbo.USERS)
  const crmEmail = await getOfficialEmailFromCrm(emp.employee_code)
  const targetEmail = crmEmail || emp.email
  if (!targetEmail) return { error: 'No email address on file for this employee', status: 400 }

  const code = String(Math.floor(100000 + Math.random() * 900000))
  const codeHash = await bcrypt.hash(code, FPIN_RESET_SALT_ROUNDS)
  fpinResetStore.set(employeeId, { codeHash, expiresAt: Date.now() + FPIN_RESET_EXPIRY_MS })

  if (isEmailConfigured()) {
    const transport = getEmailTransport()
    if (transport) {
      const name = emp.first_name || 'Employee'
      const appName = APP_NAME || 'Employee Portal'
      const digits = code.split('')
      const digitBoxes = digits.map(d =>
        `<span style="display:inline-block;width:44px;height:56px;line-height:56px;text-align:center;font-size:28px;font-weight:700;color:#1e293b;background:#f1f5f9;border:2px solid #e2e8f0;border-radius:10px;margin:0 4px;">${d}</span>`
      ).join('')

      // Build inline logo attachment (CID) — works in all email clients including Gmail & Outlook
      const logoAttachments = []
      const logoAbsPath = EMAIL_LOGO_PATH ? resolve(EMAIL_LOGO_PATH) : ''
      if (logoAbsPath && existsSync(logoAbsPath)) {
        logoAttachments.push({
          filename: 'logo.png',
          content: readFileSync(logoAbsPath),
          cid: 'emp-portal-logo',
          contentDisposition: 'inline'
        })
      }
      const logoImgTag = logoAttachments.length
        ? `<img src="cid:emp-portal-logo" alt="${appName}" width="75" style="display:block;margin:0 auto 22px;max-width:75px;height:auto;" />`
        : ''

      const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>FPIN Reset</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">

        <!-- Header: logo + title on white with blue top accent -->
        <tr><td style="background:#ffffff;border-radius:16px 16px 0 0;border-top:5px solid #1e40af;padding:36px 40px 32px;text-align:center;">
          ${logoImgTag}
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:2.5px;text-transform:uppercase;">Security Alert</p>
          <h1 style="margin:0;font-size:26px;font-weight:800;color:#1e40af;letter-spacing:-0.5px;">FPIN Reset Request</h1>
        </td></tr>

        <!-- Divider -->
        <tr><td style="background:#ffffff;padding:0 40px;"><div style="height:1px;background:#e2e8f0;"></div></td></tr>

        <!-- Body -->
        <tr><td style="background:#ffffff;padding:32px 40px 36px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;">
          <p style="margin:0 0 6px;font-size:17px;font-weight:600;color:#1e293b;">Hi ${name},</p>
          <p style="margin:0 0 28px;font-size:15px;color:#64748b;line-height:1.65;">We received a request to reset your <strong style="color:#1e293b;">Salary Slip PIN (FPIN)</strong> on the Employee Portal. Use the verification code below to proceed.</p>

          <!-- Code block -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:2px solid #e2e8f0;border-radius:14px;margin-bottom:24px;">
            <tr><td style="padding:28px 20px;text-align:center;">
              <p style="margin:0 0 18px;font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:2px;text-transform:uppercase;">Your Verification Code</p>
              <div style="margin:0 auto;">${digitBoxes}</div>
              <p style="margin:20px 0 0;font-size:13px;color:#94a3b8;">⏱&nbsp; Expires in <strong style="color:#ef4444;">10 minutes</strong></p>
            </td></tr>
          </table>

          <!-- Steps -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;margin-bottom:24px;">
            <tr><td style="padding:18px 22px;">
              <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#1e40af;">How to use this code:</p>
              <table cellpadding="0" cellspacing="0">
                <tr><td style="padding:3px 0;font-size:13px;color:#1d4ed8;"><span style="color:#3b82f6;font-weight:700;margin-right:8px;">1.</span>Go back to the Employee Portal</td></tr>
                <tr><td style="padding:3px 0;font-size:13px;color:#1d4ed8;"><span style="color:#3b82f6;font-weight:700;margin-right:8px;">2.</span>Enter this 6-digit code in the verification field</td></tr>
                <tr><td style="padding:3px 0;font-size:13px;color:#1d4ed8;"><span style="color:#3b82f6;font-weight:700;margin-right:8px;">3.</span>Set your new 4-digit FPIN</td></tr>
              </table>
            </td></tr>
          </table>

          <!-- Security notice -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#fffbeb;border-left:4px solid #f59e0b;border-radius:0 10px 10px 0;">
            <tr><td style="padding:14px 18px;">
              <p style="margin:0;font-size:13px;color:#92400e;line-height:1.65;"><strong>Didn't request this?</strong> Please ignore this email. Your current FPIN remains unchanged and your account is safe.</p>
            </td></tr>
          </table>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:0 0 16px 16px;padding:22px 40px;text-align:center;">
          <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#334155;">${appName}</p>
          <p style="margin:0;font-size:12px;color:#94a3b8;">This is an automated message — please do not reply.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`

      const text = `Hi ${name},\n\nYour FPIN reset verification code is: ${code}\n\nThis code expires in 10 minutes.\n\nIf you did not request this, please ignore this email. Your current FPIN remains unchanged.\n\n— ${appName}`

      await transport.sendMail({
        from: EMAIL_FROM,
        to: targetEmail,
        subject: `${code} is your FPIN Reset Code — ${appName}`,
        text,
        html,
        attachments: logoAttachments
      }).catch((err) => console.error('[FPIN Reset] Email failed:', err.message))
    }
  }

  return { message: 'Verification code sent', maskedEmail: maskEmail(targetEmail) }
}

/** Verify the OTP code and set the new 4-digit FPIN in a single step. */
export async function resetFpinWithCode(employeeId, code, newPin) {
  const entry = fpinResetStore.get(employeeId)
  if (!entry) return { error: 'No reset request found. Please request a new code.', status: 400 }

  if (Date.now() > entry.expiresAt) {
    fpinResetStore.delete(employeeId)
    return { error: 'Verification code has expired. Please request a new one.', status: 400 }
  }

  const match = await bcrypt.compare(String(code).trim(), entry.codeHash)
  if (!match) return { error: 'Invalid verification code.', status: 401 }

  const p = String(newPin).trim()
  if (!/^\d{4}$/.test(p)) return { error: 'FPIN must be exactly 4 digits.', status: 400 }

  const pinHash = await bcrypt.hash(p, FPIN_SALT_ROUNDS)
  await salaryRepo.upsertFpin(employeeId, pinHash)
  await salaryRepo.updateFpinAttempts(employeeId, 0, null)

  fpinResetStore.delete(employeeId)
  return { message: 'FPIN reset successfully' }
}
