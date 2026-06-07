import { executeQuery } from '../../config/database.js'

/** Default entitlements when inserting a new balance row. */
export const DEFAULT_ANNUAL = 14
export const DEFAULT_CASUAL = 10
export const DEFAULT_SICK = 6
export const DEFAULT_MARRIAGE = 10
export const DEFAULT_MATERNITY = 90
export const DEFAULT_PATERNAL = 7
export const DEFAULT_PILGRIMAGE = 20

/** All portal-managed leave types that support requests and deductions. */
export const PORTAL_LEAVE_TYPES = ['annual', 'marriage', 'maternity', 'paternal', 'pilgrimage']

/** Gender-specific leave types. */
export const GENDER_SPECIFIC_LEAVES = {
  maternity: 'Female',
  paternal: 'Male'
}

/** Check if a leave type is managed by the portal (not external). */
export function isPortalLeaveType(leaveType) {
  const t = String(leaveType || '').trim().toLowerCase().replace(/\s+/g, '').replace('leave', '')
  return PORTAL_LEAVE_TYPES.includes(t) || PORTAL_LEAVE_TYPES.some(pt => t.includes(pt))
}

/** Get the column name for a leave type in the leave_balance table. */
export function getLeaveBalanceColumn(leaveType) {
  const t = String(leaveType || '').trim().toLowerCase().replace(/\s+/g, '').replace('leave', '')
  if (t === 'annual' || t.includes('annual')) return 'annual_leave'
  if (t === 'marriage' || t.includes('marriage')) return 'marriage_leave'
  if (t === 'maternity' || t.includes('maternity')) return 'maternity_leave'
  if (t === 'paternal' || t.includes('paternal') || t === 'paternity' || t.includes('paternity')) return 'paternal_leave'
  if (t === 'pilgrimage' || t.includes('pilgrimage')) return 'pilgrimage_leave'
  if (t === 'casual' || t.includes('casual')) return 'casual_leave'
  if (t === 'sick' || t.includes('sick')) return 'sick_leave'
  return null
}

/** Get employee join date for calculating prorated annual leave. */
export async function getEmployeeJoinDate(employeeId) {
  const rows = await executeQuery(
    'SELECT join_date FROM employees WHERE employee_id = $1',
    [employeeId]
  )
  return rows[0]?.join_date ?? null
}

/** Calculate prorated annual leave based on join date.
 * Formula: 14(AL)/12 * Remaining Months in completion of year
 * After completing 1 year, employee gets full 14 days
 */
export function calculateProratedAnnualLeave(joinDate) {
  if (!joinDate) return DEFAULT_ANNUAL

  const today = new Date()
  const join = new Date(joinDate)

  // Calculate one year anniversary date
  const oneYearAnniversary = new Date(join)
  oneYearAnniversary.setFullYear(oneYearAnniversary.getFullYear() + 1)

  // If employee has completed 1 year, return full annual leave
  if (today >= oneYearAnniversary) {
    return DEFAULT_ANNUAL
  }

  // Calculate remaining months until 1 year completion
  // Count full months from next month after joining until the 1-year mark
  let remainingMonths = 0

  // Start from the month after join month
  const startMonth = new Date(join.getFullYear(), join.getMonth() + 1, 1)

  // Count months until one year anniversary
  let current = new Date(startMonth)
  while (current < oneYearAnniversary) {
    remainingMonths++
    current.setMonth(current.getMonth() + 1)
  }

  // Formula: 14/12 * Remaining Months
  // Round to nearest integer (at least 1 day if they just joined)
  const prorated = Math.max(1, Math.round((DEFAULT_ANNUAL / 12) * remainingMonths))

  return prorated
}

/** Calculate prorated annual leave by employee code. */
export async function calculateProratedAnnualLeaveByCode(employeeCode) {
  const code = String(employeeCode || '').trim()
  if (!code) return DEFAULT_ANNUAL

  const rows = await executeQuery(
    'SELECT join_date FROM employees WHERE employee_code = $1',
    [code]
  )

  return calculateProratedAnnualLeave(rows[0]?.join_date)
}

/** Check if employee has completed 2 or more years. */
export function hasCompletedTwoYears(joinDate) {
  if (!joinDate) return false

  const today = new Date()
  const join = new Date(joinDate)

  // Calculate two year anniversary date
  const twoYearAnniversary = new Date(join)
  twoYearAnniversary.setFullYear(twoYearAnniversary.getFullYear() + 2)

  return today >= twoYearAnniversary
}

/** Get years of service for an employee. */
export function getYearsOfService(joinDate) {
  if (!joinDate) return 0

  const today = new Date()
  const join = new Date(joinDate)

  let years = today.getFullYear() - join.getFullYear()

  // Adjust if anniversary hasn't occurred yet this year
  const anniversaryThisYear = new Date(join)
  anniversaryThisYear.setFullYear(today.getFullYear())

  if (today < anniversaryThisYear) {
    years--
  }

  return Math.max(0, years)
}

/** Annual leave rollover: Move remaining annual leaves to carried_forward and reset annual leave.
 * This should be called when an employee completes 2+ years.
 * Returns the rollover details or null if not eligible.
 */
export async function rolloverAnnualLeave(employeeId) {
  // Get employee join date and current balance
  const employeeRows = await executeQuery(
    `SELECT e.join_date, lb.annual_leave, lb.carried_forward
     FROM employees e
     LEFT JOIN leave_balance lb ON lb.employee_id = e.employee_id
     WHERE e.employee_id = $1`,
    [employeeId]
  )

  if (employeeRows.length === 0) {
    throw new Error('Employee not found')
  }

  const { join_date, annual_leave, carried_forward } = employeeRows[0]

  // Check if employee has completed 2 years
  if (!hasCompletedTwoYears(join_date)) {
    return {
      eligible: false,
      reason: 'Employee has not completed 2 years yet',
      yearsOfService: getYearsOfService(join_date)
    }
  }

  const currentAnnual = parseInt(annual_leave || 0, 10)
  const currentCarried = parseInt(carried_forward || 0, 10)

  // Calculate new carried forward (remaining annual + existing carried)
  const newCarriedForward = currentAnnual + currentCarried

  // Reset annual leave to default (14 days) - this is the new quota
  const newAnnualLeave = DEFAULT_ANNUAL

  // Perform the rollover
  const result = await executeQuery(
    `UPDATE leave_balance
     SET annual_leave = $2,
         carried_forward = $3,
         updated_at = CURRENT_TIMESTAMP
     WHERE employee_id = $1
     RETURNING annual_leave, carried_forward, updated_at`,
    [employeeId, newAnnualLeave, newCarriedForward]
  )

  if (result.length === 0) {
    throw new Error('Failed to update leave balance')
  }

  return {
    eligible: true,
    yearsOfService: getYearsOfService(join_date),
    previousAnnual: currentAnnual,
    previousCarried: currentCarried,
    newAnnualLeave: result[0].annual_leave,
    newCarriedForward: result[0].carried_forward,
    rolledOverAmount: currentAnnual,
    rolloverDate: result[0].updated_at
  }
}

/** Rollover annual leave by employee code. */
export async function rolloverAnnualLeaveByCode(employeeCode) {
  const code = String(employeeCode || '').trim()
  if (!code) throw new Error('Employee code is required')

  // Get employee ID
  const rows = await executeQuery(
    'SELECT employee_id FROM employees WHERE employee_code = $1',
    [code]
  )

  if (rows.length === 0) {
    throw new Error('Employee not found')
  }

  return rolloverAnnualLeave(rows[0].employee_id)
}

