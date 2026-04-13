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

export async function ensureLeaveBalanceRow(employeeId) {
  await executeQuery(
    `INSERT INTO leave_balance (employee_id, annual_leave, casual_leave, sick_leave, personal_leave, marriage_leave, maternity_leave, paternal_leave, pilgrimage_leave)
     VALUES ($1, $2, $3, $4, 0, $5, $6, $7, $8)
     ON CONFLICT (employee_id) DO NOTHING`,
    [employeeId, DEFAULT_ANNUAL, DEFAULT_CASUAL, DEFAULT_SICK, DEFAULT_MARRIAGE, DEFAULT_MATERNITY, DEFAULT_PATERNAL, DEFAULT_PILGRIMAGE]
  )
}

export async function getLeaveBalance(employeeId) {
  await ensureLeaveBalanceRow(employeeId)
  return executeQuery(
    `SELECT lb.annual_leave, COALESCE(lb.casual_leave, 10) AS casual_leave, lb.sick_leave, lb.personal_leave,
            lb.marriage_leave, lb.maternity_leave, lb.paternal_leave, lb.pilgrimage_leave
     FROM leave_balance lb WHERE lb.employee_id = $1`,
    [employeeId]
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

/** HR: set all portal-managed leave totals including new types. */
export async function setAllLeaveBalanceTotals(employeeId, balances) {
  const {
    annual = DEFAULT_ANNUAL,
    casual = DEFAULT_CASUAL,
    sick = DEFAULT_SICK,
    marriage = DEFAULT_MARRIAGE,
    maternity = DEFAULT_MATERNITY,
    paternal = DEFAULT_PATERNAL,
    pilgrimage = DEFAULT_PILGRIMAGE
  } = balances
  await ensureLeaveBalanceRow(employeeId)
  return executeQuery(
    `UPDATE leave_balance SET
       annual_leave = $2,
       casual_leave = $3,
       sick_leave = $4,
       marriage_leave = $5,
       maternity_leave = $6,
       paternal_leave = $7,
       pilgrimage_leave = $8,
       personal_leave = 0,
       updated_at = CURRENT_TIMESTAMP
     WHERE employee_id = $1
     RETURNING annual_leave, casual_leave, sick_leave, marriage_leave, maternity_leave, paternal_leave, pilgrimage_leave`,
    [employeeId, annual, casual, sick, marriage, maternity, paternal, pilgrimage]
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
  return executeQuery(
    `SELECT lr.leave_request_id, lr.leave_type, lr.start_date, lr.end_date,
        (lr.end_date - lr.start_date + 1) as days, lr.status, lr.reason, lr.created_at
     FROM leave_requests lr WHERE lr.employee_id = $1 ORDER BY lr.created_at DESC`,
    [employeeId]
  )
}

export async function createLeaveRequest(employeeId, leaveType, startDate, endDate, reason, initialStatus = 'Pending') {
  return executeQuery(
    `INSERT INTO leave_requests (employee_id, leave_type, start_date, end_date, reason, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
     RETURNING leave_request_id`,
    [employeeId, leaveType, startDate, endDate, reason, initialStatus]
  )
}

/** Get single leave request by id (for status update). */
export async function getLeaveRequestById(leaveRequestId) {
  const rows = await executeQuery(
    `SELECT lr.leave_request_id, lr.employee_id, lr.leave_type, lr.start_date, lr.end_date,
        (lr.end_date - lr.start_date + 1) AS days, lr.status, lr.reason, lr.created_at,
        COALESCE(lr.annual_days_deducted, 0) AS annual_days_deducted,
        e.department_id
     FROM leave_requests lr
     JOIN employees e ON lr.employee_id = e.employee_id
     WHERE lr.leave_request_id = $1`,
    [leaveRequestId]
  )
  return rows[0]
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
  return executeQuery(
    `SELECT lr.leave_request_id, lr.employee_id, lr.leave_type, lr.start_date, lr.end_date,
        (lr.end_date - lr.start_date + 1) AS days, lr.status, lr.reason, lr.created_at,
        e.first_name, e.last_name, e.email, d.department_name
     FROM leave_requests lr
     JOIN employees e ON lr.employee_id = e.employee_id
     LEFT JOIN departments d ON e.department_id = d.department_id
     WHERE lr.status = 'Pending HR'
     ORDER BY lr.created_at ASC`,
    []
  )
}

/** Total count of all leave requests (for HR list pagination). */
export async function countAllLeavesForHr() {
  const rows = await executeQuery('SELECT COUNT(*)::int AS total FROM leave_requests', [])
  return rows[0]?.total ?? 0
}

/** All leave requests for HR list with pagination: every department, with applicant and department and status. */
export async function getAllLeavesForHr(limit, offset) {
  return executeQuery(
    `SELECT lr.leave_request_id, lr.employee_id, lr.leave_type, lr.start_date, lr.end_date,
        (lr.end_date - lr.start_date + 1) AS days, lr.status, lr.reason, lr.created_at,
        e.first_name, e.last_name, e.email, d.department_name
     FROM leave_requests lr
     JOIN employees e ON lr.employee_id = e.employee_id
     LEFT JOIN departments d ON e.department_id = d.department_id
     ORDER BY lr.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  )
}

/** Leave requests pending HOD approval: same department as HOD, status 'Pending', exclude HOD's own. */
export async function getPendingHodLeaves(deptId, deptName, excludeEmployeeId) {
  return executeQuery(
    `SELECT lr.leave_request_id, lr.employee_id, lr.leave_type, lr.start_date, lr.end_date,
        (lr.end_date - lr.start_date + 1) AS days, lr.status, lr.reason, lr.created_at,
        e.first_name, e.last_name, e.email, d.department_name
     FROM leave_requests lr
     JOIN employees e ON lr.employee_id = e.employee_id
     LEFT JOIN departments d ON e.department_id = d.department_id
     WHERE lr.status = 'Pending'
       AND lr.employee_id != $3
       AND (e.department_id = $1 OR (LOWER(TRIM(COALESCE(d.department_name, ''))) = $2 AND $2 != ''))
     ORDER BY lr.created_at ASC`,
    [deptId, deptName, excludeEmployeeId]
  )
}
