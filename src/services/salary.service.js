import * as salaryRepo from '../repositories/salary.repository.js'

function monthLabelFromDate(date) {
  return date ? new Date(date).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : null
}

/** List all salary slips for employee: payroll_slip first, then legacy. Id format: "p-123" or "s-456". */
export async function listSlips(employeeId) {
  const result = []

  const payrollSlips = await salaryRepo.listPayrollSlipsForEmployee(employeeId)
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
  return result
}

/** Get one slip by id ("p-123" or "s-456") with employeeId for auth. */
export async function getSlipById(rawId, employeeId) {
  const isPayroll = String(rawId).startsWith('p-')
  const numericId = isPayroll ? String(rawId).replace(/^p-/, '') : String(rawId).replace(/^s-/, '')

  if (isPayroll) {
    const slip = await salaryRepo.getPayrollSlipById(numericId, employeeId)
    if (!slip) return null
    const emp = await salaryRepo.getEmployeeBasicInfo(employeeId)
    const monthLabel = slip.period_name || monthLabelFromDate(slip.pay_month) || 'Payroll'
    const name = emp ? [emp.first_name, emp.last_name].filter(Boolean).join(' ').trim() : '—'
    return {
      id: slip.id,
      payrollId: slip.payroll_period_id,
      month: monthLabel,
      payMonth: slip.pay_month || null,
      employeeName: name || '—',
      employeeCode: emp?.employee_code || '—',
      email: emp?.email || '—',
      totGrossSalary: parseFloat(slip.gross_salary ?? 0) + parseFloat(slip.total_allowances ?? 0),
      totAllowances: parseFloat(slip.total_allowances ?? 0),
      totDeductions: parseFloat(slip.total_deductions ?? 0),
      totNetSalary: parseFloat(slip.net_salary ?? 0),
      remarks: slip.remarks || '',
      salaryStatus: slip.status || 'Generated'
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

/** Legacy: current month salary (latest slip by payroll_id for employee via hr_emp_id). */
export async function getCurrentSalary(employeeId) {
  const hrIds = await salaryRepo.getHrEmpIdsForEmployee(employeeId)
  if (hrIds.length === 0) return null
  const s = await salaryRepo.getLegacyCurrentSalary(hrIds)
  if (!s) return null
  return {
    basicSalary: parseFloat(s.tot_gross_salary ?? 0) * 0.7,
    allowances: parseFloat(s.tot_allowances ?? 0),
    bonuses: 0,
    deductions: parseFloat(s.tot_deductions ?? 0),
    total: parseFloat(s.tot_net_salary ?? 0),
    month: null
  }
}

/** Legacy: history (same source as listSlips but different shape). */
export async function getSalaryHistory(employeeId, limit = 12) {
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

/** Download: return slip data. rawId = "p-123" or "s-456", employeeId required. */
export async function getSalarySlipForDownload(rawId, employeeId) {
  const isPayroll = String(rawId).startsWith('p-')
  const numericId = String(rawId).replace(/^p-|^s-/, '')

  if (isPayroll) {
    const slip = await salaryRepo.getPayrollSlipById(numericId, employeeId)
    if (!slip) return null
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
