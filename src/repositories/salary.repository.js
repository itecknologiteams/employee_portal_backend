import { executeQuery } from '../../config/database.js'

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
