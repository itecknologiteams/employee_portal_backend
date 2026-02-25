import { executeQuery } from '../../config/database.js'

// ---------- Periods ----------
export async function countPeriods(status) {
  const where = status ? 'WHERE p.status = $1' : ''
  const params = status ? [status] : []
  const result = await executeQuery(
    `SELECT COUNT(*) AS total FROM payroll_period p ${where}`,
    params
  )
  return parseInt(result[0]?.total || 0, 10)
}

export async function listPeriods(status, limit, offset) {
  const where = status ? 'WHERE p.status = $1' : ''
  const params = status ? [status, limit, offset] : [limit, offset]
  const listQuery = `
    SELECT p.id, p.name, p.start_date, p.end_date, p.status, p.working_days,
           p.created_at, p.processed_at, p.closed_at,
           (SELECT COUNT(*) FROM payroll_slip s WHERE s.payroll_period_id = p.id) AS slip_count
    FROM payroll_period p
    ${where}
    ORDER BY p.start_date DESC
    LIMIT ${status ? '$2' : '$1'} OFFSET ${status ? '$3' : '$2'}
  `
  return executeQuery(listQuery, params)
}

export async function createPeriod(name, startDate, endDate, workingDays) {
  const result = await executeQuery(
    `INSERT INTO payroll_period (name, start_date, end_date, working_days, status)
     VALUES ($1, $2, $3, $4, 'draft')
     RETURNING id, name, start_date, end_date, working_days, status, created_at`,
    [name.trim(), startDate, endDate, workingDays]
  )
  return result[0]
}

export async function getPeriodById(id) {
  const rows = await executeQuery(
    `SELECT id, name, start_date, end_date, status, working_days, created_at, processed_at, closed_at
     FROM payroll_period WHERE id = $1`,
    [id]
  )
  return rows[0] || null
}

export async function getPeriodForRun(id) {
  const rows = await executeQuery(
    `SELECT id, start_date, end_date, working_days, status FROM payroll_period WHERE id = $1`,
    [id]
  )
  return rows[0] || null
}

export async function deletePeriod(id) {
  const result = await executeQuery(
    `DELETE FROM payroll_period WHERE id = $1 RETURNING id`,
    [id]
  )
  return result[0] || null
}

export async function setPeriodProcessing(id) {
  await executeQuery(
    `UPDATE payroll_period SET status = 'processing' WHERE id = $1`,
    [id]
  )
}

