import { executeQuery } from '../../config/database.js'

/** FPIN: get existing pin_hash and lockout fields for employee (salary slip view PIN). */
export async function getFpinByEmployeeId(employeeId) {
  try {
    const rows = await executeQuery(
      'SELECT pin_hash, failed_attempts, locked_until FROM salary_fpin WHERE employee_id = $1',
      [employeeId]
    )
    return rows.length ? rows[0] : null
  } catch (e) {
    if (e.code === '42703') {
      const rows = await executeQuery('SELECT pin_hash FROM salary_fpin WHERE employee_id = $1', [employeeId])
      return rows.length ? { ...rows[0], failed_attempts: 0, locked_until: null } : null
    }
    throw e
  }
}

/** FPIN: update failed_attempts and locked_until after verify attempt. */
export async function updateFpinAttempts(employeeId, failedAttempts, lockedUntil) {
  try {
    await executeQuery(
      'UPDATE salary_fpin SET failed_attempts = $2, locked_until = $3, updated_at = NOW() WHERE employee_id = $1',
      [employeeId, failedAttempts, lockedUntil]
    )
  } catch (e) {
    if (e.code === '42703') return // columns not yet migrated
    throw e
  }
}

/** FPIN: set or update hashed PIN for employee. */
export async function upsertFpin(employeeId, pinHash) {
  await executeQuery(
    `INSERT INTO salary_fpin (employee_id, pin_hash, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (employee_id) DO UPDATE SET pin_hash = $2, updated_at = NOW()`,
    [employeeId, pinHash]
  )
}

/** Get hr_emp_id(s) for portal employee (employee_code often matches legacy hr_emp_id). */
export async function getHrEmpIdsForEmployee(employeeId) {
  const rows = await executeQuery(
    'SELECT employee_code FROM employees WHERE employee_id = $1',
    [employeeId]
  )
  if (rows.length === 0) return []
  const code = rows[0].employee_code
  if (code == null || code === '') return []
  const numeric = /^\d+$/.test(String(code).trim()) ? parseInt(String(code).trim(), 10) : null
  return numeric != null ? [numeric] : []
}

export async function getEmployeeBasicInfo(employeeId) {
  const rows = await executeQuery(
    'SELECT first_name, last_name, employee_code, email FROM employees WHERE employee_id = $1',
    [employeeId]
  )
  return rows.length ? rows[0] : null
}

// ---------- New payroll (payroll_slip + payroll_period) ----------
// Returns all slips for employee regardless of payroll_period.status (draft/processing/processed/closed) so generated payroll (e.g. February 2026) shows on Salary Slip page.
export async function listPayrollSlipsForEmployee(employeeId) {
  try {
    return await executeQuery(
      `SELECT s.id, s.payroll_period_id, s.gross_salary, s.total_allowances, s.total_deductions, s.net_salary, s.status, s.remarks,
              p.name AS period_name, p.start_date, p.end_date
       FROM payroll_slip s
       JOIN payroll_period p ON p.id = s.payroll_period_id
       WHERE s.employee_id = $1
       ORDER BY p.start_date DESC, s.id DESC`,
      [employeeId]
    )
  } catch (e) {
    if (e.code === '42P01') return []
    throw e
  }
}

export async function getPayrollSlipById(slipId, employeeId) {
  try {
    const rows = await executeQuery(
      `SELECT s.*, p.name AS period_name, p.start_date AS pay_month
       FROM payroll_slip s
       JOIN payroll_period p ON p.id = s.payroll_period_id
       WHERE s.id = $1 AND s.employee_id = $2`,
      [slipId, employeeId]
    )
    return rows[0] || null
  } catch (e) {
    if (e.code === '42P01') return null
    throw e
  }
}

