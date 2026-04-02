import { executeQuery } from '../../config/database.js'
import { isEmailConfigured } from '../../config/email.js'
import {
  getRequisitionBucket,
  getEmailsForBucket,
  getHodEmployeeCodesForDepartments,
  getEmployeeCodesByRole,
  getEmployeeDepartmentIdsForCreator,
  getDepartmentNamesForIds,
  BUCKET_LABELS,
  fetchLineTotalPkrForCeoRule
} from '../utils/requisitionEmailRouting.js'
import {
  resolveEmailDetailsForCodes,
  resolveEmailsPreferCrmForCodes
} from '../utils/requisitionEmailRecipients.js'
import { REQUISITION_CEO_MIN_AMOUNT_PKR } from '../utils/requisition.utils.js'
import { repairCeoBucketIfUnderThreshold } from './requisition.service.js'

const ROLE_DEFS = [
  { key: 'hod', label: 'HOD (creator department)', roleForCodes: null },
  { key: 'hr', label: 'HR', roleForCodes: 'HR' },
  { key: 'committee', label: 'Committee', roleForCodes: 'Committee' },
  { key: 'ceo', label: 'CEO', roleForCodes: 'CEO' },
  { key: 'procurement', label: 'Procurement', roleForCodes: 'Procurement' },
  { key: 'finance', label: 'Finance', roleForCodes: 'Finance' }
]

async function codesForStage(key, departmentIds) {
  if (key === 'hod') return getHodEmployeeCodesForDepartments(departmentIds)
  const def = ROLE_DEFS.find((r) => r.key === key)
  if (!def?.roleForCodes) return []
  return getEmployeeCodesByRole(def.roleForCodes)
}

export async function resolveRequisitionId(identifier) {
  const raw = identifier != null ? String(identifier).trim() : ''
  if (!raw) return null
  const asNum = parseInt(raw, 10)
  if (!Number.isNaN(asNum) && String(asNum) === raw) {
    const rows = await executeQuery('SELECT req_id FROM requisition WHERE req_id = $1 LIMIT 1', [asNum])
    return rows[0]?.req_id ?? null
  }
  const rows = await executeQuery(
    `SELECT req_id FROM requisition WHERE TRIM(req_reference_no) = $1 OR CAST(req_id AS TEXT) = $1 LIMIT 1`,
    [raw]
  )
  return rows[0]?.req_id ?? null
}

const REQUISITION_DIAGNOSTICS_SELECT = `
    SELECT r.req_id, r.req_reference_no, r.req_required_by_date, r.req_material,
            r.req_emp_id, r.req_creator_role,
            r.req_hod_approval, r.req_committee_approval, r.req_ceo_approval, r.req_procurement_ack,
            r.req_handed_to_finance, r.req_finance_approval, r.req_is_rejected,
            r.req_purchase_completed, r.req_hod_acknowledged,
            e.first_name, e.last_name, e.employee_code AS creator_employee_code, e.email AS creator_portal_email,
            e.department_id, d.department_name
     FROM requisition r
     JOIN employees e ON r.req_emp_id = e.employee_id
     LEFT JOIN departments d ON e.department_id = d.department_id
     WHERE r.req_id = $1`