export async function setPeriodProcessed(id) {
  await executeQuery(
    `UPDATE payroll_period SET status = 'processed', processed_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [id]
  )
}

export async function setPeriodDraft(id) {
  await executeQuery(
    `UPDATE payroll_period SET status = 'draft' WHERE id = $1`,
    [id]
  )
}

export async function closePeriod(id) {
  const result = await executeQuery(
    `UPDATE payroll_period SET status = 'closed', closed_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND status IN ('draft', 'processed') RETURNING id`,
    [id]
  )
  return result[0] || null
}

// ---------- Overrides ----------
export async function getOverridesByPeriod(periodId) {
  return executeQuery(
    `SELECT employee_id, working_days, COALESCE(other_allowance, 0) AS other_allowance, COALESCE(other_deduction, 0) AS other_deduction,
            COALESCE(loan, 0) AS loan, COALESCE(salary_advance, 0) AS salary_advance
     FROM payroll_period_employee_override WHERE payroll_period_id = $1`,
    [periodId]
  ).catch((err) => {
    if (err.code === '42703') {
      return executeQuery(
        `SELECT employee_id, working_days, COALESCE(other_allowance, 0) AS other_allowance, COALESCE(other_deduction, 0) AS other_deduction,
                 0 AS loan, 0 AS salary_advance
         FROM payroll_period_employee_override WHERE payroll_period_id = $1`,
        [periodId]
      )
    }
    throw err
  })
}

export async function getActiveEmployees() {
  return executeQuery(
    `SELECT employee_id, first_name, last_name, employee_code FROM employees WHERE is_active = true ORDER BY first_name, last_name`
  )
}

export async function deleteOverridesForPeriod(periodId) {
  await executeQuery(
    `DELETE FROM payroll_period_employee_override WHERE payroll_period_id = $1`,
    [periodId]
  )
}

export async function upsertOverride(periodId, employeeId, workingDays, otherAllowance, otherDeduction, loan = 0, salaryAdvance = 0) {
  await executeQuery(
    `INSERT INTO payroll_period_employee_override (payroll_period_id, employee_id, working_days, other_allowance, other_deduction, loan, salary_advance)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (payroll_period_id, employee_id) DO UPDATE SET
       working_days = EXCLUDED.working_days, other_allowance = EXCLUDED.other_allowance, other_deduction = EXCLUDED.other_deduction,
       loan = EXCLUDED.loan, salary_advance = EXCLUDED.salary_advance`,
    [periodId, employeeId, workingDays, otherAllowance, otherDeduction, loan, salaryAdvance]
  ).catch((err) => {
    if (err.code === '42703') {
      return executeQuery(
        `INSERT INTO payroll_period_employee_override (payroll_period_id, employee_id, working_days, other_allowance, other_deduction)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (payroll_period_id, employee_id) DO UPDATE SET working_days = EXCLUDED.working_days, other_allowance = EXCLUDED.other_allowance, other_deduction = EXCLUDED.other_deduction`,
        [periodId, employeeId, workingDays, otherAllowance, otherDeduction]
      )
    }
    throw err
  })
}

// ---------- Gross salary (add by input: derive structure from gross + Date of Joining) ----------
// Cutoff: employees with Date of Joining before 1 Sept 2022 use 80% basic / 20% medical; on or after use 58.5% / 6.5% / 29% HRA / 6% utility.
const SEPT_2022_CUTOFF = '2022-09-01' // Compare as date string to avoid timezone issues

/** Get employee's Date of Joining (join_date from employees). Used to decide which gross-split rule applies. */
export async function getEmployeeJoinDate(employeeId) {
  const rows = await executeQuery(
    'SELECT join_date FROM employees WHERE employee_id = $1',
    [employeeId]
  )
  return rows[0]?.join_date ?? null
}

/** True if Date of Joining is before 1 September 2022 (use 80/20 rule). Uses UTC date so DB value 2022-09-01 is consistent. */
function isBeforeSeptember2022(joinDate) {
  if (!joinDate) return true // missing DOJ: treat as pre-Sept 2022
  const d = new Date(joinDate)
  const dateStr = d.toISOString().slice(0, 10) // YYYY-MM-DD in UTC
  return dateStr < SEPT_2022_CUTOFF
}

/** Resolve employee_id from employee code (string) or id (number). Returns null if not found. */
export async function getEmployeeIdByCodeOrId(codeOrId) {
  if (codeOrId == null || String(codeOrId).trim() === '') return null
  const str = String(codeOrId).trim()
  const asInt = parseInt(str, 10)
  if (Number.isInteger(asInt)) {
    const byId = await executeQuery(
      'SELECT employee_id FROM employees WHERE is_active = true AND employee_id = $1 LIMIT 1',
      [asInt]
    )
    if (byId.length) return byId[0].employee_id
  }
  const byCode = await executeQuery(
    'SELECT employee_id FROM employees WHERE is_active = true AND (employee_code = $1 OR employee_code::text = $1) LIMIT 1',
    [str]
  )
  return byCode.length ? byCode[0].employee_id : null
}

/** Upsert into employee_gross_salary (so list and Excel can use it). */
export async function upsertGrossSalary(employeeId, grossSalary) {
  const gross = parseFloat(grossSalary)
  if (!Number.isFinite(gross) || gross < 0) return
  await executeQuery(
    `INSERT INTO employee_gross_salary (employee_id, gross_salary, updated_at)
     VALUES ($1, $2, CURRENT_TIMESTAMP)
     ON CONFLICT (employee_id) DO UPDATE SET
       gross_salary = EXCLUDED.gross_salary,
       updated_at = CURRENT_TIMESTAMP`,
    [employeeId, gross]
  ).catch((err) => {
    if (err.code === '42P01') {
      throw new Error('employee_gross_salary table not found. Run database/migration-gross-salary.sql')
    }
    throw err
  })
}

export async function listGrossSalaries(searchParam, limit, offset) {
  const searchCondition = searchParam
    ? `AND (e.first_name ILIKE $1 OR e.last_name ILIKE $1 OR e.employee_code::text ILIKE $1 OR CONCAT(e.first_name, ' ', e.last_name) ILIKE $1)`
    : ''
  const params = searchParam ? [searchParam, limit, offset] : [limit, offset]
  const limitIdx = searchParam ? 2 : 1
  const offsetIdx = searchParam ? 3 : 2
  return executeQuery(
    `SELECT g.employee_id, g.gross_salary, g.updated_at,
            e.first_name, e.last_name, e.employee_code
     FROM employee_gross_salary g
     JOIN employees e ON e.employee_id = g.employee_id
     WHERE 1=1 ${searchCondition}
     ORDER BY g.updated_at DESC, e.first_name, e.last_name
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params
  ).catch((err) => {
    if (err.code === '42P01') return [] // table not created yet
    throw err
  })
}

