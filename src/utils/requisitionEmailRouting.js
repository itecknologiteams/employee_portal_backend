/**
 * Shared requisition workflow bucket + email recipient resolution (used by BullMQ worker and diagnostics).
 */
import { executeQuery } from '../../config/database.js'
import { resolveEmailsPreferCrmForCodes } from './requisitionEmailRecipients.js'
import { computeCommitteeApprovedLineTotalPKR, REQUISITION_CEO_MIN_AMOUNT_PKR } from './requisition.utils.js'

/**
 * Line total (PKR) for CEO skip rule — committee qty × unit price per item.
 * Pass into getRequisitionBucket when available so emails/reminders target Procurement instead of CEO under threshold.
 */
export async function fetchLineTotalPkrForCeoRule(reqId) {
  const rows = await executeQuery(
    `SELECT committee_approved_qty, item_est_cost, hod_item_est_cost FROM requisition_items WHERE req_id = $1`,
    [reqId]
  )
  return computeCommitteeApprovedLineTotalPKR(rows || [])
}

/**
 * @param {object} row - requisition flags
 * @param {number|null} [itemsLineTotalPkr] - from fetchLineTotalPkrForCeoRule; if set and &lt; REQUISITION_CEO_MIN_AMOUNT_PKR, CEO bucket is skipped
 */
export function getRequisitionBucket(row, itemsLineTotalPkr = null) {
  if (row.req_is_rejected === 1) return null

  if (row.req_purchase_completed === 1 && row.req_hod_acknowledged !== 1) {
    const creatorRole = row.req_creator_role
    if (creatorRole === 'CEO') return 'ceo'
    if (creatorRole === 'Committee') return 'committee'
    return 'hod'
  }

  if (row.req_finance_approval === 1) return null
  if (row.req_handed_to_finance === 1) return 'finance'
  if (row.req_procurement_ack === 1) return 'procurement'
  if (row.req_ceo_approval === 1) return 'procurement'
  if (row.req_committee_approval === 1) {
    const line = itemsLineTotalPkr != null ? Number(itemsLineTotalPkr) : null
    if (line != null && !Number.isNaN(line) && line < REQUISITION_CEO_MIN_AMOUNT_PKR) {
      return 'procurement'
    }
    return 'ceo'
  }
  if (row.req_hod_approval === 1) return 'committee'
  return 'hod'
}

/** Normalize single id, array of ids, or null to a deduped int[] (empty if none). */
function normalizeDepartmentIds(departmentIdOrIds) {
  if (departmentIdOrIds == null) return []
  const arr = Array.isArray(departmentIdOrIds) ? departmentIdOrIds : [departmentIdOrIds]
  const set = new Set()
  for (const id of arr) {
    const n = typeof id === 'number' ? id : parseInt(id, 10)
    if (!Number.isNaN(n)) set.add(n)
  }
  return [...set]
}

/**
 * All department ids for a creator: `employee_department_memberships` ∪ `employees.department_id`.
 * Used so HOD routing matches every department the employee belongs to, not only the legacy single FK.
 */
export async function getEmployeeDepartmentIdsForCreator(employeeId) {
  if (employeeId == null) return []
  const ids = new Set()
  try {
    const rows = await executeQuery(
      `SELECT department_id FROM employees WHERE employee_id = $1 AND department_id IS NOT NULL`,
      [employeeId]
    )
    if (rows[0]?.department_id != null) ids.add(Number(rows[0].department_id))
  } catch (err) {
    if (err.code !== '42P01') throw err
  }
  try {
    const rows = await executeQuery(
      `SELECT department_id FROM employee_department_memberships WHERE employee_id = $1`,
      [employeeId]
    )
    ;(rows || []).forEach((r) => {
      if (r.department_id != null) ids.add(Number(r.department_id))
    })
  } catch (err) {
    if (err.code !== '42P01') throw err
  }
  return [...ids].sort((a, b) => a - b)
}

export async function getDepartmentNamesForIds(departmentIds) {
  const ids = normalizeDepartmentIds(departmentIds)
  if (ids.length === 0) return ''
  const rows = await executeQuery(
    `SELECT STRING_AGG(d.department_name, ', ' ORDER BY d.department_name) AS names
     FROM departments d WHERE d.department_id = ANY($1::int[])`,
    [ids]
  )
  return rows[0]?.names || ''
}