/** Bulk rollover for all eligible employees (2+ years).
 * Returns summary of processed employees.
 */
export async function bulkRolloverAnnualLeaves() {
  // Get all employees with 2+ years of service
  const eligibleEmployees = await executeQuery(
    `SELECT e.employee_id, e.employee_code, e.join_date,
            lb.annual_leave, lb.carried_forward
     FROM employees e
     LEFT JOIN leave_balance lb ON lb.employee_id = e.employee_id
     WHERE e.join_date <= $1
       AND e.is_active = true`,
    [new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]] // 2 years ago
  )

  const results = {
    processed: 0,
    skipped: 0,
    details: []
  }

  for (const emp of eligibleEmployees) {
    try {
      if (!hasCompletedTwoYears(emp.join_date)) {
        results.skipped++
        continue
      }

      const currentAnnual = parseInt(emp.annual_leave || 0, 10)
      const currentCarried = parseInt(emp.carried_forward || 0, 10)
      const newCarriedForward = currentAnnual + currentCarried

      await executeQuery(
        `UPDATE leave_balance
         SET annual_leave = $2,
             carried_forward = $3,
             updated_at = CURRENT_TIMESTAMP
         WHERE employee_id = $1`,
        [emp.employee_id, DEFAULT_ANNUAL, newCarriedForward]
      )

      results.processed++
      results.details.push({
        employeeCode: emp.employee_code,
        yearsOfService: getYearsOfService(emp.join_date),
        rolledOverAmount: currentAnnual,
        newCarriedForward,
        newAnnualLeave: DEFAULT_ANNUAL
      })
    } catch (err) {
      results.details.push({
        employeeCode: emp.employee_code,
        error: err?.message || 'Failed to process'
      })
    }
  }

  return results
}

export async function ensureLeaveBalanceRow(employeeId) {
  // Get employee join date and calculate prorated annual leave
  const joinDate = await getEmployeeJoinDate(employeeId)
  const proratedAnnual = calculateProratedAnnualLeave(joinDate)

  // Insert with gender-based leave assignments
  await executeQuery(
    `INSERT INTO leave_balance (employee_id, employee_code, annual_leave, casual_leave, sick_leave, personal_leave, carried_forward, marriage_leave, maternity_leave, paternal_leave, pilgrimage_leave)
     SELECT $1, e.employee_code, $2, $3, $4, 0, 0, $5,
       CASE WHEN LOWER(TRIM(e.gender)) = 'female' THEN $6 ELSE 0 END,
       CASE WHEN LOWER(TRIM(e.gender)) = 'male' THEN $7 ELSE 0 END,
       $8
     FROM employees e WHERE e.employee_id = $1
     ON CONFLICT (employee_id) DO NOTHING`,
    [employeeId, proratedAnnual, DEFAULT_CASUAL, DEFAULT_SICK, DEFAULT_MARRIAGE, DEFAULT_MATERNITY, DEFAULT_PATERNAL, DEFAULT_PILGRIMAGE]
  )
}

/** Create or update leave balance by employee_code (for CSV import).
 * Gender-based leave assignment:
 * - Female employees: maternity_leave only
 * - Male employees: paternal_leave only
 */
export async function upsertLeaveBalanceByEmployeeCode(employeeCode, balances) {
  const code = String(employeeCode || '').trim()
  if (!code) throw new Error('Employee code is required')

  // Calculate prorated annual leave if not explicitly provided
  const joinDate = await getEmployeeJoinDateByCode(code)
  const proratedAnnual = calculateProratedAnnualLeave(joinDate)

  // Get employee gender for gender-based leave assignment
  const genderRows = await executeQuery(
    `SELECT LOWER(TRIM(gender)) as gender FROM employees WHERE employee_code = $1`,
    [code]
  )
  const gender = genderRows[0]?.gender || ''
  const isFemale = gender === 'female'
  const isMale = gender === 'male'

  const {
    annual = proratedAnnual, // Use prorated annual leave if not provided
    casual = DEFAULT_CASUAL,
    sick = DEFAULT_SICK,
    carried = 0,
    marriage = DEFAULT_MARRIAGE,
    // Gender-based defaults: maternity for female, paternal for male
    maternity = isFemale ? DEFAULT_MATERNITY : 0,
    paternal = isMale ? DEFAULT_PATERNAL : 0,
    pilgrimage = DEFAULT_PILGRIMAGE
  } = balances

  return executeQuery(
    `INSERT INTO leave_balance (employee_id, employee_code, annual_leave, casual_leave, sick_leave, personal_leave, carried_forward, marriage_leave, maternity_leave, paternal_leave, pilgrimage_leave)
     SELECT e.employee_id, e.employee_code, $2, $3, $4, 0, $5, $6, $7, $8, $9
     FROM employees e WHERE e.employee_code = $1
     ON CONFLICT (employee_id) DO UPDATE SET
       annual_leave = EXCLUDED.annual_leave,
       casual_leave = EXCLUDED.casual_leave,
       sick_leave = EXCLUDED.sick_leave,
       carried_forward = EXCLUDED.carried_forward,
       marriage_leave = EXCLUDED.marriage_leave,
       maternity_leave = EXCLUDED.maternity_leave,
       paternal_leave = EXCLUDED.paternal_leave,
       pilgrimage_leave = EXCLUDED.pilgrimage_leave,
       updated_at = CURRENT_TIMESTAMP
     RETURNING employee_id, employee_code, annual_leave, casual_leave, sick_leave, carried_forward, marriage_leave, maternity_leave, paternal_leave, pilgrimage_leave`,
    [code, annual, casual, sick, carried, marriage, maternity, paternal, pilgrimage]
  )
}

/** Update only carried_forward for an employee by employee_code.
 * This is used for the one-time carried forward import.
 * Does NOT modify other leave types.
 */
export async function updateCarriedForwardByEmployeeCode(employeeCode, carriedDays) {
  const code = String(employeeCode || '').trim()
  if (!code) throw new Error('Employee code is required')

  const carried = Math.max(0, Math.floor(Number(carriedDays) || 0))

  // First ensure the employee has a leave_balance row
  await executeQuery(
    `INSERT INTO leave_balance (employee_id, employee_code, annual_leave, casual_leave, sick_leave, personal_leave, carried_forward, marriage_leave, maternity_leave, paternal_leave, pilgrimage_leave)
     SELECT e.employee_id, e.employee_code, $2, $3, $4, 0, $5, $6,
       CASE WHEN LOWER(TRIM(e.gender)) = 'female' THEN $7 ELSE 0 END,
       CASE WHEN LOWER(TRIM(e.gender)) = 'male' THEN $8 ELSE 0 END,
       $9
     FROM employees e WHERE e.employee_code = $1
     ON CONFLICT (employee_id) DO NOTHING`,
    [
      code,
      DEFAULT_ANNUAL,
      DEFAULT_CASUAL,
      DEFAULT_SICK,
      0, // carried_forward - will be updated below
      DEFAULT_MARRIAGE,
      DEFAULT_MATERNITY,
      DEFAULT_PATERNAL,
      DEFAULT_PILGRIMAGE
    ]
  )

  // Now update only carried_forward
  return executeQuery(
    `UPDATE leave_balance lb
     SET carried_forward = $2,
         updated_at = CURRENT_TIMESTAMP
     FROM employees e
     WHERE lb.employee_id = e.employee_id
       AND e.employee_code = $1
     RETURNING lb.employee_id, e.employee_code, lb.carried_forward, lb.annual_leave`,
    [code, carried]
  )
}