export async function countGrossSalaries(searchParam) {
  const searchCondition = searchParam
    ? `AND (e.first_name ILIKE $1 OR e.last_name ILIKE $1 OR e.employee_code::text ILIKE $1 OR CONCAT(e.first_name, ' ', e.last_name) ILIKE $1)`
    : ''
  const params = searchParam ? [searchParam] : []
  const result = await executeQuery(
    `SELECT COUNT(*)::int AS total
     FROM employee_gross_salary g
     JOIN employees e ON e.employee_id = g.employee_id
     WHERE 1=1 ${searchCondition}`,
    params
  ).catch((err) => {
    if (err.code === '42P01') return [{ total: 0 }]
    throw err
  })
  return parseInt(result[0]?.total ?? 0, 10)
}

/** Compute basic/medical/hra/utilities from gross using Date of Joining rules; other allowances 0. */
export function computeStructureFromGross(grossSalary, joinDate) {
  const gross = parseFloat(grossSalary) || 0
  if (gross <= 0) return null
  const beforeSep2022 = isBeforeSeptember2022(joinDate)
  if (beforeSep2022) {
    return {
      basicSalary: Math.round(gross * 0.8 * 100) / 100,
      medicalAllowance: Math.round(gross * 0.2 * 100) / 100,
      conveyanceAllowance: 0,
      conveyanceLitersAllowance: 0,
      communicationAllowance: 0,
      houseRentAllowance: 0,
      utilitiesAllowance: 0,
      mealAllowance: 0,
      otherAllowance: 0,
      arrears: 0,
      incrementalArrears: 0,
      bikeMaintenanceAllowance: 0,
      incentives: 0,
      deviceReimbursement: 0,
      eobiFixed: 130
    }
  }
  return {
    basicSalary: Math.round(gross * 0.585 * 100) / 100,
    medicalAllowance: Math.round(gross * 0.065 * 100) / 100,
    conveyanceAllowance: 0,
    conveyanceLitersAllowance: 0,
    communicationAllowance: 0,
    houseRentAllowance: Math.round(gross * 0.29 * 100) / 100,
    utilitiesAllowance: Math.round(gross * 0.06 * 100) / 100,
    mealAllowance: 0,
    otherAllowance: 0,
    arrears: 0,
    incrementalArrears: 0,
    bikeMaintenanceAllowance: 0,
    incentives: 0,
    deviceReimbursement: 0,
    eobiFixed: 130
  }
}

// ---------- Employee search (for Gross Salaries etc.) ----------
export async function searchEmployees(searchTerm, limit = 50) {
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 50))
  const pattern = searchTerm && String(searchTerm).trim() ? `%${String(searchTerm).trim()}%` : '%'
  const hasSearch = pattern !== '%'
  const where = hasSearch
    ? 'WHERE (e.first_name ILIKE $1 OR e.last_name ILIKE $1 OR e.email ILIKE $1 OR e.employee_code ILIKE $1) AND e.is_active = true'
    : 'WHERE e.is_active = true'
  const params = hasSearch ? [pattern, safeLimit] : [safeLimit]
  const limitParam = hasSearch ? '$2' : '$1'
  return executeQuery(
    `SELECT e.employee_id AS id, e.employee_code AS code, e.first_name, e.last_name, e.email
     FROM employees e
     ${where}
     ORDER BY e.first_name, e.last_name
     LIMIT ${limitParam}`,
    params
  )
}

// ---------- Run payroll ----------
export async function getEmployeesForPayroll() {
  return executeQuery(
    `SELECT employee_id, designation_id FROM employees WHERE is_active = true`
  )
}

export async function getDesignationAllowances() {
  return executeQuery(`SELECT desg_id, fixed_allowance FROM designation_allowance`).catch(() => [])
}