/** Get employee_salary_structure for one employee (for gross breakdown on payroll slip). */
export async function getEmployeeSalaryStructure(employeeId) {
  try {
    const rows = await executeQuery(
      `SELECT employee_id, basic_salary, medical_allowance, conveyance_allowance,
              conveyance_liters_allowance, communication_allowance,
              house_rent_allowance, utilities_allowance, meal_allowance, other_allowance,
              COALESCE(overtime_allowance, 0) AS overtime_allowance,
              arrears, incremental_arrears, bike_maintenance_allowance, incentives, device_reimbursement
       FROM employee_salary_structure WHERE employee_id = $1`,
      [employeeId]
    )
    return rows[0] || null
  } catch (e) {
    if (e.code === '42P01') return null
    if (e.code === '42703') {
      const rows = await executeQuery(
        `SELECT employee_id, basic_salary, medical_allowance, conveyance_allowance,
                house_rent_allowance, utilities_allowance, meal_allowance, other_allowance
         FROM employee_salary_structure WHERE employee_id = $1`,
        [employeeId]
      )
      const row = rows[0]
      return row ? { ...row, overtime_allowance: 0 } : null
    }
    throw e
  }
}

// ---------- Legacy (salary_slip + payroll, hr_emp_id) ----------
export async function listLegacySlipsForEmployee(hrEmpIds) {
  if (!hrEmpIds || hrEmpIds.length === 0) return []
  try {
    return await executeQuery(
      `SELECT s.id, s.payroll_id, s.tot_gross_salary, s.gross_salary, s.tot_allowances, s.tot_deductions, s.tot_net_salary, s.salary_status, s.remarks,
              p.pay_month, p.label AS payroll_label
       FROM salary_slip s
       LEFT JOIN payroll p ON p.id = s.payroll_id
       WHERE s.hr_emp_id = ANY($1::int[])
       ORDER BY s.payroll_id DESC, s.id DESC`,
      [hrEmpIds]
    )
  } catch (e) {
    if (e.code === '42P01') return []
    throw e
  }
}

export async function getLegacySlipById(slipId, hrEmpIds) {
  if (!hrEmpIds || hrEmpIds.length === 0) return null
  try {
    const rows = await executeQuery(
      `SELECT s.*, p.pay_month, p.label AS payroll_label
       FROM salary_slip s
       LEFT JOIN payroll p ON p.id = s.payroll_id
       WHERE s.id = $1 AND s.hr_emp_id = ANY($2::int[])`,
      [slipId, hrEmpIds]
    )
    return rows[0] || null
  } catch (e) {
    if (e.code === '42P01') return null
    throw e
  }
}

export async function getLegacyCurrentSalary(hrEmpIds) {
  if (!hrEmpIds || hrEmpIds.length === 0) return null
  try {
    const rows = await executeQuery(
      `SELECT id, payroll_id, tot_gross_salary, tot_allowances, tot_deductions, tot_net_salary, salary_status
       FROM salary_slip WHERE hr_emp_id = ANY($1::int[])
       ORDER BY payroll_id DESC LIMIT 1`,
      [hrEmpIds]
    )
    return rows[0] || null
  } catch (e) {
    if (e.code === '42P01') return null
    throw e
  }
}

export async function getLegacyHistory(hrEmpIds, limit) {
  if (!hrEmpIds || hrEmpIds.length === 0) return []
  try {
    return await executeQuery(
      `SELECT s.id, s.payroll_id, s.tot_net_salary, s.salary_status, p.pay_month
       FROM salary_slip s LEFT JOIN payroll p ON p.id = s.payroll_id
       WHERE s.hr_emp_id = ANY($1::int[])
       ORDER BY s.payroll_id DESC LIMIT $2`,
      [hrEmpIds, limit]
    )
  } catch (e) {
    if (e.code === '42P01') return []
    throw e
  }
}

export async function getLegacySlipRaw(slipId, hrEmpIds) {
  if (!hrEmpIds || hrEmpIds.length === 0) return null
  try {
    const rows = await executeQuery(
      'SELECT * FROM salary_slip WHERE id = $1 AND hr_emp_id = ANY($2::int[])',
      [slipId, hrEmpIds]
    )
    return rows[0] || null
  } catch (e) {
    if (e.code === '42P01') return null
    throw e
  }
}

export async function getPayrollById(payrollId) {
  try {
    const rows = await executeQuery('SELECT pay_month, label FROM payroll WHERE id = $1', [payrollId])
    return rows[0] || null
  } catch (e) {
    if (e.code === '42P01') return null
    throw e
  }
}

