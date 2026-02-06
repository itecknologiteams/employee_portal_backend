import * as salaryRepo from '../repositories/salary.repository.js'

export async function getCurrentSalary(employeeId) {
  const result = await salaryRepo.getCurrentSalary(employeeId)
  if (result.length === 0) return null
  const s = result[0]
  return {
    basicSalary: parseFloat(s.basic_salary || 0),
    allowances: parseFloat(s.allowances || 0),
    bonuses: parseFloat(s.bonuses || 0),
    deductions: parseFloat(s.deductions || 0),
    total: parseFloat(s.net_salary || 0),
    month: s.month_year
  }
}

export async function getSalaryHistory(employeeId, limit = 12) {
  const result = await salaryRepo.getSalaryHistory(employeeId, limit)
  return result.map(slip => ({
    id: slip.salary_slip_id,
    month: slip.month,
    amount: `$${parseFloat(slip.amount || 0).toLocaleString()}`,
    status: slip.status || 'Paid',
    date: slip.date
  }))
}

export async function getSalarySlipForDownload(salarySlipId) {
  const result = await salaryRepo.getSalarySlipForDownload(salarySlipId)
  if (result.length === 0) return null
  return result[0]
}