const salaryStructureColumns = `employee_id, basic_salary, medical_allowance, conveyance_allowance,
  conveyance_liters_allowance, communication_allowance, house_rent_allowance, utilities_allowance, meal_allowance,
  other_allowance, arrears, incremental_arrears, bike_maintenance_allowance, incentives, device_reimbursement, eobi_fixed`
const salaryStructureColumnsLegacy = `employee_id, basic_salary, medical_allowance, conveyance_allowance,
  house_rent_allowance, utilities_allowance, meal_allowance, other_allowance, eobi_fixed`

export async function getSalaryStructures() {
  return executeQuery(
    `SELECT ${salaryStructureColumns} FROM employee_salary_structure`
  ).catch((err) => {
    if (err.code === '42703') {
      return executeQuery(`SELECT ${salaryStructureColumnsLegacy} FROM employee_salary_structure`)
    }
    throw err
  })
}

export async function getApprovedLeavesInRange(startDate, endDate) {
  return executeQuery(
    `SELECT employee_id, start_date, end_date FROM leave_requests
     WHERE status = 'Approved' AND end_date >= $1 AND start_date <= $2`,
    [startDate, endDate]
  )
}

export async function getOverridesForRun(periodId) {
  return executeQuery(
    `SELECT employee_id, working_days, COALESCE(other_allowance, 0) AS other_allowance, COALESCE(other_deduction, 0) AS other_deduction,
            COALESCE(loan, 0) AS loan, COALESCE(salary_advance, 0) AS salary_advance
     FROM payroll_period_employee_override WHERE payroll_period_id = $1`,
    [periodId]
  ).catch((err) => {
    if (err.code === '42703') {
      return executeQuery(
        `SELECT employee_id, working_days, COALESCE(other_allowance, 0) AS other_allowance, COALESCE(other_deduction, 0) AS other_deduction,
                 0 AS loan, 0 AS salary_advance
         FROM payroll_period_employee_override WHERE payroll_period_id = $1`,
        [periodId]
      )
    }
    throw err
  })
}

export async function upsertPayrollSlip(slip) {
  await executeQuery(
    `INSERT INTO payroll_slip (
      payroll_period_id, employee_id, working_days, paid_days, absent_days,
      gross_salary, total_allowances, total_deductions, net_salary,
      eobi_deduction, absent_deduction, other_deduction, other_allowance, status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'Generated')
    ON CONFLICT (payroll_period_id, employee_id) DO UPDATE SET
      working_days = EXCLUDED.working_days,
      paid_days = EXCLUDED.paid_days,
      absent_days = EXCLUDED.absent_days,
      gross_salary = EXCLUDED.gross_salary,
      total_allowances = EXCLUDED.total_allowances,
      total_deductions = EXCLUDED.total_deductions,
      net_salary = EXCLUDED.net_salary,
      eobi_deduction = EXCLUDED.eobi_deduction,
      absent_deduction = EXCLUDED.absent_deduction,
      other_deduction = EXCLUDED.other_deduction,
      other_allowance = EXCLUDED.other_allowance,
      status = 'Generated'`,
    [
      slip.periodId, slip.employeeId, slip.workingDays, slip.paidDays, slip.absentDays,
      slip.grossSalary, slip.totalAllowances, slip.totalDeductions, slip.netSalary,
      slip.eobiDeduction, slip.absentDeduction, slip.otherDeduction, slip.otherAllowance
    ]
  )
}

// ---------- Slips ----------
export async function countSlips(periodId, searchParam) {
  const searchCondition = searchParam
    ? `AND (e.first_name ILIKE $2 OR e.last_name ILIKE $2 OR e.employee_code::text ILIKE $2 OR CONCAT(e.first_name, ' ', e.last_name) ILIKE $2)`
    : ''
  const params = searchParam ? [periodId, searchParam] : [periodId]
  const result = await executeQuery(
    `SELECT COUNT(*) AS total
     FROM payroll_slip s
     JOIN employees e ON e.employee_id = s.employee_id
     WHERE s.payroll_period_id = $1 ${searchCondition}`,
    params
  )
  return parseInt(result[0]?.total || 0, 10)
}