// ---------- Old salary slips (imported from SQL Server; display only) ----------
export async function listOldSlipsForEmployee(employeeId) {
  try {
    return await executeQuery(
      `SELECT id, employee_id, pay_month, period_label,
              COALESCE(tot_gross_salary, gross_salary) AS gross_salary,
              COALESCE(tot_allowances, total_allowances) AS total_allowances,
              COALESCE(tot_deductions, total_deductions) AS total_deductions,
              COALESCE(tot_net_salary, net_salary) AS net_salary,
              COALESCE(salary_status, status) AS status, remarks
       FROM old_salary_slip
       WHERE employee_id = $1
       ORDER BY pay_month DESC, id DESC`,
      [employeeId]
    )
  } catch (e) {
    if (e.code === '42703') {
      return await executeQuery(
        `SELECT id, employee_id, pay_month, period_label, basic_salary, gross_salary, total_allowances, total_deductions, net_salary, status, remarks
         FROM old_salary_slip WHERE employee_id = $1 ORDER BY pay_month DESC, id DESC`,
        [employeeId]
      )
    }
    if (e.code === '42P01') return []
    throw e
  }
}

export async function getOldSlipById(slipId, employeeId) {
  try {
    const rows = await executeQuery(
      'SELECT * FROM old_salary_slip WHERE id = $1 AND employee_id = $2',
      [slipId, employeeId]
    )
    return rows[0] || null
  } catch (e) {
    if (e.code === '42P01') return null
    throw e
  }
}

/** Resolve portal employee_id from HR_Emp_ID by matching employees.employee_code. Returns Map(hrEmpIdKey -> employee_id). */
export async function getPortalEmployeeIdsByHrEmpIds(hrEmpIds) {
  if (!hrEmpIds || hrEmpIds.length === 0) return new Map()
  const codes = [...new Set(hrEmpIds.map((id) => String(id).trim()).filter(Boolean))]
  if (codes.length === 0) return new Map()
  const rows = await executeQuery(
    'SELECT employee_id, employee_code FROM employees WHERE employee_code = ANY($1::text[])',
    [codes]
  )
  const map = new Map()
  for (const r of rows) {
    const code = r.employee_code != null ? String(r.employee_code).trim() : ''
    if (code) map.set(code, r.employee_id)
  }
  return map
}

/** Derive pay_month (date, first day of month) from row. Supports Pay_Month, SDT, or Yr+MNTH_NO. */
function derivePayMonth(row) {
  const d = row.payMonth ?? row.pay_month ?? row.Pay_Month ?? row.SDT
  if (d != null && d !== '') {
    const date = new Date(d)
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10)
  }
  const yr = row.Yr ?? row.yr
  const mnth = row.MNTH_NO ?? row.mnth_no
  if (yr != null && mnth != null) {
    const m = String(mnth).padStart(2, '0')
    return `${yr}-${m}-01`
  }
  return null
}