export async function getRequisitionEmailDiagnostics(reqId) {
  let rows = await executeQuery(REQUISITION_DIAGNOSTICS_SELECT, [reqId])
  let row = rows[0]
  if (!row) {
    return { error: 'Requisition not found', status: 404 }
  }
  const { repaired } = await repairCeoBucketIfUnderThreshold(reqId)
  if (repaired) {
    rows = await executeQuery(REQUISITION_DIAGNOSTICS_SELECT, [reqId])
    row = rows[0]
    if (!row) {
      return { error: 'Requisition not found', status: 404 }
    }
  }

  const departmentId = row.department_id
  const lineTotalPkr = await fetchLineTotalPkrForCeoRule(reqId)
  const currentBucket = getRequisitionBucket(row, lineTotalPkr)
  const currentBucketLabel = currentBucket ? BUCKET_LABELS[currentBucket] || currentBucket : null

  const creatorName = `${row.first_name || ''} ${row.last_name || ''}`.trim()
  const creatorCode = row.creator_employee_code ? String(row.creator_employee_code).trim() : null
  let creatorDetails = []
  if (creatorCode) {
    creatorDetails = await resolveEmailDetailsForCodes([creatorCode])
  } else if (row.creator_portal_email) {
    creatorDetails = [{
      employeeCode: null,
      crmEmail: null,
      portalEmail: String(row.creator_portal_email).trim(),
      chosenEmail: String(row.creator_portal_email).trim(),
      source: 'portal'
    }]
  }

  const stages = []
  for (const def of ROLE_DEFS) {
    const codes = await codesForStage(def.key, departmentIds)
    const detailRows = await resolveEmailDetailsForCodes(codes)
    const resolvedEmails = await resolveEmailsPreferCrmForCodes(codes)
    const bucketEmails = await getEmailsForBucket(def.key, departmentIds)
    stages.push({
      key: def.key,
      label: def.label,
      employeeCodes: codes,
      detailRows,
      resolvedEmailsDeduped: resolvedEmails,
      /** Same list the worker uses when this bucket is active (for comparison). */
      wouldReceiveIfActiveBucket: bucketEmails,
      isActiveBucket: currentBucket === def.key,
      hasAnyChosenEmail: detailRows.some((d) => d.chosenEmail),
      missingEmailCodes: detailRows.filter((d) => !d.chosenEmail).map((d) => d.employeeCode)
    })
  }

  const activeRecipients = currentBucket
    ? await getEmailsForBucket(currentBucket, departmentIds)
    : []

  const notes = [
    'Bucket-change emails are sent when a requisition moves to a new stage (worker job requisition-bucket-changed). Recipients are everyone in that stage who has a CRM or portal email for their employee_code.',
    'If no one in the bucket has a resolvable email, the worker logs "no recipient" unless TEST_REMINDER_EMAIL is set in server .env.',
    'Deadline reminders (required-by date) are separate: sent only Mon–Fri 9:00–17:00 (REMINDER_TIMEZONE) to the current bucket recipients.',
    'CRM email wins over portal employees.email when both exist for the same employee_code.',
    `CEO stage applies only when the committee line total (qty × price) is ≥ ${REQUISITION_CEO_MIN_AMOUNT_PKR.toLocaleString()} PKR (REQUISITION_CEO_MIN_AMOUNT_PKR). Below that, the workflow goes to Procurement and CEO is not notified.`
  ]

  return {
    reqId: row.req_id,
    referenceNo: row.req_reference_no || `#${row.req_id}`,
    itemsLineTotalPkr: lineTotalPkr,
    departmentName,
    creatorDepartmentIds: departmentIds,
    requiredByDate: row.req_required_by_date,
    creator: {
      name: creatorName,
      employeeCode: creatorCode,
      details: creatorDetails
    },
    workflowFlags: {
      req_creator_role: row.req_creator_role,
      req_hod_approval: row.req_hod_approval,
      req_committee_approval: row.req_committee_approval,
      req_ceo_approval: row.req_ceo_approval,
      req_procurement_ack: row.req_procurement_ack,
      req_handed_to_finance: row.req_handed_to_finance,
      req_finance_approval: row.req_finance_approval,
      req_is_rejected: row.req_is_rejected,
      req_purchase_completed: row.req_purchase_completed,
      req_hod_acknowledged: row.req_hod_acknowledged
    },
    currentBucket,
    currentBucketLabel,
    activeBucketRecipientEmails: activeRecipients,
    smtpConfigured: isEmailConfigured(),
    testReminderEmailSet: !!(process.env.TEST_REMINDER_EMAIL && String(process.env.TEST_REMINDER_EMAIL).trim()),
    stages,
    notes
  }
}