export async function listSlips(periodId, searchParam, limit, offset) {
  const searchCondition = searchParam
    ? `AND (e.first_name ILIKE $2 OR e.last_name ILIKE $2 OR e.employee_code::text ILIKE $2 OR CONCAT(e.first_name, ' ', e.last_name) ILIKE $2)`
    : ''
  const params = searchParam ? [periodId, searchParam, limit, offset] : [periodId, limit, offset]
  const listQuery = `
    SELECT s.id, s.employee_id, s.working_days, s.paid_days, s.absent_days,
           s.gross_salary, s.total_allowances, s.total_deductions, s.net_salary,
           s.status, s.remarks,
           e.first_name, e.last_name, e.employee_code
    FROM payroll_slip s
    JOIN employees e ON e.employee_id = s.employee_id
    WHERE s.payroll_period_id = $1 ${searchCondition}
    ORDER BY e.first_name, e.last_name
    LIMIT ${searchParam ? '$3' : '$2'} OFFSET ${searchParam ? '$4' : '$3'}
  `
  return executeQuery(listQuery, params)
}

// ---------- Designation allowances ----------
export async function listDesignationAllowances() {
  return executeQuery(
    `SELECT d.desg_id, d.desg_name, COALESCE(da.fixed_allowance, 0) AS fixed_allowance
     FROM designation d
     LEFT JOIN designation_allowance da ON da.desg_id = d.desg_id
     ORDER BY d.desg_name`
  )
}

export async function upsertDesignationAllowance(desgId, fixedAllowance) {
  await executeQuery(
    `INSERT INTO designation_allowance (desg_id, fixed_allowance) VALUES ($1, $2)
     ON CONFLICT (desg_id) DO UPDATE SET fixed_allowance = EXCLUDED.fixed_allowance`,
    [desgId, fixedAllowance]
  )
}

// ---------- Salary structures ----------
export async function countActiveEmployees(searchParam) {
  const searchCondition = searchParam
    ? `AND (e.first_name ILIKE $1 OR e.last_name ILIKE $1 OR e.employee_code::text ILIKE $1 OR CONCAT(e.first_name, ' ', e.last_name) ILIKE $1)`
    : ''
  const params = searchParam ? [searchParam] : []
  const countResult = await executeQuery(
    `SELECT COUNT(*) AS total FROM employees e WHERE e.is_active = true ${searchCondition}`,
    params
  )
  return parseInt(countResult[0]?.total || 0, 10)
}

export async function listSalaryStructures(searchParam, limit, offset) {
  const searchCondition = searchParam
    ? `AND (e.first_name ILIKE $1 OR e.last_name ILIKE $1 OR e.employee_code::text ILIKE $1 OR CONCAT(e.first_name, ' ', e.last_name) ILIKE $1)`
    : ''
  const params = searchParam ? [searchParam, limit, offset] : [limit, offset]
  const listQuery = `
    SELECT e.employee_id, e.first_name, e.last_name, e.employee_code,
           s.id AS structure_id, s.basic_salary, s.medical_allowance, s.conveyance_allowance,
           s.conveyance_liters_allowance, s.communication_allowance,
           s.house_rent_allowance, s.utilities_allowance, s.meal_allowance, s.other_allowance,
           s.arrears, s.incremental_arrears, s.bike_maintenance_allowance, s.incentives, s.device_reimbursement,
           s.eobi_fixed, s.effective_from
    FROM employees e
    LEFT JOIN employee_salary_structure s ON s.employee_id = e.employee_id
    WHERE e.is_active = true ${searchCondition}
    ORDER BY e.first_name, e.last_name
    LIMIT ${searchParam ? '$2' : '$1'} OFFSET ${searchParam ? '$3' : '$2'}
  `
  return executeQuery(listQuery, params).catch((err) => {
    if (err.code === '42703') {
      const legacyQuery = `
        SELECT e.employee_id, e.first_name, e.last_name, e.employee_code,
               s.id AS structure_id, s.basic_salary, s.medical_allowance, s.conveyance_allowance,
               s.house_rent_allowance, s.utilities_allowance, s.meal_allowance, s.other_allowance,
               s.eobi_fixed, s.effective_from
        FROM employees e
        LEFT JOIN employee_salary_structure s ON s.employee_id = e.employee_id
        WHERE e.is_active = true ${searchCondition}
        ORDER BY e.first_name, e.last_name
        LIMIT ${searchParam ? '$2' : '$1'} OFFSET ${searchParam ? '$3' : '$2'}
      `
      return executeQuery(legacyQuery, params)
    }
    throw err
  })
}

export async function getSalaryStructureByEmployee(employeeId) {
  const rows = await executeQuery(
    `SELECT * FROM employee_salary_structure WHERE employee_id = $1`,
    [employeeId]
  )
  return rows[0] || null
}