/** ===== Annual leave: sheet import + yearly allocation ===== */

/**
 * Set an employee's annual_leave from the import sheet. Also initializes the yearly-allocation
 * tracking for existing/tenured staff (proration marked granted, last-allocated = current year)
 * so the import doubles as initialization and never triggers retroactive proration.
 */
export async function updateAnnualLeaveByEmployeeCode(employeeCode, annualDays) {
  const code = String(employeeCode || '').trim()
  if (!code) throw new Error('Employee code is required')
  const annual = Math.max(0, Math.floor(Number(annualDays) || 0))

  await executeQuery(
    `INSERT INTO leave_balance (employee_id, employee_code, annual_leave, casual_leave, sick_leave, personal_leave, carried_forward, marriage_leave, maternity_leave, paternal_leave, pilgrimage_leave)
     SELECT e.employee_id, e.employee_code, $2, $3, $4, 0, 0, $5,
       CASE WHEN LOWER(TRIM(e.gender)) = 'female' THEN $6 ELSE 0 END,
       CASE WHEN LOWER(TRIM(e.gender)) = 'male' THEN $7 ELSE 0 END,
       $8
     FROM employees e WHERE e.employee_code = $1
     ON CONFLICT (employee_id) DO NOTHING`,
    [code, DEFAULT_ANNUAL, DEFAULT_CASUAL, DEFAULT_SICK, DEFAULT_MARRIAGE, DEFAULT_MATERNITY, DEFAULT_PATERNAL, DEFAULT_PILGRIMAGE]
  )

  return executeQuery(
    `UPDATE leave_balance lb
     SET annual_leave = $2,
         annual_proration_granted_at = COALESCE(lb.annual_proration_granted_at, CURRENT_DATE),
         annual_last_allocated_year = COALESCE(lb.annual_last_allocated_year, EXTRACT(YEAR FROM CURRENT_DATE)::int),
         updated_at = CURRENT_TIMESTAMP
     FROM employees e
     WHERE lb.employee_id = e.employee_id AND e.employee_code = $1
     RETURNING lb.employee_id, e.employee_code, lb.annual_leave, lb.carried_forward`,
    [code, annual]
  )
}

/** Active employees with their join date and current annual-allocation state. */
export async function getActiveEmployeesForAnnualAllocation() {
  return executeQuery(
    `SELECT e.employee_id, e.employee_code, e.first_name, e.last_name, e.join_date,
            COALESCE(lb.annual_leave, 0) AS annual_leave,
            COALESCE(lb.carried_forward, 0) AS carried_forward,
            lb.annual_proration_granted_at, lb.annual_last_allocated_year
     FROM employees e
     LEFT JOIN leave_balance lb ON lb.employee_id = e.employee_id
     WHERE e.is_active = true AND e.join_date IS NOT NULL`
  )
}

/** Grant the one-time anniversary proration: set annual + stamp tracking. */
export async function applyAnnualProration(employeeId, proratedDays, todayYmd, year) {
  return executeQuery(
    `UPDATE leave_balance
     SET annual_leave = $2, annual_proration_granted_at = $3, annual_last_allocated_year = $4, updated_at = CURRENT_TIMESTAMP
     WHERE employee_id = $1
     RETURNING employee_id, annual_leave, carried_forward`,
    [employeeId, Math.max(0, Math.round(Number(proratedDays) || 0)), todayYmd, year]
  )
}

/** January reset: carry remaining annual into carried_forward, reset annual to 14. */
export async function applyAnnualJanuaryReset(employeeId, year) {
  return executeQuery(
    `UPDATE leave_balance
     SET carried_forward = COALESCE(carried_forward, 0) + COALESCE(annual_leave, 0),
         annual_leave = $2,
         annual_last_allocated_year = $3,
         updated_at = CURRENT_TIMESTAMP
     WHERE employee_id = $1
     RETURNING employee_id, annual_leave, carried_forward`,
    [employeeId, DEFAULT_ANNUAL, year]
  )
}

/** Get employee join date by employee code. */
export async function getEmployeeJoinDateByCode(employeeCode) {
  const code = String(employeeCode || '').trim()
  if (!code) return null

  const rows = await executeQuery(
    'SELECT join_date FROM employees WHERE employee_code = $1',
    [code]
  )
  return rows[0]?.join_date ?? null
}

/** Get employee gender by employee code. */
export async function getEmployeeGenderByCode(employeeCode) {
  const code = String(employeeCode || '').trim()
  if (!code) return null

  const rows = await executeQuery(
    'SELECT LOWER(TRIM(gender)) as gender FROM employees WHERE employee_code = $1',
    [code]
  )
  return rows[0]?.gender ?? null
}

/** Get all active employees for bulk leave allocation.
 * Includes their current leave balance (if exists) and gender.
 */
export async function getAllActiveEmployeesForAllocation() {
  return executeQuery(
    `SELECT
        e.employee_id,
        e.employee_code,
        LOWER(TRIM(e.gender)) as gender,
        e.join_date,
        COALESCE(lb.annual_leave, 0) as current_annual,
        COALESCE(lb.carried_forward, 0) as current_carried,
        COALESCE(lb.casual_leave, 0) as current_casual,
        COALESCE(lb.sick_leave, 0) as current_sick,
        COALESCE(lb.marriage_leave, 0) as current_marriage,
        COALESCE(lb.maternity_leave, 0) as current_maternity,
        COALESCE(lb.paternal_leave, 0) as current_paternal,
        COALESCE(lb.pilgrimage_leave, 0) as current_pilgrimage
     FROM employees e
     LEFT JOIN leave_balance lb ON lb.employee_id = e.employee_id
     WHERE e.is_active = true
     ORDER BY e.employee_code`,
    []
  )
}

export async function getLeaveBalance(employeeId) {
  await ensureLeaveBalanceRow(employeeId)
  return executeQuery(
    `SELECT lb.employee_code, lb.annual_leave, COALESCE(lb.casual_leave, 10) AS casual_leave, lb.sick_leave, lb.personal_leave,
            lb.carried_forward, lb.marriage_leave, lb.maternity_leave, lb.paternal_leave, lb.pilgrimage_leave
     FROM leave_balance lb WHERE lb.employee_id = $1`,
    [employeeId]
  )
}