/** Normalize a row from SQL Server Pay Sheet / salary view or API to DB column names and values. */
function normalizePaySheetRow(row, hrToPortalMap = null) {
  const num = (v) => (v != null && v !== '' && !Number.isNaN(Number(v))) ? parseFloat(v) : null
  const str = (v) => (v != null && String(v).trim() !== '') ? String(v).trim() : null
  const hrEmpId = row.HR_Emp_ID != null ? parseInt(row.HR_Emp_ID, 10) : (row.hrEmpId ?? row.hr_emp_id)
  let employee_id = row.employeeId ?? row.employee_id
  if ((employee_id == null || employee_id === '') && hrToPortalMap && hrEmpId != null) {
    employee_id = hrToPortalMap.get(String(hrEmpId)) ?? hrToPortalMap.get(hrEmpId)
  }
  const pay_month = derivePayMonth(row) ?? row.payMonth ?? row.pay_month ?? row.Pay_Month
  const gross_salary = num(row.grossSalary ?? row.GrossSalary ?? row.gross_salary) ?? 0
  const tot_net = num(row.netSalary ?? row.net_salary ?? row.Tot_Net_Salary)
  const tot_ded = num(row.totalDeductions ?? row.total_deductions ?? row.Tot_Deductions)
  const net_salary = tot_net != null ? tot_net : gross_salary
  const total_deductions = tot_ded != null ? tot_ded : 0
  return {
    employee_id,
    pay_month,
    period_label: str(row.periodLabel ?? row.period_label ?? row.MNTH_NAME ?? row.MNTH_SHORT_NAME),
    basic_salary: num(row.basicSalary ?? row.basic_salary ?? row.Basic_Salary_1) ?? 0,
    gross_salary,
    total_allowances: num(row.totalAllowances ?? row.total_allowances ?? row.Tot_Allowances) ?? 0,
    total_deductions,
    net_salary,
    status: str(row.status ?? row.Salary_Status ?? row.salary_status) ?? 'Paid',
    remarks: str(row.remarks ?? row.Remarks),
    source_employee_code: str(row.sourceEmployeeCode ?? row.source_employee_code),
    source_slip_id: row.ID != null ? parseInt(row.ID, 10) : (row.sourceSlipId ?? row.source_slip_id ?? null),
    payroll_id: row.Payroll_ID != null ? parseInt(row.Payroll_ID, 10) : (row.payrollId ?? row.payroll_id),
    hr_emp_id: hrEmpId,
    co_id: row.CO_ID != null ? parseInt(row.CO_ID, 10) : (row.coId ?? row.co_id),
    dept_id: row.Dept_ID != null ? parseInt(row.Dept_ID, 10) : (row.deptId ?? row.dept_id),
    m_days: row.MDays != null ? parseInt(row.MDays, 10) : (row.mDays ?? row.m_days),
    w_days: row.WDays != null ? parseInt(row.WDays, 10) : (row.wDays ?? row.w_days),
    a_days: row.ADays != null ? parseInt(row.ADays, 10) : (row.aDays ?? row.a_days),
    j_l_days: row.JLDays != null ? parseInt(row.JLDays, 10) : (row.jLDays ?? row.j_l_days),
    basic_salary_1: num(row.Basic_Salary_1 ?? row.basicSalary1 ?? row.basic_salary_1),
    medical_allowance_2: num(row.Medical_Allowance_2 ?? row.medicalAllowance2 ?? row.medical_allowance_2),
    conveyance_fixed_allowance_3: num(row.Conveyance_Fixed_Allowance_3 ?? row.conveyanceFixedAllowance3 ?? row.conveyance_fixed_allowance_3),
    overtime_allowance_4: num(row.Overtime_Allowance_4 ?? row.overtimeAllowance4 ?? row.overtime_allowance_4),
    house_rent_allowance_5: num(row.House_Rent_Allowance_5 ?? row.houseRentAllowance5 ?? row.house_rent_allowance_5),
    utilities_allowance_6: num(row.Utilities_Allowance_6 ?? row.utilitiesAllowance6 ?? row.utilities_allowance_6),
    meal_allowance_7: num(row.Meal_Allowance_7 ?? row.mealAllowance7 ?? row.meal_allowance_7),
    arrears_8: num(row.Arrears_8 ?? row.arrears8 ?? row.arrears_8),
    bike_maintainence_9: num(row.Bike_Maintainence_9 ?? row.bikeMaintainence9 ?? row.bike_maintainence_9),
    incentives_tech_10: num(row.Incentives_Tech_10 ?? row.incentivesTech10 ?? row.incentives_tech_10),
    device_reimbursment_11: num(row.Device_Reimbursment_11 ?? row.deviceReimbursment11 ?? row.device_reimbursment_11),
    communication_12: num(row.Communication_12 ?? row.communication12 ?? row.communication_12),
    incentives_kpi_13: num(row.Incentives_KPI_13 ?? row.incentivesKpi13 ?? row.incentives_kpi_13),
    other_allowance_14: num(row.Other_Allowance_14 ?? row.otherAllowance14 ?? row.other_allowance_14),
    loan_15: num(row.Loan_15 ?? row.loan15 ?? row.loan_15),
    advance_salary_16: num(row.Advance_Salary_16 ?? row.advanceSalary16 ?? row.advance_salary_16),
    eobi_17: num(row.EOBI_17 ?? row.eobi17 ?? row.eobi_17),
    income_tax_18: num(row.Income_Tax_18 ?? row.incomeTax18 ?? row.income_tax_18),
    absent_days_19: num(row.Absent_Days_19 ?? row.absentDays19 ?? row.absent_days_19),
    device_deduction_20: num(row.Device_Deduction_20 ?? row.deviceDeduction20 ?? row.device_deduction_20),
    over_utilization_mobile_21: num(row.Over_Utilization_Mobile_21 ?? row.overUtilizationMobile21 ?? row.over_utilization_mobile_21),
    vehicle_fuel_deduction_22: num(row.Vehicle_Fuel_Deduction_22 ?? row.vehicleFuelDeduction22 ?? row.vehicle_fuel_deduction_22),
    pandamic_deduction_23: num(row.Pandamic_Deduction_23 ?? row.pandamicDeduction23 ?? row.pandamic_deduction_23),
    late_days_24: num(row.Late_Days_24 ?? row.lateDays24 ?? row.late_days_24),
    other_deduction_25: num(row.Other_Deduction_25 ?? row.otherDeduction25 ?? row.other_deduction_25),
    mobile_installment_26: num(row.Mobile_Installment_26 ?? row.mobileInstallment26 ?? row.mobile_installment_26),
    food_panda_27: num(row.Food_Panda_27 ?? row.foodPanda27 ?? row.food_panda_27),
    conveyance_liters_allowance_28: num(row.Conveyance_Liters_Allowance_28 ?? row.conveyanceLitersAllowance28 ?? row.conveyance_liters_allowance_28),
    leaves_29: num(row.Leaves_29 ?? row.leaves29 ?? row.leaves_29),
    incremental_arrears_31: num(row.Incremental_Arrears_31 ?? row.incrementalArrears31 ?? row.incremental_arrears_31),
    tot_gross_salary: num(row.Tot_Gross_Salary ?? row.totGrossSalary ?? row.tot_gross_salary) ?? gross_salary,
    tot_allowances: num(row.Tot_Allowances ?? row.totAllowances ?? row.tot_allowances) ?? 0,
    tot_net_gross_allowances: num(row.Tot_Net_Gross_Allowances ?? row.totNetGrossAllowances ?? row.tot_net_gross_allowances) ?? gross_salary,
    tot_deductions: num(row.Tot_Deductions ?? row.totDeductions ?? row.tot_deductions) ?? total_deductions,
    tot_ac_to_wd: num(row.Tot_AC_To_WD ?? row.totAcToWd ?? row.tot_ac_to_wd) ?? gross_salary,
    tot_net_salary: num(row.Tot_Net_Salary ?? row.totNetSalary ?? row.tot_net_salary) ?? net_salary,
    salary_status: str(row.Salary_Status ?? row.salaryStatus ?? row.salary_status)
  }
}