/**
 * HOD employee codes for any of the given departments (union): designation/type HOD in each dept,
 * plus rows in `employee_hod_departments` (authoritative HOD assignment per department).
 */
export async function getHodEmployeeCodesForDepartments(departmentIds) {
  const ids = normalizeDepartmentIds(departmentIds)
  if (ids.length === 0) return []
  const codes = new Set()
  try {
    const rows = await executeQuery(
      `SELECT DISTINCT e.employee_code FROM employees e
      LEFT JOIN employee_type et ON e.employee_type_id = et.emp_type_id AND et.emp_type_name = 'HOD'
      LEFT JOIN designation desg ON e.designation_id = desg.desg_id AND desg.desg_name = 'HOD'
      WHERE e.department_id = ANY($1::int[]) AND e.is_active = true
        AND e.employee_code IS NOT NULL AND e.employee_code != ''
        AND (et.emp_type_id IS NOT NULL OR desg.desg_id IS NOT NULL)`,
      [ids]
    )
    ;(rows || []).forEach((r) => {
      if (r.employee_code) codes.add(r.employee_code)
    })
  } catch (err) {
    if (err.code === '42P01') return []
    throw err
  }
  try {
    const rows2 = await executeQuery(
      `SELECT DISTINCT e.employee_code FROM employee_hod_departments h
       INNER JOIN employees e ON e.employee_id = h.employee_id AND e.is_active = true
       WHERE h.department_id = ANY($1::int[])
         AND e.employee_code IS NOT NULL AND e.employee_code != ''`,
      [ids]
    )
    ;(rows2 || []).forEach((r) => {
      if (r.employee_code) codes.add(r.employee_code)
    })
  } catch (err) {
    if (err.code !== '42P01') throw err
  }
  return [...codes]
}

export async function getHodEmployeeCodesForDepartment(departmentId) {
  return getHodEmployeeCodesForDepartments(departmentId != null ? [departmentId] : [])
}

export async function getEmployeeCodesByRole(roleName) {
  try {
    const q = `
      SELECT DISTINCT e.employee_code FROM employees e
      LEFT JOIN employee_type et ON e.employee_type_id = et.emp_type_id AND et.emp_type_name = $1
      LEFT JOIN designation desg ON e.designation_id = desg.desg_id AND desg.desg_name = $1
      WHERE e.is_active = true AND e.employee_code IS NOT NULL AND e.employee_code != ''
        AND (et.emp_type_id IS NOT NULL OR desg.desg_id IS NOT NULL)
    `
    const rows = await executeQuery(q, [roleName])
    return (rows || []).map((r) => r.employee_code).filter(Boolean)
  } catch (err) {
    if (err.code === '42P01') return []
    throw err
  }
}

/**
 * @param {string} bucket
 * @param {number|number[]|null} departmentIdOrIds - For `hod`, use all creator department ids (array) or legacy single id.
 */
export async function getEmailsForBucket(bucket, departmentIdOrIds) {
  let codes = []
  if (bucket === 'hod') codes = await getHodEmployeeCodesForDepartments(departmentIdOrIds)
  else if (bucket === 'hr') codes = await getEmployeeCodesByRole('HR')
  else if (bucket === 'committee') codes = await getEmployeeCodesByRole('Committee')
  else if (bucket === 'ceo') codes = await getEmployeeCodesByRole('CEO')
  else if (bucket === 'procurement') codes = await getEmployeeCodesByRole('Procurement')
  else if (bucket === 'finance') codes = await getEmployeeCodesByRole('Finance')
  else if (bucket === 'admin' || bucket === 'admin_acknowledge' || bucket === 'admin_handover') codes = await getEmployeeCodesByRole('Admin')
  else if (bucket === 'manager_finance') codes = await getEmployeeCodesByRole('Manager of Finance')
  else if (bucket === 'hr_check') codes = await getEmployeeCodesByRole('HR')
  if (codes.length === 0) return []
  return resolveEmailsPreferCrmForCodes(codes)
}

export const BUCKET_LABELS = {
  hod: 'Pending HOD',
  hr: 'Pending HR',
  committee: 'Pending Committee',
  ceo: 'Pending CEO',
  procurement: 'Procurement',
  finance: 'Pending Finance',
  admin: 'Pending Admin',
  admin_acknowledge: 'Pending Admin Acknowledge',
  admin_handover: 'Pending Admin Handover',
  manager_finance: 'Pending Manager of Finance',
  hr_check: 'Pending HR Check'
}
