import { executeQuery } from '../../config/database.js'

export async function getCurrentSalary(employeeId) {
  return executeQuery(
    `SELECT ss.salary_slip_id, ss.month_year, ss.basic_salary, ss.allowances, ss.bonuses, ss.deductions, ss.net_salary, ss.created_at
     FROM salary_slips ss
     WHERE ss.employee_id = $1 AND DATE_TRUNC('month', ss.month_year) = DATE_TRUNC('month', CURRENT_DATE)
     ORDER BY ss.month_year DESC LIMIT 1`,
    [employeeId]
  )
}

export async function getSalaryHistory(employeeId, limit) {
  return executeQuery(
    `SELECT ss.salary_slip_id, TO_CHAR(ss.month_year, 'Month YYYY') as month, ss.net_salary as amount, ss.status, ss.created_at as date
     FROM salary_slips ss WHERE ss.employee_id = $1 ORDER BY ss.month_year DESC LIMIT $2`,
    [employeeId, limit]
  )
}

export async function getSalarySlipForDownload(salarySlipId) {
  return executeQuery(
    `SELECT ss.*, e.first_name, e.last_name, e.employee_code
     FROM salary_slips ss INNER JOIN employees e ON ss.employee_id = e.employee_id
     WHERE ss.salary_slip_id = $1`,
    [salarySlipId]
  )
}