const OLD_SLIP_FULL_COLUMNS = `employee_id, pay_month, period_label, basic_salary, gross_salary, total_allowances, total_deductions, net_salary, status, remarks, source_employee_code,
  source_slip_id, payroll_id, hr_emp_id, co_id, dept_id, m_days, w_days, a_days, j_l_days,
  basic_salary_1, medical_allowance_2, conveyance_fixed_allowance_3, overtime_allowance_4, house_rent_allowance_5, utilities_allowance_6, meal_allowance_7,
  arrears_8, bike_maintainence_9, incentives_tech_10, device_reimbursment_11, communication_12, incentives_kpi_13, other_allowance_14,
  loan_15, advance_salary_16, eobi_17, income_tax_18, absent_days_19, device_deduction_20, over_utilization_mobile_21, vehicle_fuel_deduction_22,
  pandamic_deduction_23, late_days_24, other_deduction_25, mobile_installment_26, food_panda_27, conveyance_liters_allowance_28, leaves_29, incremental_arrears_31,
  tot_gross_salary, tot_allowances, tot_net_gross_allowances, tot_deductions, tot_ac_to_wd, tot_net_salary, salary_status`

// Explicit casts so PostgreSQL can infer types when params are null (avoids "could not determine data type of parameter $N")
const OLD_SLIP_PARAM_CASTS = [
  'integer', 'date', 'varchar(100)', 'numeric', 'numeric', 'numeric', 'numeric', 'numeric',
  'varchar(50)', 'text', 'varchar(50)', 'integer', 'integer', 'integer', 'integer', 'integer',
  'integer', 'integer', 'integer', 'integer',
  'numeric', 'numeric', 'numeric', 'numeric', 'numeric', 'numeric', 'numeric',
  'numeric', 'numeric', 'numeric', 'numeric', 'numeric', 'numeric', 'numeric',
  'numeric', 'numeric', 'numeric', 'numeric', 'numeric', 'numeric', 'numeric', 'numeric',
  'numeric', 'numeric', 'numeric', 'numeric', 'numeric', 'numeric', 'numeric', 'numeric',
  'numeric', 'numeric', 'numeric', 'numeric', 'numeric', 'numeric', 'text'
]

