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

export async function getHodEmployeeCodesForDepartment(departmentId) {
  if (departmentId == null) return []
  try {
    const q = `
      SELECT e.employee_code FROM employees e
      LEFT JOIN employee_type et ON e.employee_type_id = et.emp_type_id AND et.emp_type_name = 'HOD'
      LEFT JOIN designation desg ON e.designation_id = desg.desg_id AND desg.desg_name = 'HOD'
      WHERE e.department_id = $1 AND e.is_active = true AND e.employee_code IS NOT NULL AND e.employee_code != ''
        AND (et.emp_type_id IS NOT NULL OR desg.desg_id IS NOT NULL)
      LIMIT 5
    `
    const rows = await executeQuery(q, [departmentId])
    return (rows || []).map((r) => r.employee_code).filter(Boolean)
  } catch (err) {
    if (err.code === '42P01') return []
    throw err
  }
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

export async function getEmailsForBucket(bucket, departmentId) {
  let codes = []
  if (bucket === 'hod') codes = await getHodEmployeeCodesForDepartment(departmentId)
  else if (bucket === 'hr') codes = await getEmployeeCodesByRole('HR')
  else if (bucket === 'committee') codes = await getEmployeeCodesByRole('Committee')
  else if (bucket === 'ceo') codes = await getEmployeeCodesByRole('CEO')
  else if (bucket === 'procurement') codes = await getEmployeeCodesByRole('Procurement')
  else if (bucket === 'finance') codes = await getEmployeeCodesByRole('Finance')
  if (codes.length === 0) return []
  return resolveEmailsPreferCrmForCodes(codes)
}

export const BUCKET_LABELS = {
  hod: 'Pending HOD',
  hr: 'Pending HR',
  committee: 'Pending Committee',
  ceo: 'Pending CEO',
  procurement: 'Procurement',
  finance: 'Pending Finance'
}