/** Get all leave balances with employee_code for HR overview. */
export async function getAllLeaveBalances(limit = 100, offset = 0) {
  return executeQuery(
    `SELECT
        lb.employee_code,
        lb.annual_leave,
        lb.casual_leave,
        lb.sick_leave,
        lb.personal_leave,
        lb.carried_forward,
        lb.marriage_leave,
        lb.maternity_leave,
        lb.paternal_leave,
        lb.pilgrimage_leave,
        lb.updated_at
     FROM leave_balance lb
     ORDER BY lb.employee_code
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  )
}

/** Get single employee leave balance by employee_code. */
export async function getLeaveBalanceByEmployeeCode(employeeCode) {
  return executeQuery(
    `SELECT
        lb.employee_code,
        lb.annual_leave,
        COALESCE(lb.casual_leave, 10) AS casual_leave,
        lb.sick_leave,
        lb.personal_leave,
        lb.carried_forward,
        lb.marriage_leave,
        lb.maternity_leave,
        lb.paternal_leave,
        lb.pilgrimage_leave,
        lb.updated_at
     FROM leave_balance lb
     WHERE lb.employee_code = $1`,
    [employeeCode.trim()]
  )
}

/** Deduct annual days if balance sufficient. Returns updated row or []. */
export async function deductAnnualLeave(employeeId, days) {
  const d = Math.max(0, Math.floor(Number(days) || 0))
  if (d === 0) return []
  await ensureLeaveBalanceRow(employeeId)
  return executeQuery(
    `UPDATE leave_balance SET annual_leave = annual_leave - $2, updated_at = CURRENT_TIMESTAMP
     WHERE employee_id = $1 AND annual_leave >= $2
     RETURNING annual_leave, casual_leave, sick_leave`,
    [employeeId, d]
  )
}

/** Add back annual days (rollback). */
export async function refundAnnualLeave(employeeId, days) {
  const d = Math.max(0, Math.floor(Number(days) || 0))
  if (d === 0) return []
  return executeQuery(
    `UPDATE leave_balance SET annual_leave = annual_leave + $2, updated_at = CURRENT_TIMESTAMP
     WHERE employee_id = $1 RETURNING annual_leave`,
    [employeeId, d]
  )
}

/** Generic deduct function for any portal leave type. */
export async function deductLeave(employeeId, leaveType, days) {
  const d = Math.max(0, Math.floor(Number(days) || 0))
  if (d === 0) return []
  const column = getLeaveBalanceColumn(leaveType)
  if (!column || column === 'casual_leave' || column === 'sick_leave') {
    throw new Error('Invalid leave type for deduction')
  }
  await ensureLeaveBalanceRow(employeeId)
  return executeQuery(
    `UPDATE leave_balance SET ${column} = ${column} - $2, updated_at = CURRENT_TIMESTAMP
     WHERE employee_id = $1 AND ${column} >= $2
     RETURNING annual_leave, casual_leave, sick_leave, marriage_leave, maternity_leave, paternal_leave, pilgrimage_leave`,
    [employeeId, d]
  )
}

/** Generic refund function for any portal leave type. */
export async function refundLeave(employeeId, leaveType, days) {
  const d = Math.max(0, Math.floor(Number(days) || 0))
  if (d === 0) return []
  const column = getLeaveBalanceColumn(leaveType)
  if (!column || column === 'casual_leave' || column === 'sick_leave') {
    throw new Error('Invalid leave type for refund')
  }
  return executeQuery(
    `UPDATE leave_balance SET ${column} = ${column} + $2, updated_at = CURRENT_TIMESTAMP
     WHERE employee_id = $1 RETURNING ${column}`,
    [employeeId, d]
  )
}

/** HR: set full annual / casual / sick totals (non-negative integers). personal_leave stays 0. */
export async function setLeaveBalanceTotals(employeeId, annual, casual, sick) {
  await ensureLeaveBalanceRow(employeeId)
  return executeQuery(
    `UPDATE leave_balance SET
       annual_leave = $2,
       casual_leave = $3,
       sick_leave = $4,
       personal_leave = 0,
       updated_at = CURRENT_TIMESTAMP
     WHERE employee_id = $1
     RETURNING annual_leave, casual_leave, sick_leave`,
    [employeeId, annual, casual, sick]
  )
}

/** HR: set all portal-managed leave totals including new types.
 * Respects gender-based assignments for maternity/paternal leave.
 */
export async function setAllLeaveBalanceTotals(employeeId, balances) {
  // Get employee gender for gender-based leave assignment
  const genderRows = await executeQuery(
    `SELECT LOWER(TRIM(gender)) as gender FROM employees WHERE employee_id = $1`,
    [employeeId]
  )
  const gender = genderRows[0]?.gender || ''
  const isFemale = gender === 'female'
  const isMale = gender === 'male'

  const {
    annual = DEFAULT_ANNUAL,
    casual = DEFAULT_CASUAL,
    sick = DEFAULT_SICK,
    carried = 0,
    marriage = DEFAULT_MARRIAGE,
    // If maternity/paternal not explicitly provided, use gender-based defaults
    maternity = isFemale ? DEFAULT_MATERNITY : 0,
    paternal = isMale ? DEFAULT_PATERNAL : 0,
    pilgrimage = DEFAULT_PILGRIMAGE
  } = balances

  await ensureLeaveBalanceRow(employeeId)
  return executeQuery(
    `UPDATE leave_balance SET
       annual_leave = $2,
       casual_leave = $3,
       sick_leave = $4,
       carried_forward = $5,
       marriage_leave = $6,
       maternity_leave = $7,
       paternal_leave = $8,
       pilgrimage_leave = $9,
       personal_leave = 0,
       updated_at = CURRENT_TIMESTAMP
     WHERE employee_id = $1
     RETURNING annual_leave, casual_leave, sick_leave, carried_forward, marriage_leave, maternity_leave, paternal_leave, pilgrimage_leave`,
    [employeeId, annual, casual, sick, carried, marriage, maternity, paternal, pilgrimage]
  )
}

/**
 * HR manual deduction with audit logging.
 * leaveType must be one of: annual, casual, sick, marriage, maternity, paternal, pilgrimage.
 * Returns [] when balance is insufficient.
 */
export async function createManualDeduction(employeeId, leaveType, days, reason, deductedByEmployeeId) {
  const d = Math.max(0, Math.floor(Number(days) || 0))
  if (d === 0) return []
  const type = String(leaveType || '').trim().toLowerCase().replace(/\s+/g, '').replace('leave', '')
  const validTypes = ['annual', 'casual', 'sick', 'marriage', 'maternity', 'paternal', 'pilgrimage', 'paternity']
  if (!validTypes.includes(type)) {
    throw new Error('Invalid leave type')
  }
  // Map paternity to paternal
  const normalizedType = type === 'paternity' ? 'paternal' : type
  await ensureLeaveBalanceRow(employeeId)
  const column = getLeaveBalanceColumn(normalizedType)
  if (!column) {
    throw new Error('Invalid leave type')
  }
  const rows = await executeQuery(
    `WITH updated AS (
       UPDATE leave_balance
       SET ${column} = ${column} - $2, updated_at = CURRENT_TIMESTAMP
       WHERE employee_id = $1 AND ${column} >= $2
       RETURNING annual_leave, casual_leave, sick_leave, marriage_leave, maternity_leave, paternal_leave, pilgrimage_leave
     ),
     logged AS (
       INSERT INTO leave_deduction_log (
         employee_id, leave_type, days_deducted, reason,
         deducted_by_employee_id, balance_before, balance_after, created_at
       )
       SELECT
         $1, $3::text, $2, $4::text, $5,
         CASE
           WHEN $3::text = 'annual' THEN u.annual_leave + $2
           WHEN $3::text = 'casual' THEN u.casual_leave + $2
           WHEN $3::text = 'sick' THEN u.sick_leave + $2
           WHEN $3::text = 'marriage' THEN u.marriage_leave + $2
           WHEN $3::text = 'maternity' THEN u.maternity_leave + $2
           WHEN $3::text = 'paternal' OR $3::text = 'paternity' THEN u.paternal_leave + $2
           ELSE u.pilgrimage_leave + $2
         END,
         CASE
           WHEN $3::text = 'annual' THEN u.annual_leave
           WHEN $3::text = 'casual' THEN u.casual_leave
           WHEN $3::text = 'sick' THEN u.sick_leave
           WHEN $3::text = 'marriage' THEN u.marriage_leave
           WHEN $3::text = 'maternity' THEN u.maternity_leave
           WHEN $3::text = 'paternal' OR $3::text = 'paternity' THEN u.paternal_leave
           ELSE u.pilgrimage_leave
         END,
         CURRENT_TIMESTAMP
       FROM updated u
       RETURNING deduction_id, leave_type, days_deducted, reason, balance_before, balance_after, created_at
     )
     SELECT
       l.deduction_id, l.leave_type, l.days_deducted, l.reason, l.balance_before, l.balance_after, l.created_at,
       u.annual_leave, u.casual_leave, u.sick_leave, u.marriage_leave, u.maternity_leave, u.paternal_leave, u.pilgrimage_leave
     FROM logged l
     CROSS JOIN updated u`,
    [employeeId, d, normalizedType, reason, deductedByEmployeeId]
  )
  return rows
}

/** HR audit trail for manual leave deductions. */
export async function listManualDeductions(limit, offset, employeeCode = '') {
  const hasEmployeeFilter = String(employeeCode || '').trim() !== ''
  const params = hasEmployeeFilter ? [String(employeeCode).trim(), limit, offset] : [limit, offset]
  return executeQuery(
    `SELECT
       l.deduction_id,
       l.employee_id,
       e.employee_code,
       e.first_name,
       e.last_name,
       l.leave_type,
       l.days_deducted,
       l.reason,
       l.balance_before,
       l.balance_after,
       l.created_at,
       l.deducted_by_employee_id,
       hr.employee_code AS deducted_by_employee_code,
       hr.first_name AS deducted_by_first_name,
       hr.last_name AS deducted_by_last_name
     FROM leave_deduction_log l
     JOIN employees e ON e.employee_id = l.employee_id
     LEFT JOIN employees hr ON hr.employee_id = l.deducted_by_employee_id
     WHERE ($1::text IS NULL OR e.employee_code = $1::text)
     ORDER BY l.created_at DESC
     LIMIT $2 OFFSET $3`,
    hasEmployeeFilter ? params : [null, limit, offset]
  )
}

export async function countManualDeductions(employeeCode = '') {
  const hasEmployeeFilter = String(employeeCode || '').trim() !== ''
  const rows = await executeQuery(
    `SELECT COUNT(*)::int AS total
     FROM leave_deduction_log l
     JOIN employees e ON e.employee_id = l.employee_id
     WHERE ($1::text IS NULL OR e.employee_code = $1::text)`,
    [hasEmployeeFilter ? String(employeeCode).trim() : null]
  )
  return rows[0]?.total ?? 0
}

export async function getManualDeductionById(deductionId) {
  const rows = await executeQuery(
    `SELECT deduction_id, employee_id, leave_type, days_deducted, reason, deducted_by_employee_id, created_at
     FROM leave_deduction_log
     WHERE deduction_id = $1`,
    [deductionId]
  )
  return rows[0] || null
}

/**
 * HR edit manual deduction: updates leave type/days/reason and re-adjusts balances atomically.
 * Returns [] when record missing or updated values would make balances negative.
 */
export async function updateManualDeduction(deductionId, leaveType, days, reason) {
  const d = Math.max(0, Math.floor(Number(days) || 0))
  if (d === 0) return []
  const type = String(leaveType || '').trim().toLowerCase().replace(/\s+/g, '').replace('leave', '')
  const validTypes = ['annual', 'casual', 'sick', 'marriage', 'maternity', 'paternal', 'pilgrimage', 'paternity']
  if (!validTypes.includes(type)) {
    throw new Error('Invalid leave type')
  }
  // Map paternity to paternal
  const normalizedType = type === 'paternity' ? 'paternal' : type
  const rows = await executeQuery(
    `WITH existing AS (
       SELECT deduction_id, employee_id, leave_type, days_deducted
       FROM leave_deduction_log
       WHERE deduction_id = $1
     ),
     updated_balance AS (
       UPDATE leave_balance lb
       SET
         annual_leave = lb.annual_leave
           + CASE WHEN e.leave_type = 'annual' THEN e.days_deducted ELSE 0 END
           - CASE WHEN $2::text = 'annual' THEN $3::int ELSE 0 END,
         casual_leave = lb.casual_leave
           + CASE WHEN e.leave_type = 'casual' THEN e.days_deducted ELSE 0 END
           - CASE WHEN $2::text = 'casual' THEN $3::int ELSE 0 END,
         sick_leave = lb.sick_leave
           + CASE WHEN e.leave_type = 'sick' THEN e.days_deducted ELSE 0 END
           - CASE WHEN $2::text = 'sick' THEN $3::int ELSE 0 END,
         marriage_leave = lb.marriage_leave
           + CASE WHEN e.leave_type = 'marriage' THEN e.days_deducted ELSE 0 END
           - CASE WHEN $2::text = 'marriage' THEN $3::int ELSE 0 END,
         maternity_leave = lb.maternity_leave
           + CASE WHEN e.leave_type = 'maternity' THEN e.days_deducted ELSE 0 END
           - CASE WHEN $2::text = 'maternity' THEN $3::int ELSE 0 END,
         paternal_leave = lb.paternal_leave
           + CASE WHEN e.leave_type IN ('paternal', 'paternity') THEN e.days_deducted ELSE 0 END
           - CASE WHEN $2::text IN ('paternal', 'paternity') THEN $3::int ELSE 0 END,
         pilgrimage_leave = lb.pilgrimage_leave
           + CASE WHEN e.leave_type = 'pilgrimage' THEN e.days_deducted ELSE 0 END
           - CASE WHEN $2::text = 'pilgrimage' THEN $3::int ELSE 0 END,
         updated_at = CURRENT_TIMESTAMP
       FROM existing e
       WHERE lb.employee_id = e.employee_id
         AND lb.annual_leave
           + CASE WHEN e.leave_type = 'annual' THEN e.days_deducted ELSE 0 END
           - CASE WHEN $2::text = 'annual' THEN $3::int ELSE 0 END >= 0
         AND lb.casual_leave
           + CASE WHEN e.leave_type = 'casual' THEN e.days_deducted ELSE 0 END
           - CASE WHEN $2::text = 'casual' THEN $3::int ELSE 0 END >= 0
         AND lb.sick_leave
           + CASE WHEN e.leave_type = 'sick' THEN e.days_deducted ELSE 0 END
           - CASE WHEN $2::text = 'sick' THEN $3::int ELSE 0 END >= 0
         AND lb.marriage_leave
           + CASE WHEN e.leave_type = 'marriage' THEN e.days_deducted ELSE 0 END
           - CASE WHEN $2::text = 'marriage' THEN $3::int ELSE 0 END >= 0
         AND lb.maternity_leave
           + CASE WHEN e.leave_type = 'maternity' THEN e.days_deducted ELSE 0 END
           - CASE WHEN $2::text = 'maternity' THEN $3::int ELSE 0 END >= 0
         AND lb.paternal_leave
           + CASE WHEN e.leave_type IN ('paternal', 'paternity') THEN e.days_deducted ELSE 0 END
           - CASE WHEN $2::text IN ('paternal', 'paternity') THEN $3::int ELSE 0 END >= 0
         AND lb.pilgrimage_leave
           + CASE WHEN e.leave_type = 'pilgrimage' THEN e.days_deducted ELSE 0 END
           - CASE WHEN $2::text = 'pilgrimage' THEN $3::int ELSE 0 END >= 0
       RETURNING lb.employee_id, lb.annual_leave, lb.casual_leave, lb.sick_leave, lb.marriage_leave, lb.maternity_leave, lb.paternal_leave, lb.pilgrimage_leave
     ),
     updated_log AS (
       UPDATE leave_deduction_log l
       SET
         leave_type = $2::text,
         days_deducted = $3::int,
         reason = $4::text,
         balance_before = CASE
           WHEN $2::text = 'annual' THEN ub.annual_leave + $3::int
           WHEN $2::text = 'casual' THEN ub.casual_leave + $3::int
           WHEN $2::text = 'sick' THEN ub.sick_leave + $3::int
           WHEN $2::text = 'marriage' THEN ub.marriage_leave + $3::int
           WHEN $2::text = 'maternity' THEN ub.maternity_leave + $3::int
           WHEN $2::text IN ('paternal', 'paternity') THEN ub.paternal_leave + $3::int
           ELSE ub.pilgrimage_leave + $3::int
         END,
         balance_after = CASE
           WHEN $2::text = 'annual' THEN ub.annual_leave
           WHEN $2::text = 'casual' THEN ub.casual_leave
           WHEN $2::text = 'sick' THEN ub.sick_leave
           WHEN $2::text = 'marriage' THEN ub.marriage_leave
           WHEN $2::text = 'maternity' THEN ub.maternity_leave
           WHEN $2::text IN ('paternal', 'paternity') THEN ub.paternal_leave
           ELSE ub.pilgrimage_leave
         END
       FROM updated_balance ub
       WHERE l.deduction_id = $1
       RETURNING l.deduction_id, l.employee_id, l.leave_type, l.days_deducted, l.reason, l.balance_before, l.balance_after, l.created_at, l.deducted_by_employee_id
     )
     SELECT
       ul.deduction_id, ul.employee_id, ul.leave_type, ul.days_deducted, ul.reason,
       ul.balance_before, ul.balance_after, ul.created_at, ul.deducted_by_employee_id,
       ub.annual_leave, ub.casual_leave, ub.sick_leave, ub.marriage_leave, ub.maternity_leave, ub.paternal_leave, ub.pilgrimage_leave
     FROM updated_log ul
     JOIN updated_balance ub ON ub.employee_id = ul.employee_id`,
    [deductionId, normalizedType, d, reason]
  )
  return rows
}

export async function setAnnualDaysDeducted(leaveRequestId, days) {
  return executeQuery(
    `UPDATE leave_requests SET annual_days_deducted = $2 WHERE leave_request_id = $1`,
    [leaveRequestId, Math.max(0, Math.floor(Number(days) || 0))]
  )
}

export async function getLeaveRequests(employeeId) {
  try {
    return executeQuery(
      `SELECT lr.leave_request_id, lr.leave_type_id, lt.leave_type_name as leave_type, lr.start_date, lr.end_date,
          (lr.end_date - lr.start_date + 1) as days, lr.status, lr.reason, lr.created_at,
          COALESCE(lr.source, 'portal') AS source, lr.ics_leave_id
       FROM leave_requests lr
       LEFT JOIN leave_types lt ON lr.leave_type_id = lt.leave_type_id
       WHERE lr.employee_id = $1 ORDER BY lr.created_at DESC`,
      [employeeId]
    )
  } catch (err) {
    if (err.code === '42703') {
      return executeQuery(
        `SELECT lr.leave_request_id, lr.leave_type_id, lt.leave_type_name as leave_type, lr.start_date, lr.end_date,
            (lr.end_date - lr.start_date + 1) as days, lr.status, lr.reason, lr.created_at,
            'portal' AS source, NULL AS ics_leave_id
         FROM leave_requests lr
         LEFT JOIN leave_types lt ON lr.leave_type_id = lt.leave_type_id
         WHERE lr.employee_id = $1 ORDER BY lr.created_at DESC`,
        [employeeId]
      )
    }
    throw err
  }
}

export async function createLeaveRequest(employeeId, leaveTypeId, leaveTypeName, startDate, endDate, reason, initialStatus = 'Pending', source = 'portal') {
  return executeQuery(
    `INSERT INTO leave_requests (employee_id, leave_type_id, leave_type, start_date, end_date, reason, status, source, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
     RETURNING leave_request_id`,
    [employeeId, leaveTypeId, leaveTypeName, startDate, endDate, reason, initialStatus, source]
  )
}

/** Get single leave request by id (for status update). */
export async function getLeaveRequestById(leaveRequestId) {
  try {
    const rows = await executeQuery(
      `SELECT lr.leave_request_id, lr.employee_id, lr.leave_type_id, lt.leave_type_name as leave_type, lr.start_date, lr.end_date,
          (lr.end_date - lr.start_date + 1) AS days, lr.status, lr.reason, lr.created_at,
          COALESCE(lr.annual_days_deducted, 0) AS annual_days_deducted,
          e.department_id,
          COALESCE(lr.source, 'portal') AS source,
          lr.ics_leave_id
       FROM leave_requests lr
       JOIN employees e ON lr.employee_id = e.employee_id
       LEFT JOIN leave_types lt ON lr.leave_type_id = lt.leave_type_id
       WHERE lr.leave_request_id = $1`,
      [leaveRequestId]
    )
    return rows[0]
  } catch (err) {
    if (err.code === '42703') {
      const rows = await executeQuery(
        `SELECT lr.leave_request_id, lr.employee_id, lr.leave_type_id, lt.leave_type_name as leave_type, lr.start_date, lr.end_date,
            (lr.end_date - lr.start_date + 1) AS days, lr.status, lr.reason, lr.created_at,
            COALESCE(lr.annual_days_deducted, 0) AS annual_days_deducted,
            e.department_id,
            'portal' AS source,
            NULL AS ics_leave_id
         FROM leave_requests lr
         JOIN employees e ON lr.employee_id = e.employee_id
         LEFT JOIN leave_types lt ON lr.leave_type_id = lt.leave_type_id
         WHERE lr.leave_request_id = $1`,
        [leaveRequestId]
      )
      return rows[0]
    }
    throw err
  }
}

/** Update leave request status only when current status matches (for HOD then HR two-step flow). */
export async function updateLeaveRequestStatus(leaveRequestId, newStatus, requiredCurrentStatus) {
  return executeQuery(
    `UPDATE leave_requests SET status = $1 WHERE leave_request_id = $2 AND status = $3 RETURNING leave_request_id, status`,
    [newStatus, leaveRequestId, requiredCurrentStatus]
  )
}

/** Leave requests pending HR approval (status = 'Pending HR'). */
export async function getPendingHrLeaves() {
  try {
    return await executeQuery(
      `SELECT lr.leave_request_id, lr.employee_id, lr.leave_type_id, lt.leave_type_name as leave_type, lr.start_date, lr.end_date,
          (lr.end_date - lr.start_date + 1) AS days, lr.status, lr.reason, lr.created_at,
          e.first_name, e.last_name, e.email, e.employee_code, d.department_name,
          COALESCE(lr.source, 'portal') AS source, lr.ics_leave_id
       FROM leave_requests lr
       JOIN employees e ON lr.employee_id = e.employee_id
       LEFT JOIN departments d ON e.department_id = d.department_id
       LEFT JOIN leave_types lt ON lr.leave_type_id = lt.leave_type_id
       WHERE lr.status = 'Pending HR'
       ORDER BY lr.created_at ASC`,
      []
    )
  } catch (err) {
    if (err.code === '42703') {
      return executeQuery(
        `SELECT lr.leave_request_id, lr.employee_id, lr.leave_type_id, lt.leave_type_name as leave_type, lr.start_date, lr.end_date,
            (lr.end_date - lr.start_date + 1) AS days, lr.status, lr.reason, lr.created_at,
            e.first_name, e.last_name, e.email, e.employee_code, d.department_name,
            'portal' AS source, NULL AS ics_leave_id
         FROM leave_requests lr
         JOIN employees e ON lr.employee_id = e.employee_id
         LEFT JOIN departments d ON e.department_id = d.department_id
         LEFT JOIN leave_types lt ON lr.leave_type_id = lt.leave_type_id
         WHERE lr.status = 'Pending HR'
         ORDER BY lr.created_at ASC`,
        []
      )
    }
    throw err
  }
}

/** Total count of all leave requests (for HR list pagination). Excludes 'Pending CEO' — those belong to the CEO queue, not HR. */
export async function countAllLeavesForHr() {
  const rows = await executeQuery(
    "SELECT COUNT(*)::int AS total FROM leave_requests WHERE status IS DISTINCT FROM 'Pending CEO'",
    []
  )
  return rows[0]?.total ?? 0
}

/** All leave requests for HR list with pagination: every department, with applicant and department and status. */
export async function getAllLeavesForHr(limit, offset) {
  try {
    return await executeQuery(
      `SELECT lr.leave_request_id, lr.employee_id, lr.leave_type_id, lt.leave_type_name as leave_type, lr.start_date, lr.end_date,
          (lr.end_date - lr.start_date + 1) AS days, lr.status, lr.reason, lr.created_at,
          e.first_name, e.last_name, e.email, e.employee_code, d.department_name,
          COALESCE(lr.source, 'portal') AS source, lr.ics_leave_id
       FROM leave_requests lr
       JOIN employees e ON lr.employee_id = e.employee_id
       LEFT JOIN departments d ON e.department_id = d.department_id
       LEFT JOIN leave_types lt ON lr.leave_type_id = lt.leave_type_id
       WHERE lr.status IS DISTINCT FROM 'Pending CEO'
       ORDER BY lr.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    )
  } catch (err) {
    if (err.code === '42703') {
      return executeQuery(
        `SELECT lr.leave_request_id, lr.employee_id, lr.leave_type_id, lt.leave_type_name as leave_type, lr.start_date, lr.end_date,
            (lr.end_date - lr.start_date + 1) AS days, lr.status, lr.reason, lr.created_at,
            e.first_name, e.last_name, e.email, e.employee_code, d.department_name,
            'portal' AS source, NULL AS ics_leave_id
         FROM leave_requests lr
         JOIN employees e ON lr.employee_id = e.employee_id
         LEFT JOIN departments d ON e.department_id = d.department_id
         LEFT JOIN leave_types lt ON lr.leave_type_id = lt.leave_type_id
         WHERE lr.status IS DISTINCT FROM 'Pending CEO'
         ORDER BY lr.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      )
    }
    throw err
  }
}

/** Leave requests pending HOD approval: same department as HOD, status 'Pending', exclude HOD's own. */
export async function getPendingHodLeaves(deptId, deptName, excludeEmployeeId) {
  const BASE_COLS = `lr.leave_request_id, lr.employee_id, lr.leave_type_id, lt.leave_type_name as leave_type, lr.start_date, lr.end_date,
        (lr.end_date - lr.start_date + 1) AS days, lr.status, lr.reason, lr.created_at,
        e.first_name, e.last_name, e.email, d.department_name, e.employee_code`
  const WHERE = `WHERE lr.status = 'Pending' AND lr.employee_id != $3
       AND (e.department_id = $1 OR (LOWER(TRIM(COALESCE(d.department_name, ''))) = $2 AND $2 != ''))`
  const JOINS = `FROM leave_requests lr
     JOIN employees e ON lr.employee_id = e.employee_id
     LEFT JOIN departments d ON e.department_id = d.department_id
     LEFT JOIN leave_types lt ON lr.leave_type_id = lt.leave_type_id`
  const params = [deptId, deptName, excludeEmployeeId]
  try {
    // Only portal-originated leaves — ICS leaves are fetched directly from ICS API
    return executeQuery(
      `SELECT ${BASE_COLS}, 'portal' AS source ${JOINS} ${WHERE} AND COALESCE(lr.source, 'portal') = 'portal' ORDER BY lr.created_at ASC`,
      params
    )
  } catch (err) {
    if (err.code === '42703') {
      return executeQuery(
        `SELECT ${BASE_COLS}, 'portal' AS source ${JOINS} ${WHERE} ORDER BY lr.created_at ASC`,
        params
      )
    }
    throw err
  }
}

/**
 * Return ics_leave_id values already actioned in the portal (HOD approved → Pending HR / Approved / Rejected).
 * Used to deduplicate ICS API results in the HOD pending bucket.
 */
export async function getProcessedIcsLeaveIds(employeeIds) {
  if (!employeeIds?.length) return []
  try {
    return executeQuery(
      `SELECT ics_leave_id FROM leave_requests
       WHERE source = 'ics' AND ics_leave_id IS NOT NULL
         AND status != 'Pending'
         AND employee_id = ANY($1)`,
      [employeeIds]
    )
  } catch (err) {
    if (err.code === '42703') return []
    throw err
  }
}

/** Get pending leaves for CEO approval (HOD's Annual/Other leave requests).
 * CEO approves HOD's own leave requests for Annual and Other leave types.
 */
export async function getPendingCeoLeaves() {
  return executeQuery(
    `SELECT lr.leave_request_id, lr.employee_id, lr.leave_type_id, lt.leave_type_name as leave_type, lr.start_date, lr.end_date,
        (lr.end_date - lr.start_date + 1) AS days, lr.status, lr.reason, lr.created_at,
        e.employee_code, e.first_name, e.last_name, e.email, d.department_name
     FROM leave_requests lr
     JOIN employees e ON lr.employee_id = e.employee_id
     LEFT JOIN departments d ON e.department_id = d.department_id
     LEFT JOIN leave_types lt ON lr.leave_type_id = lt.leave_type_id
     LEFT JOIN employee_type et ON e.employee_type_id = et.emp_type_id
     WHERE lr.status = 'Pending CEO'
        OR (lr.status = 'Pending'
            AND lr.leave_type_id NOT IN (1, 2)
            AND et.emp_type_name = 'HOD')
     ORDER BY lr.created_at ASC`,
    []
  )
}

/** Get pending ICS leaves (Casual/Sick from Attendance System) for HR approval.
 * These leaves come from external ICS system and need HR approval.
 */
export async function getPendingIcsLeaves() {
  return executeQuery(
    `SELECT lr.leave_request_id, lr.employee_id, lr.leave_type_id, lt.leave_type_name as leave_type, lr.start_date, lr.end_date,
        (lr.end_date - lr.start_date + 1) AS days, lr.status, lr.reason, lr.created_at,
        e.employee_code, e.first_name, e.last_name, e.email, d.department_name,
        'ics' AS source
     FROM leave_requests lr
     JOIN employees e ON lr.employee_id = e.employee_id
     LEFT JOIN departments d ON e.department_id = d.department_id
     LEFT JOIN leave_types lt ON lr.leave_type_id = lt.leave_type_id
     WHERE lr.status = 'Pending HR'
       AND lr.source = 'ics'
       AND lr.leave_type_id IN (1, 2)
     ORDER BY lr.created_at ASC`,
    []
  )
}

/** Get leave type by ID. */
export async function getLeaveTypeById(leaveTypeId) {
  const rows = await executeQuery(
    `SELECT leave_type_id, leave_type_name, description, is_active, created_at, updated_at
     FROM leave_types WHERE leave_type_id = $1`,
    [leaveTypeId]
  )
  return rows[0] || null
}

/** Get leave type ID by name (case-insensitive). Also matches when the input has a trailing " Leave" suffix. */
export async function getLeaveTypeIdByName(leaveTypeName) {
  const stripped = String(leaveTypeName || '').replace(/\s+leave$/i, '').trim()
  const rows = await executeQuery(
    `SELECT leave_type_id, leave_type_name, description, is_active
     FROM leave_types
     WHERE LOWER(TRIM(leave_type_name)) = LOWER(TRIM($1))
        OR LOWER(TRIM(leave_type_name)) = LOWER(TRIM($2))`,
    [leaveTypeName, stripped]
  )
  return rows
}

/** Get all active employees in a department, excluding one employee (the HOD). */
export async function getActiveEmployeesByDepartment(deptId, excludeEmployeeId) {
  return executeQuery(
    `SELECT employee_id, employee_code, first_name, last_name FROM employees
     WHERE department_id = $1 AND employee_id != $2 AND is_active = true`,
    [deptId, excludeEmployeeId]
  )
}

/**
 * Find an existing ICS portal record and update its status + set ics_leave_id.
 * Matches by ics_leave_id OR by (employee + leave_type + start_date + source='ics').
 * Used when HOD approves/rejects so we UPDATE instead of INSERT.
 */
export async function findAndUpdateIcsLeave(employeeId, icsLeaveId, leaveTypeId, startDate, newStatus) {
  const icsId = parseInt(icsLeaveId, 10)
  try {
    const rows = await executeQuery(
      `UPDATE leave_requests
       SET status = $3, ics_leave_id = COALESCE(ics_leave_id, $2), updated_at = CURRENT_TIMESTAMP
       WHERE employee_id = $1 AND source = 'ics' AND status = 'Pending'
         AND (ics_leave_id = $2 OR (leave_type_id = $4 AND start_date = $5))
       RETURNING leave_request_id, ics_leave_id`,
      [employeeId, icsId, newStatus, leaveTypeId, startDate]
    )
    return rows[0] || null
  } catch (err) {
    if (err.code === '42703') {
      // ics_leave_id or source column missing — match by type+date only
      const rows = await executeQuery(
        `UPDATE leave_requests
         SET status = $2
         WHERE employee_id = $1 AND status = 'Pending'
           AND leave_type_id = $3 AND start_date = $4
         RETURNING leave_request_id`,
        [employeeId, newStatus, leaveTypeId, startDate]
      )
      return rows[0] || null
    }
    throw err
  }
}

/** Check if an ICS leave already exists in the portal (dedup by employee + type + start_date + source). */
export async function findIcsLeaveInPortal(employeeId, leaveTypeId, startDate) {
  try {
    const rows = await executeQuery(
      `SELECT leave_request_id FROM leave_requests
       WHERE employee_id = $1 AND leave_type_id = $2 AND start_date = $3 AND source = 'ics'`,
      [employeeId, leaveTypeId, startDate]
    )
    return rows[0] || null
  } catch (err) {
    if (err.code === '42703') {
      // source column not yet migrated — fall back to matching without it
      const rows = await executeQuery(
        `SELECT leave_request_id FROM leave_requests
         WHERE employee_id = $1 AND leave_type_id = $2 AND start_date = $3`,
        [employeeId, leaveTypeId, startDate]
      )
      return rows[0] || null
    }
    throw err
  }
}

/** Insert an ICS leave into the portal DB, bypassing date validation (for sync purposes). */
export async function createIcsLeaveInPortal(employeeId, leaveTypeId, leaveTypeName, startDate, endDate, reason, initialStatus, icsLeaveId = null) {
  const icsId = icsLeaveId != null ? parseInt(icsLeaveId, 10) : null
  try {
    return executeQuery(
      `INSERT INTO leave_requests (employee_id, leave_type_id, leave_type, start_date, end_date, reason, status, source, ics_leave_id, created_at)
       VALUES ($1, $2, COALESCE((SELECT leave_type_name FROM leave_types WHERE leave_type_id = $2), $3), $4, $5, $6, $7, 'ics', $8, CURRENT_TIMESTAMP)
       RETURNING leave_request_id`,
      [employeeId, leaveTypeId, leaveTypeName, startDate, endDate, reason, initialStatus, icsId]
    )
  } catch (err) {
    if (err.code === '42703') {
      // source or ics_leave_id column not yet migrated — insert without them
      return executeQuery(
        `INSERT INTO leave_requests (employee_id, leave_type_id, leave_type, start_date, end_date, reason, status, created_at)
         VALUES ($1, $2, COALESCE((SELECT leave_type_name FROM leave_types WHERE leave_type_id = $2), $3), $4, $5, $6, $7, CURRENT_TIMESTAMP)
         RETURNING leave_request_id`,
        [employeeId, leaveTypeId, leaveTypeName, startDate, endDate, reason, initialStatus]
      )
    }
    throw err
  }
}

/**
 * Get ICS leave decisions (Approved / Rejected) for the ICS developer pull API.
 * Optional filters: emp_code, from_date, to_date, status ('Approved'|'Rejected'|both).
 */
export async function getIcsLeaveDecisions({ empCode, fromDate, toDate, status } = {}) {
  const conditions = [`lr.source = 'ics'`, `lr.status IN ('Approved', 'Rejected')`]
  const params = []

  if (empCode) {
    params.push(String(empCode))
    conditions.push(`e.employee_code = $${params.length}`)
  }
  if (fromDate) {
    params.push(fromDate)
    conditions.push(`lr.start_date >= $${params.length}`)
  }
  if (toDate) {
    params.push(toDate)
    conditions.push(`lr.start_date <= $${params.length}`)
  }
  if (status && ['Approved', 'Rejected'].includes(status)) {
    params.push(status)
    conditions.push(`lr.status = $${params.length}`)
  }

  return executeQuery(
    `SELECT
        lr.leave_request_id   AS portal_leave_id,
        e.employee_code       AS emp_id,
        CONCAT(e.first_name, ' ', e.last_name) AS emp_name,
        COALESCE(lt.leave_type_name, lr.leave_type) AS leave_type,
        lr.start_date,
        lr.end_date,
        (lr.end_date - lr.start_date + 1) AS total_days,
        lr.status,
        lr.reason,
        lr.updated_at         AS decided_at,
        lr.created_at         AS requested_at
     FROM leave_requests lr
     JOIN employees e ON lr.employee_id = e.employee_id
     LEFT JOIN leave_types lt ON lr.leave_type_id = lt.leave_type_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY lr.updated_at DESC`,
    params
  )
}

/** Get all leave types. */
export async function getAllLeaveTypes() {
  return executeQuery(
    `SELECT leave_type_id, leave_type_name, description, is_active, created_at, updated_at
     FROM leave_types WHERE is_active = true ORDER BY leave_type_id`,
    []
  )
}