const BATCH_SIZE = 100

function rowToParams(s) {
  return [
    s.employee_id, s.pay_month, s.period_label, s.basic_salary, s.gross_salary, s.total_allowances, s.total_deductions, s.net_salary,
    s.status, s.remarks, s.source_employee_code, s.source_slip_id, s.payroll_id, s.hr_emp_id, s.co_id, s.dept_id,
    s.m_days, s.w_days, s.a_days, s.j_l_days,
    s.basic_salary_1, s.medical_allowance_2, s.conveyance_fixed_allowance_3, s.overtime_allowance_4, s.house_rent_allowance_5, s.utilities_allowance_6, s.meal_allowance_7,
    s.arrears_8, s.bike_maintainence_9, s.incentives_tech_10, s.device_reimbursment_11, s.communication_12, s.incentives_kpi_13, s.other_allowance_14,
    s.loan_15, s.advance_salary_16, s.eobi_17, s.income_tax_18, s.absent_days_19, s.device_deduction_20, s.over_utilization_mobile_21, s.vehicle_fuel_deduction_22,
    s.pandamic_deduction_23, s.late_days_24, s.other_deduction_25, s.mobile_installment_26, s.food_panda_27, s.conveyance_liters_allowance_28, s.leaves_29, s.incremental_arrears_31,
    s.tot_gross_salary, s.tot_allowances, s.tot_net_gross_allowances, s.tot_deductions, s.tot_ac_to_wd, s.tot_net_salary, s.salary_status
  ]
}

const PARAMS_PER_ROW = 57

export async function createOldSalarySlips(slips) {
  const needHrMap = slips.some((r) => (r.employeeId ?? r.employee_id) == null && (r.HR_Emp_ID ?? r.hrEmpId) != null)
  let hrToPortalMap = new Map()
  if (needHrMap) {
    const hrIds = slips
      .filter((r) => (r.employeeId ?? r.employee_id) == null && (r.HR_Emp_ID ?? r.hrEmpId) != null)
      .map((r) => r.HR_Emp_ID ?? r.hrEmpId)
    hrToPortalMap = await getPortalEmployeeIdsByHrEmpIds(hrIds)
  }
  const normalized = []
  for (const raw of slips) {
    const s = normalizePaySheetRow(raw, hrToPortalMap)
    if (s.employee_id == null || s.pay_month == null) continue
    normalized.push(s)
  }
  if (normalized.length === 0) return []

  const created = []
  const useFullColumns = true

  for (let i = 0; i < normalized.length; i += BATCH_SIZE) {
    const chunk = normalized.slice(i, i + BATCH_SIZE)
    const params = []
    const placeholders = chunk.map((s, idx) => {
      const base = idx * PARAMS_PER_ROW
      const rowParams = rowToParams(s)
      params.push(...rowParams)
      return '(' + rowParams.map((_, j) => `COALESCE($${base + j + 1}, NULL::${OLD_SLIP_PARAM_CASTS[j]})`).join(', ') + ')'
    }).join(', ')

    try {
      const sql = `INSERT INTO old_salary_slip (${OLD_SLIP_FULL_COLUMNS}) VALUES ${placeholders} RETURNING id, employee_id, pay_month`
      const r = await executeQuery(sql, params)
      created.push(...r)
    } catch (err) {
      if (err.code === '42703' && useFullColumns) {
        for (const s of chunk) {
          const r = await executeQuery(
            `INSERT INTO old_salary_slip (employee_id, pay_month, period_label, basic_salary, gross_salary, total_allowances, total_deductions, net_salary, status, remarks, source_employee_code)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id, employee_id, pay_month`,
            [s.employee_id, s.pay_month, s.period_label, s.basic_salary, s.gross_salary, s.total_allowances, s.total_deductions, s.net_salary, s.status, s.remarks, s.source_employee_code]
          )
          created.push(r[0])
        }
      } else throw err
    }
  }
  return created
}