export async function upsertSalaryStructure(data) {
  const fullParams = [
    data.employeeId, data.basicSalary ?? 0, data.medicalAllowance ?? 0, data.conveyanceAllowance ?? 0,
    data.conveyanceLitersAllowance ?? 0, data.communicationAllowance ?? 0,
    data.houseRentAllowance ?? 0, data.utilitiesAllowance ?? 0, data.mealAllowance ?? 0, data.otherAllowance ?? 0,
    data.arrears ?? 0, data.incrementalArrears ?? 0, data.bikeMaintenanceAllowance ?? 0, data.incentives ?? 0, data.deviceReimbursement ?? 0,
    data.eobiFixed ?? 130
  ]
  await executeQuery(
    `INSERT INTO employee_salary_structure (
      employee_id, basic_salary, medical_allowance, conveyance_allowance,
      conveyance_liters_allowance, communication_allowance,
      house_rent_allowance, utilities_allowance, meal_allowance, other_allowance,
      arrears, incremental_arrears, bike_maintenance_allowance, incentives, device_reimbursement,
      eobi_fixed
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    ON CONFLICT (employee_id) DO UPDATE SET
      basic_salary = EXCLUDED.basic_salary,
      medical_allowance = EXCLUDED.medical_allowance,
      conveyance_allowance = EXCLUDED.conveyance_allowance,
      conveyance_liters_allowance = EXCLUDED.conveyance_liters_allowance,
      communication_allowance = EXCLUDED.communication_allowance,
      house_rent_allowance = EXCLUDED.house_rent_allowance,
      utilities_allowance = EXCLUDED.utilities_allowance,
      meal_allowance = EXCLUDED.meal_allowance,
      other_allowance = EXCLUDED.other_allowance,
      arrears = EXCLUDED.arrears,
      incremental_arrears = EXCLUDED.incremental_arrears,
      bike_maintenance_allowance = EXCLUDED.bike_maintenance_allowance,
      incentives = EXCLUDED.incentives,
      device_reimbursement = EXCLUDED.device_reimbursement,
      eobi_fixed = EXCLUDED.eobi_fixed,
      updated_at = CURRENT_TIMESTAMP`,
    fullParams
  ).catch((err) => {
    if (err.code === '42703') {
      return executeQuery(
        `INSERT INTO employee_salary_structure (
          employee_id, basic_salary, medical_allowance, conveyance_allowance,
          house_rent_allowance, utilities_allowance, meal_allowance, other_allowance, eobi_fixed
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (employee_id) DO UPDATE SET
          basic_salary = EXCLUDED.basic_salary,
          medical_allowance = EXCLUDED.medical_allowance,
          conveyance_allowance = EXCLUDED.conveyance_allowance,
          house_rent_allowance = EXCLUDED.house_rent_allowance,
          utilities_allowance = EXCLUDED.utilities_allowance,
          meal_allowance = EXCLUDED.meal_allowance,
          other_allowance = EXCLUDED.other_allowance,
          eobi_fixed = EXCLUDED.eobi_fixed,
          updated_at = CURRENT_TIMESTAMP`,
        [
          data.employeeId, data.basicSalary ?? 0, data.medicalAllowance ?? 0, data.conveyanceAllowance ?? 0,
          data.houseRentAllowance ?? 0, data.utilitiesAllowance ?? 0, data.mealAllowance ?? 0, data.otherAllowance ?? 0, data.eobiFixed ?? 130
        ]
      )
    }
    throw err
  })
  return executeQuery(
    `SELECT id, employee_id, basic_salary, medical_allowance, conveyance_allowance,
            conveyance_liters_allowance, communication_allowance,
            house_rent_allowance, utilities_allowance, meal_allowance, other_allowance,
            arrears, incremental_arrears, bike_maintenance_allowance, incentives, device_reimbursement,
            eobi_fixed
     FROM employee_salary_structure WHERE employee_id = $1`,
    [data.employeeId]
  ).catch((err) => {
    if (err.code === '42703') {
      return executeQuery(
        `SELECT id, employee_id, basic_salary, medical_allowance, conveyance_allowance,
                house_rent_allowance, utilities_allowance, meal_allowance, other_allowance, eobi_fixed
         FROM employee_salary_structure WHERE employee_id = $1`,
        [data.employeeId]
      )
    }
    throw err
  })
}
