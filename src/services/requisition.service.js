import { executeQuery } from '../../config/database.js'
import { getQueue, isBullMQEnabled } from '../../config/bullmq.js'
import { sendRequisitionReminder, isEmailConfigured } from '../../config/email.js'
import { notifyCreatorAckRequired } from '../../jobs/requisition-emailer.js'
import * as reqRepo from '../repositories/requisition.repository.js'
import { getEmployeeIdByCode } from '../repositories/auth.repository.js'
import {
  getRequisitionStatus,
  getPendingAt,
  parseEmployeeId,
  getTATFromRequisition,
  buildTatFromRequisition,
  formatTotalTime,
  tatReportStatusCondition,
  computeCommitteeApprovedLineTotalPKR,
  REQUISITION_CEO_MIN_AMOUNT_PKR
} from '../utils/requisition.utils.js'
import { parseNumericCostPkr, getEffectiveUnitPricePkrFromItem } from '../utils/requisitionAmountParse.js'
import * as notifRepo from '../repositories/notification.repository.js'
import * as notifSvc from './notification.service.js'

/** Save rejection reason as a comment and update the rejection record. */
async function rejectWithReason(requisitionId, reason, approverEid, stageKey) {
  await reqRepo.rejectRequisition(requisitionId, reason)
  if (reason && String(reason).trim()) {
    await reqRepo.insertRequisitionComment(requisitionId, stageKey, `[Rejection reason] ${String(reason).trim()}`, approverEid)
  }
}

async function resolveApproverEmployeeId(body) {
  if (body?.approvedByEmployeeId != null && String(body.approvedByEmployeeId).trim() !== '') {
    const eid = parseEmployeeId(String(body.approvedByEmployeeId))
    if (eid != null) return eid
  }
  if (body?.approvedByEmployeeCode != null && String(body.approvedByEmployeeCode).trim() !== '') {
    return await getEmployeeIdByCode(String(body.approvedByEmployeeCode).trim())
  }
  return null
}

async function inAppNotifyRequisitionBucket(reqId, bucket, departmentId) {
  if (departmentId == null || bucket == null) return
  const ref = await notifRepo.getRequisitionRef(reqId)
  const label = ref || `#${reqId}`
  return notifSvc.notifyBucketApprovers(bucket, departmentId, {
    type: `requisition_pending_${bucket}`,
    title: `Requisition ${label}`,
    body: 'Pending your action in the portal.',
    url: '/requisition/pending',
    relatedEntityType: 'requisition',
    relatedEntityId: reqId
  })
}

export { parseEmployeeId }

/** Requisition categories (from CSV flow). Fallback when requisition_category table is missing. */
export const REQUISITION_CATEGORIES = [
  'Stationary',
  'Vehicle Maintenance',
  'Vehicle Repair',
  'Other Repair & Maintenance',
  'Loan & Advance Salary',
  'Event',
  'Specialized Projects',
  'IT Equipments',
  'General Procurements Grocerry & Others',
  'General Procurements Electric Appliances',
  'Devices / Accessories'
]

/** Get flow stages from DB (for DB-driven flow). Returns [] if tables missing. */
export async function getFlowStages() {
  return reqRepo.getFlowStages()
}

/** Get categories from DB (with flow flags) or fallback to static list. */
export async function getCategories() {
  try {
    const rows = await reqRepo.getAllRequisitionCategories()
    if (Array.isArray(rows) && rows.length > 0) {
      return {
        categories: rows.map(r => r.name),
        flow: rows.map(r => ({
          name: r.name,
          hod_for_info: r.hod_for_info === 1,
          hod_approval: r.hod_approval === 1,
          hr_finance: r.hr_finance === 1,
          committee_review: r.committee_review === 1,
          quotations: r.quotations === 1,
          final_committee: r.final_committee === 1,
          ceo_approve: r.ceo_approve === 1,
          execution_admin: r.execution_admin === 1,
          execution_finance: r.execution_finance === 1,
          execution_procurement: r.execution_procurement === 1,
          form_layout: r.form_layout || null
        }))
      }
    }
  } catch (_) {
    /* table may not exist */
  }
  return { categories: [...REQUISITION_CATEGORIES], flow: null }
}

const VALID_BUCKETS = ['hod', 'hr', 'committee', 'ceo', 'procurement', 'finance', 'admin']

/** Categories where HOD can approve without BOQ (no size/brand/price per piece required). */
const REQUISITION_CATEGORIES_NO_BOQ = [
  'Vehicle Maintenance',
  'Vehicle Repair',
  'Other Repair & Maintenance',
  'Loan & Advance Salary',
  'Event',
  'Specialized Projects'
]

function isCategoryNoBoq(category) {
  if (category == null || category === '') return false
  const c = String(category).trim().toLowerCase()
  if (!c) return false
  return REQUISITION_CATEGORIES_NO_BOQ.some((cat) => cat.trim().toLowerCase() === c)
}

/** Categories that require HR approval after HOD (hr_finance=1). Must go to HR bucket before Committee. */
const REQUISITION_CATEGORIES_HR_AFTER_HOD = ['Loan & Advance Salary']

function isCategoryHrAfterHod(category) {
  if (category == null || category === '') return false
  const c = String(category).trim().toLowerCase()
  if (!c) return false
  return REQUISITION_CATEGORIES_HR_AFTER_HOD.some((cat) => cat.trim().toLowerCase() === c)
}

/** Set req_current_stage_key to track current bucket. Always updates the stage key. */
async function setCurrentStage(reqId, stageKey, categoryNameForFirst) {
  try {
    // Determine the stage key to set
    let key = stageKey
    if (key == null && categoryNameForFirst) {
      // Try to get from flow config if available
      const stages = await reqRepo.getFlowStages().catch(() => [])
      if (stages && stages.length > 0) {
        key = await reqRepo.getFirstStageKey(categoryNameForFirst).catch(() => 'hod')
      }
    }
    if (key == null) key = 'hod'
    await reqRepo.setRequisitionCurrentStage(reqId, key)
  } catch (_) {
    /* column may not exist - ignore */
  }
}

/** Queue bucket-changed job; on failure or when BullMQ disabled, send email synchronously so emails always go. */
async function notifyBucketChanged(requisitionId, newBucket) {
  if (!requisitionId || !VALID_BUCKETS.includes(newBucket)) return
  let queued = false
  if (isBullMQEnabled()) {
    try {
      const q = getQueue()
      await q.add('requisition-bucket-changed', { requisitionId, newBucket })
      queued = true
    } catch (e) {
      console.error('BullMQ requisition-bucket-changed add failed:', e?.message)
    }
  }
  if (!queued) {
    try {
      const { handleRequisitionBucketChanged } = await import('../../workers/requisition-reminder-worker.js')
      await handleRequisitionBucketChanged({ requisitionId, newBucket })
    } catch (e2) {
      console.error('Fallback bucket-changed email failed:', e2?.message)
    }
  }
}

export async function getHistory(employeeId, query = {}) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return { error: 'Valid employee ID is required', status: 400 }
  const page = Math.max(1, parseInt(query.page, 10) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20))
  const offset = (page - 1) * limit
  const search = query.search != null ? String(query.search).trim() : ''
  const total = await reqRepo.getTrackRecordsCountByEmployee(eid, search || undefined)
  const totalPages = Math.max(1, Math.ceil(total / limit))
  const rows = await reqRepo.getTrackRecordsByEmployee(eid, limit, offset, search || undefined)
  const reqIds = rows.map(r => r.req_id)
  const items = reqIds.length ? await reqRepo.getRequisitionItemsByReqIds(reqIds) : []
  const data = rows.map(req => ({
    id: req.req_id,
    referenceNo: req.req_reference_no,
    employeeId: req.req_emp_id,
    location: req.req_location,
    material: req.req_material,
    requiredByDate: req.req_required_by_date || null,
    business: req.req_business,
    category: req.req_category || null,
    status: getRequisitionStatus(req),
    hodApproval: req.req_hod_approval === 1,
    hodApprovalDate: req.req_hod_approval_date,
    committeeApproval: req.req_committee_approval === 1,
    committeeApprovalDate: req.req_committee_approval_date,
    ceoApproval: req.req_ceo_approval === 1,
    ceoApprovalDate: req.req_ceo_approval_date,
    createdAt: req.req_created_at,
    isRejected: req.req_is_rejected === 1,
    items: items.filter(i => i.req_id === req.req_id).map(i => ({
      id: i.item_id,
      desc: i.item_desc,
      size: i.item_size,
      brand: i.item_brand,
      qty: i.item_qty,
      estCost: i.item_est_cost,
      remarks: i.item_remarks
    }))
  }))
  return { data, pagination: { page, limit, total, totalPages } }
}

export async function getTrackRecordsByEmployee(employeeId, query) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return { error: 'Valid employee ID is required', status: 400 }
  const page = Math.max(1, parseInt(query.page, 10) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20))
  const offset = (page - 1) * limit
  const total = await reqRepo.getTrackRecordsCountByEmployee(eid)
  const totalPages = Math.max(1, Math.ceil(total / limit))
  const rows = await reqRepo.getTrackRecordsByEmployee(eid, limit, offset)
  const reqIds = rows.map(r => r.req_id)
  const itemCounts = reqIds.length ? await reqRepo.getItemCountsByReqIds(reqIds) : []
  const countByReq = Object.fromEntries((itemCounts || []).map(c => [c.req_id, parseInt(c.cnt, 10)]))
  const data = rows.map(req => {
    const status = getRequisitionStatus(req)
    return {
      requisitionId: req.req_id,
      referenceNo: req.req_reference_no,
      employeeId: req.req_emp_id,
      category: req.req_category || null,
      createdAt: req.req_created_at,
      requiredByDate: req.req_required_by_date || null,
      status,
      pendingAt: getPendingAt(status),
      isRejected: req.req_is_rejected === 1,
      itemCount: countByReq[req.req_id] ?? 0
    }
  })
  return { data, pagination: { page, limit, total, totalPages } }
}

/** Normalize item cost: digits only (optional decimal) before DB insert. */
function normalizeRequisitionItemForCreate(item) {
  const raw = String(item.itemEstCost ?? '').trim()
  if (!raw) {
    return { ...item, itemEstCost: null }
  }
  const n = parseNumericCostPkr(raw)
  if (n == null) {
    const e = new Error('Price per piece (PKR) must use numbers only (optional decimal, e.g. 5000 or 1500.50).')
    e.status = 400
    throw e
  }
  return { ...item, itemEstCost: String(n) }
}

/** Categories that don't require a required by date (Loan & Advance Salary) */
const REQUISITION_CATEGORIES_NO_DATE = ['Loan & Advance Salary']

function isCategoryNoDate(category) {
  if (category == null || category === '') return false
  const c = String(category).trim().toLowerCase()
  if (!c) return false
  return REQUISITION_CATEGORIES_NO_DATE.some((cat) => cat.trim().toLowerCase() === c)
}

export async function createRequisition(body) {
  const { employeeId, location, material, requiredByDate, business, items, category, loanAdvanceType, loanAdvanceAmount, loanAdvanceReason, loanInstallmentMonths } = body
  const categoryTrimmed = category?.trim() || ''
  const noDateCategory = isCategoryNoDate(categoryTrimmed)

  if (!employeeId) {
    return { error: 'employeeId is required', status: 400 }
  }
  if (!location || typeof location !== 'string' || !String(location).trim()) {
    return { error: 'Location is required', status: 400 }
  }
  if (!material || typeof material !== 'string' || !String(material).trim()) {
    return { error: 'Material / Summary is required', status: 400 }
  }
  // Required by date is optional for Loan & Advance Salary
  if (!noDateCategory && (!requiredByDate || typeof requiredByDate !== 'string' || !String(requiredByDate).trim())) {
    return { error: 'Required by date is required', status: 400 }
  }
  const itemsList = Array.isArray(items) ? items : []
  const validItems = itemsList.filter(it => {
    const qty = it.itemQty ?? it.item_qty ?? 0
    const hasData = (it.itemDesc && it.itemDesc.trim()) || (it.item_desc && String(it.item_desc).trim()) ||
      (it.itemSize && it.itemSize.trim()) || (it.item_size && String(it.item_size).trim()) ||
      (it.itemBrand && it.itemBrand.trim()) || (it.item_brand && String(it.item_brand).trim()) ||
      (Number(qty) > 0)
    return hasData
  })
  if (validItems.length > 0) {
    const deptIdForCheck = await reqRepo.getCreatorDepartment(employeeId)
    const hodIdForCheck = await reqRepo.getHodByDepartment(deptIdForCheck)
    const creatorIsHodByDeptForItems = hodIdForCheck != null && hodIdForCheck === parseInt(employeeId, 10)
    // Also check HOD by role (handles multi-dept HODs and role-based HODs)
    const creatorIsHodByRoleForItems = deptIdForCheck != null && await reqRepo.isHodOfDepartment(parseInt(employeeId, 10), deptIdForCheck)
    const creatorIsHodForItems = creatorIsHodByDeptForItems || creatorIsHodByRoleForItems
    const { employeeHasPermission } = await import('./auth.service.js')
    const canAddItems = creatorIsHodForItems || await employeeHasPermission(employeeId, 'requisition_can_add_items')
    if (!canAddItems) {
      return { error: 'You do not have permission to add items to requisitions. Contact Administration for "Can add items" access.', status: 403 }
    }
  }
  if (!category || typeof category !== 'string' || !category.trim()) {
    return { error: 'Category is required', status: 400 }
  }
  let allowedCategories = REQUISITION_CATEGORIES
  try {
    const { categories } = await getCategories()
    if (Array.isArray(categories) && categories.length > 0) allowedCategories = categories
  } catch (_) {}
  if (!allowedCategories.includes(categoryTrimmed)) {
    return { error: `Category must be one of: ${allowedCategories.join(', ')}`, status: 400 }
  }

  // Required by date must be at least 4 days from today (cannot select today or next 3 days)
  // Skip this validation for Loan & Advance Salary category
  if (!noDateCategory && requiredByDate && typeof requiredByDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(requiredByDate.trim())) {
    const minDate = new Date()
    minDate.setDate(minDate.getDate() + 4)
    const minStr = `${minDate.getFullYear()}-${String(minDate.getMonth() + 1).padStart(2, '0')}-${String(minDate.getDate()).padStart(2, '0')}`
    if (requiredByDate.trim() < minStr) {
      return { error: 'Required by date must be at least 4 days from today. You cannot select today or the next 3 days.', status: 400 }
    }
  }

  const deptId = await reqRepo.getCreatorDepartment(employeeId)
  const hodId = await reqRepo.getHodByDepartment(deptId)
  const creatorIsHodByDept = hodId != null && hodId === parseInt(employeeId, 10)
  // Also check if creator has HOD role via employee_type or designation (handles multi-dept HODs and role-based HODs)
  const creatorIsHodByRole = deptId != null && await reqRepo.isHodOfDepartment(parseInt(employeeId, 10), deptId)
  const creatorIsHod = creatorIsHodByDept || creatorIsHodByRole
  const creatorIsCommittee = await reqRepo.isCommitteeMember(employeeId)
  const creatorIsCeo = await reqRepo.isCeoMember(employeeId)

  // Determine creator role for acknowledgment routing
  let creatorRole = null
  if (creatorIsCeo) {
    creatorRole = 'CEO'
  } else if (creatorIsCommittee) {
    creatorRole = 'Committee'
  } else if (creatorIsHod) {
    creatorRole = 'HOD'
  }

  const created = await reqRepo.createRequisition(employeeId, location, material, requiredByDate, business, creatorRole, categoryTrimmed,
    loanAdvanceType, loanAdvanceAmount, loanAdvanceReason, loanInstallmentMonths)
  const reqId = created.req_id
  const refNo = created.req_reference_no

  if (validItems.length > 0) {
    let normalizedItems
    try {
      normalizedItems = validItems.map((it) => normalizeRequisitionItemForCreate(it))
    } catch (normErr) {
      return { error: normErr.message || 'Invalid item amount', status: normErr.status || 400 }
    }
    await reqRepo.insertRequisitionItemsBatch(reqId, normalizedItems)
  }

  // Category-based flow: if category has HOD "For Info" only (no approval), auto-advance past HOD to next real stage (1.csv)
  let categoryFlowBucket = null
  try {
    const cat = await reqRepo.getRequisitionCategoryByName(categoryTrimmed)
    if (cat && cat.hod_for_info === 1 && cat.hod_approval === 0 && !creatorIsHod && !creatorIsCommittee && !creatorIsCeo) {
      // For HOD "For Info" categories, the system auto-approves on behalf of HOD
      // Pass null for approver since no specific HOD performed this action
      await reqRepo.setHodApprovalForInfoOnly(reqId, null)
      // Use DB-driven next stage after HOD (e.g. Stationary → procurement, Vehicle Repair → committee)
      categoryFlowBucket = await reqRepo.getNextStageKey(categoryTrimmed, 'hod') || 'committee'
    }
  } catch (_) {
    /* requisition_category table may not exist yet */
  }

  // Check if this is a Loan & Advance Salary category (must go to HR, not normal flow)
  const isLoanAdvanceCategory = isCategoryHrAfterHod(categoryTrimmed)
  
  // Auto-advance based on creator role
  // Special handling for Loan & Advance Salary: always go to HR (skip Committee/CEO/Procurement)
  if (isLoanAdvanceCategory) {
    // Loan & Advance Salary: skip all normal stages and go directly to HR
    const stages = await reqRepo.getFlowStages()
    const hasHrStage = stages.some((s) => (s.stage_key || '').toLowerCase() === 'hr')
    
    if (hasHrStage) {
      // For HOD/Committee/CEO/Finance/Procurement creators: skip their normal auto-advance and go to HR
      if (creatorIsCeo || creatorIsCommittee || creatorIsHod) {
        // Mark as approved by their role but route to HR
        if (creatorIsCeo) await reqRepo.autoAdvanceCeoRequisition(reqId)
        else if (creatorIsCommittee) await reqRepo.autoAdvanceCommitteeRequisition(reqId)
        else if (creatorIsHod) await reqRepo.autoAdvanceHodRequisition(reqId, parseInt(employeeId, 10))
      }
      
      await setCurrentStage(reqId, 'hr')
      await notifyBucketChanged(reqId, 'hr')
      notifSvc.notifySafe(inAppNotifyRequisitionBucket(reqId, 'hr', deptId))
    } else {
      // No HR stage in flow - fall back to normal auto-advance
      if (creatorIsCeo) {
        await reqRepo.autoAdvanceCeoRequisition(reqId)
        await setCurrentStage(reqId, 'procurement')
        await notifyBucketChanged(reqId, 'procurement')
        notifSvc.notifySafe(inAppNotifyRequisitionBucket(reqId, 'procurement', deptId))
      } else if (creatorIsCommittee) {
        await reqRepo.autoAdvanceCommitteeRequisition(reqId)
        await setCurrentStage(reqId, 'ceo')
        await notifyBucketChanged(reqId, 'ceo')
        notifSvc.notifySafe(inAppNotifyRequisitionBucket(reqId, 'ceo', deptId))
      } else if (creatorIsHod) {
        await reqRepo.autoAdvanceHodRequisition(reqId, parseInt(employeeId, 10))
        await setCurrentStage(reqId, 'committee')
        await notifyBucketChanged(reqId, 'committee')
        notifSvc.notifySafe(inAppNotifyRequisitionBucket(reqId, 'committee', deptId))
      } else if (categoryFlowBucket) {
        await setCurrentStage(reqId, categoryFlowBucket)
        await notifyBucketChanged(reqId, categoryFlowBucket)
        notifSvc.notifySafe(inAppNotifyRequisitionBucket(reqId, categoryFlowBucket, deptId))
      } else {
        const firstKey = await reqRepo.getFirstStageKey(categoryTrimmed).catch(() => 'hod')
        const bucket = firstKey || 'hod'
        await setCurrentStage(reqId, bucket)
        await notifyBucketChanged(reqId, bucket)
        notifSvc.notifySafe(inAppNotifyRequisitionBucket(reqId, bucket, deptId))
      }
    }
  } else if (creatorIsCeo) {
    await reqRepo.autoAdvanceCeoRequisition(reqId)
    await setCurrentStage(reqId, 'procurement')
    await notifyBucketChanged(reqId, 'procurement')
    notifSvc.notifySafe(inAppNotifyRequisitionBucket(reqId, 'procurement', deptId))
  } else if (creatorIsCommittee) {
    await reqRepo.autoAdvanceCommitteeRequisition(reqId)
    await setCurrentStage(reqId, 'ceo')
    await notifyBucketChanged(reqId, 'ceo')
    notifSvc.notifySafe(inAppNotifyRequisitionBucket(reqId, 'ceo', deptId))
  } else if (creatorIsHod) {
    await reqRepo.autoAdvanceHodRequisition(reqId, parseInt(employeeId, 10))
    await setCurrentStage(reqId, 'committee')
    await notifyBucketChanged(reqId, 'committee')
    notifSvc.notifySafe(inAppNotifyRequisitionBucket(reqId, 'committee', deptId))
  } else if (categoryFlowBucket) {
    await setCurrentStage(reqId, categoryFlowBucket)
    await notifyBucketChanged(reqId, categoryFlowBucket)
    notifSvc.notifySafe(inAppNotifyRequisitionBucket(reqId, categoryFlowBucket, deptId))
  } else {
    // Normal employee: use DB flow so IT Equipments etc go to HOD first; Specialized/General Proc/Devices go to Committee first.
    const firstKey = await reqRepo.getFirstStageKey(categoryTrimmed).catch(() => 'hod')
    const bucket = firstKey || 'hod'
    await setCurrentStage(reqId, bucket)
    await notifyBucketChanged(reqId, bucket)
    notifSvc.notifySafe(inAppNotifyRequisitionBucket(reqId, bucket, deptId))
  }

  // Email (notifyBucketChanged) + in-app (inAppNotifyRequisitionBucket) for the current bucket.

  return { message: 'Requisition submitted successfully', requisitionId: reqId, referenceNo: refNo }
}

export async function getQueueStats() {
  if (!isBullMQEnabled()) {
    return {
      enabled: false,
      message: 'BullMQ not enabled (set REDIS_HOST or BULLMQ_REMINDER_ENABLED=1)'
    }
  }
  const q = getQueue()
  const counts = await q.getJobCounts()
  const [waiting, completed, delayed, failed, active] = await Promise.all([
    q.getJobs(['waiting'], 0, 9),
    q.getJobs(['completed'], 0, 9),
    q.getJobs(['delayed'], 0, 9),
    q.getJobs(['failed'], 0, 9),
    q.getJobs(['active'], 0, 9)
  ])
  return {
    enabled: true,
    queue: 'requisition-reminder',
    counts: {
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      completed: counts.completed ?? 0,
      failed: counts.failed ?? 0,
      delayed: counts.delayed ?? 0
    },
    recentWaiting: waiting.map(j => ({ id: j.id, name: j.name, data: j.data, timestamp: j.timestamp })),
    recentCompleted: completed.map(j => ({ id: j.id, name: j.name, data: j.data, finishedOn: j.finishedOn })),
    recentDelayed: delayed.map(j => ({ id: j.id, name: j.name, data: j.data, delay: j.delay, timestamp: j.timestamp })),
    recentFailed: failed.map(j => ({ id: j.id, name: j.name, data: j.data, failedReason: j.failedReason })),
    recentActive: active.map(j => ({ id: j.id, name: j.name, data: j.data, processedOn: j.processedOn }))
  }
}

export async function triggerReminderCheck() {
  if (!isBullMQEnabled()) {
    return { ok: false, message: 'BullMQ not enabled (set BULLMQ_REMINDER_ENABLED=1 or REDIS_HOST)' }
  }
  const q = getQueue()
  await q.add('check-reminders', {}, { jobId: `trigger-reminder-${Date.now()}` })
  return { ok: true, message: 'Reminder check job added. Worker will run processRequisitionReminders and send emails for requisitions due in 3/2/1 days.' }
}

export async function cancelDelayedJobs() {
  if (!isBullMQEnabled()) {
    return { ok: false, message: 'BullMQ not enabled' }
  }
  const q = getQueue()
  const delayed = await q.getJobs(['delayed'], 0, 999)
  let removed = 0
  for (const job of delayed) {
    if (job.name === 'check-reminders') continue
    await job.remove()
    removed++
  }
  return { ok: true, removed, message: `Removed ${removed} delayed job(s) (scheduler job left intact)` }
}

export async function sendTestEmail(to) {
  if (!isEmailConfigured()) {
    return {
      error: 'SMTP not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASSWORD in .env (e.g. Ethereal for testing).',
      status: 400
    }
  }
  const recipient = to || process.env.SMTP_USER
  await sendRequisitionReminder({
    to: recipient,
    subject: 'Requisition – test email',
    body: 'This is a test email from Employee Portal requisition flow. If you got this, SMTP is working.',
    meta: { event: 'test', ref: '' }
  })
  return { ok: true, message: 'Test email sent to ' + recipient, hint: 'Ethereal: check https://ethereal.email/messages' }
}

export async function getDebug(employeeId) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return { error: 'Valid employee ID is required', status: 400 }
  const emp = await reqRepo.getEmployeeForDebug(eid)
  if (!emp.length) return { error: 'Employee not found', status: 404 }
  const e = emp[0]
  const deptId = e.department_id
  const hodId = await reqRepo.getHodByDepartment(deptId)
  const youAreHod = hodId !== null && hodId === parseInt(employeeId, 10)
  const youAreCommittee = await reqRepo.isCommitteeMember(eid)
  const youAreCeo = await reqRepo.isCeoMember(eid)

  let allReqs = []
  let pendingHodCount = 0
  let pendingCommitteeCount = 0
  let pendingCeoCount = 0
  try {
    allReqs = await reqRepo.getLastRequisitions()
    pendingHodCount = await reqRepo.getPendingHodCount(deptId, (e.department_name || '').trim().toLowerCase())
    pendingCommitteeCount = await reqRepo.getPendingCommitteeCount()
    pendingCeoCount = await reqRepo.getPendingCeoCount()
  } catch (qerr) {
    allReqs = [{ error: qerr.message }]
  }

  return {
    you: {
      employeeId: e.employee_id,
      name: `${e.first_name} ${e.last_name}`,
      departmentId: e.department_id,
      departmentName: e.department_name,
      employeeTypeName: e.emp_type_name,
      designationName: e.designation_name
    },
    roles: { youAreHod, youAreCommittee, youAreCeo, hodOfYourDeptEmployeeId: hodId },
    counts: {
      pendingHodForYourDept: pendingHodCount,
      pendingCommittee: pendingCommitteeCount,
      pendingCeo: pendingCeoCount
    },
    lastRequisitions: allReqs
  }
}

export async function getReportAll(employeeId) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return { error: 'Valid employee ID is required', status: 400 }
  const emp = await reqRepo.getEmployeeDeptForReport(eid)
  const deptId = emp?.department_id ?? null
  const deptNameLower = emp?.department_name_lower ?? ''
  const youAreHod = deptId != null && (await reqRepo.isHodOfDepartment(eid, deptId))
  const [isCommittee, isCeo, isSuperAdmin] = await Promise.all([
    reqRepo.isCommitteeMember(eid),
    reqRepo.isCeoMember(eid),
    reqRepo.isSuperAdmin(eid)
  ])
  const canView = youAreHod || isCommittee || isCeo || isSuperAdmin
  if (!canView) return []

  const hodOnlyFilter = youAreHod && !isCommittee && !isCeo && !isSuperAdmin
  const rows = hodOnlyFilter
    ? await reqRepo.getReportAllRequisitionsHod(deptId, deptNameLower)
    : await reqRepo.getReportAllRequisitions()
  const reqIds = rows.map(r => r.req_id)
  const items = reqIds.length ? await reqRepo.getItemsByReqIds(reqIds) : []

  // Fetch rejection comments for rejected requisitions to include stage and reason
  const rejectedIds = rows.filter(r => r.req_is_rejected === 1).map(r => r.req_id)
  const commentsMap = rejectedIds.length ? await reqRepo.getRequisitionCommentsByReqIds(rejectedIds) : new Map()

  return rows.map(req => {
    const base = { ...req, status: getRequisitionStatus(req), items: items.filter(i => i.req_id === req.req_id) }
    if (req.req_is_rejected === 1) {
      const comments = commentsMap.get(req.req_id) || []
      const rejectionComment = comments.find(c => c.comment_text && c.comment_text.startsWith('[Rejection reason]'))
      base.rejection_stage = rejectionComment?.stage_key || null
      base.rejection_reason = req.req_rejection_reason || (rejectionComment ? rejectionComment.comment_text.replace('[Rejection reason] ', '').trim() : null)
    }
    return base
  })
}

export async function getPendingHod(employeeId) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return { error: 'Valid employee ID is required', status: 400 }

  // Get ALL departments this employee is HOD of (handles multi-department HODs)
  const hodDepartments = await reqRepo.getHodDepartmentsForEmployee(eid)
  if (hodDepartments.length === 0) return []

  const allRows = []
  const seenReqIds = new Set()

  for (const dept of hodDepartments) {
    const deptId = dept.department_id
    const deptName = (dept.department_name || '').trim().toLowerCase()

    let rows = []
    try {
      // Always use stage-based query to get only HOD bucket requisitions
      const byStage = await reqRepo.getPendingRequisitionsByCurrentStage('hod', { departmentId: deptId, departmentName: deptName })
      let ackList = []
      try {
        ackList = await reqRepo.getPendingHodAcknowledgeList(deptId, deptName)
      } catch (_) {}
      const byStageIds = new Set((byStage || []).map(r => r.req_id))
      const merged = [...(byStage || [])]
      for (const r of ackList || []) {
        if (!byStageIds.has(r.req_id)) merged.push(r)
      }
      rows = merged
    } catch (err) {
      if (err.code === '42703') rows = []
      else throw err
    }

    try {
      const extRows = await reqRepo.getRequisitionsNeedingDeadlineExtensionByDept(deptId, deptName)
      for (const r of extRows || []) {
        if (r.req_id != null && !rows.some(x => x.req_id === r.req_id)) rows.push(r)
      }
    } catch (_) {}

    for (const r of rows || []) {
      if (r.req_id != null && !seenReqIds.has(r.req_id)) {
        seenReqIds.add(r.req_id)
        allRows.push(r)
      }
    }
  }

  allRows.sort((a, b) => new Date(a.req_created_at) - new Date(b.req_created_at))

  const reqIds = allRows.map(r => r.req_id)
  const items = reqIds.length ? await reqRepo.getItemsByReqIds(reqIds) : []
  return allRows.map(req => ({ ...req, status: getRequisitionStatus(req), items: items.filter(i => i.req_id === req.req_id) }))
}

export async function getApprovedByHod(employeeId) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return { error: 'Valid employee ID is required', status: 400 }
  const emp = await reqRepo.getEmployeeDept(employeeId)
  if (!emp) return { error: 'Employee not found', status: 404 }
  const deptId = emp.department_id
  const deptName = (emp.department_name || '').trim().toLowerCase()
  if (deptId == null && !deptName) return []
  const isHodForDept = await reqRepo.isHodOfDepartment(eid, deptId)
  if (!isHodForDept) return []

  // Get ALL requisitions where HOD has approved (req_hod_approval = 1)
  // Simple filter: HOD approved + same department
  // Exclude requisitions created by the current user
  const rows = await reqRepo.getAllHodApprovedRequisitions(deptId, deptName, eid)
  const reqIds = rows.map(r => r.req_id)
  const items = reqIds.length ? await reqRepo.getItemsByReqIds(reqIds) : []
  const list = rows.map(req => ({ ...req, status: getRequisitionStatus(req), items: items.filter(i => i.req_id === req.req_id) }))
  return list
}

export async function getApprovedByCommittee(employeeId) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return { error: 'Valid employee ID is required', status: 400 }
  const isCommittee = await reqRepo.isCommitteeMember(employeeId)
  if (!isCommittee) return []

  // Get ALL requisitions where Committee has approved (req_committee_approval = 1)
  // All departments - Committee oversees all HODs
  // Exclude requisitions created by the current user
  const rows = await reqRepo.getApprovedByCommitteeRequisitions(eid)
  const reqIds = rows.map(r => r.req_id)
  const items = reqIds.length ? await reqRepo.getItemsByReqIds(reqIds) : []
  const list = rows.map(req => ({ ...req, status: getRequisitionStatus(req), items: items.filter(i => i.req_id === req.req_id) }))
  return list
}

export async function getApprovedByCeo(employeeId) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return { error: 'Valid employee ID is required', status: 400 }
  const isCeo = await reqRepo.isCeoMember(employeeId)
  if (!isCeo) return []

  // Get ALL requisitions where CEO has approved (req_ceo_approval = 1)
  // All departments - CEO oversees Committee and all HODs
  // Exclude requisitions created by the current user
  const rows = await reqRepo.getApprovedByCeoRequisitions(eid)
  const reqIds = rows.map(r => r.req_id)
  const items = reqIds.length ? await reqRepo.getItemsByReqIds(reqIds) : []
  const list = rows.map(req => ({ ...req, status: getRequisitionStatus(req), items: items.filter(i => i.req_id === req.req_id) }))
  return list
}

export async function approveHod(body) {
  const boqItemsRaw = body.boqItems ?? body.boq_items
  const boqItems = Array.isArray(boqItemsRaw) ? boqItemsRaw : []
  const { requisitionId, approved } = body
  const approverEid = await resolveApproverEmployeeId(body)
  if (!requisitionId || approverEid == null) {
    return { error: 'requisitionId and approvedByEmployeeId or approvedByEmployeeCode required', status: 400 }
  }
  const reqRow = await reqRepo.getRequisitionAndDepartment(requisitionId)
  if (!reqRow.length) return { error: 'Requisition not found', status: 404 }
  const deptIdForReq = reqRow[0].department_id
  const isHodForDept = deptIdForReq != null && (await reqRepo.isHodOfDepartment(approverEid, deptIdForReq))
  if (!isHodForDept) {
    return { error: 'Only HOD of the same department can approve', status: 403 }
  }
  if (approved === false) {
    const reason = body.rejectionReason != null ? String(body.rejectionReason).trim() : ''
    if (!reason) return { error: 'Rejection reason is required. Please state why this requisition is being rejected.', status: 400 }
    const creatorId = await notifRepo.getRequisitionCreatorId(requisitionId)
    await rejectWithReason(requisitionId, reason, approverEid, 'hod')
    if (creatorId) {
      notifSvc.notifySafe(notifSvc.notify({
        recipientEmployeeId: creatorId,
        type: 'requisition_rejected',
        title: 'Requisition rejected by HOD',
        body: `Your requisition was rejected by HOD. Reason: ${reason}`,
        url: '/requisition/history',
        relatedEntityType: 'requisition',
        relatedEntityId: requisitionId
      }))
    }
    return { message: 'Requisition rejected', status: 'Rejected' }
  }

  // Category from DB or from request body (fallback for old reqs or when column missing)
  const categoryName = reqRow[0]?.req_category ?? body.req_category ?? null
  const noBoqCategory = isCategoryNoBoq(categoryName)

  // For no-BOQ categories (Loan, Event, Vehicle Maintenance, etc.): approve without BOQ, advance by flow only
  if (noBoqCategory) {
    await reqRepo.approveHod(requisitionId, approverEid)
    const stages = await reqRepo.getFlowStages()
    const hasHrStage = stages.some((s) => (s.stage_key || '').toLowerCase() === 'hr')
    let nextKey = categoryName ? await reqRepo.getNextStageKey(categoryName, 'hod') : null
    // Loan & Advance Salary (and any category with HR after HOD): must go to HR first if HR stage exists
    if (isCategoryHrAfterHod(categoryName) && hasHrStage) {
      nextKey = 'hr'
    }
    // If still unknown, use next stage after HOD in flow order
    if (!nextKey) {
      const hodIdx = stages.findIndex((s) => s.stage_key === 'hod')
      nextKey = (hodIdx >= 0 && hodIdx < stages.length - 1) ? stages[hodIdx + 1].stage_key : 'committee'
    }
    await setCurrentStage(requisitionId, nextKey)
    const bucket = nextKey === 'hr' ? 'hr' : (nextKey === 'committee' ? 'committee' : nextKey)
    await notifyBucketChanged(requisitionId, bucket)
    notifSvc.notifySafe(inAppNotifyRequisitionBucket(requisitionId, bucket, deptIdForReq))
    const statusLabel = nextKey === 'hr' ? 'Pending HR' : (nextKey === 'committee' ? 'Pending Committee' : `Pending ${nextKey}`)
    return { message: 'HOD approval recorded', status: statusLabel }
  }

  if (boqItems.length > 0) {
    for (const row of boqItems) {
      const itemId = (row.itemId ?? row.item_id) != null ? parseInt(row.itemId ?? row.item_id, 10) : null
      if (itemId == null || Number.isNaN(itemId)) continue
      const size = row.size != null ? String(row.size).trim() : null
      const qty = (row.quantity != null && row.quantity !== '') ? parseInt(row.quantity, 10) : null
      const brand = row.brand != null ? String(row.brand).trim() : null
      const estCostVal = row.estCost ?? row.est_cost ?? ''
      const estCost = (estCostVal != null && String(estCostVal).trim() !== '') ? String(estCostVal).trim() : null
      await reqRepo.updateItemHodBoq(itemId, requisitionId, size, brand, qty, estCost)
    }
  }

  const items = await reqRepo.getRequisitionItems(requisitionId)
  if (!items.length) return { error: 'Requisition has no items', status: 400 }

  if (boqItems.length > 0) {
    // Validate BOQ from request payload only.
    const boqByItemId = new Map()
    for (const row of boqItems) {
      const itemId = (row.itemId ?? row.item_id) != null ? parseInt(row.itemId ?? row.item_id, 10) : null
      if (itemId == null || Number.isNaN(itemId)) continue
      const qtyRaw = row.quantity
      const qty = (qtyRaw != null && qtyRaw !== '') ? parseInt(qtyRaw, 10) : 0
      const costVal = row.estCost ?? row.est_cost ?? ''
      const costStr = costVal != null ? String(costVal).trim() : ''
      const pricePerPiece = costStr !== '' ? parseNumericCostPkr(costStr) : null
      if (pricePerPiece == null || pricePerPiece < 0) {
        return { error: 'Every item must have a valid price per piece (PKR): numbers only, optional decimal.', status: 400 }
      }
      if (Number.isNaN(qty) || qty < 0) {
        return { error: 'Every item must have a valid quantity.', status: 400 }
      }
      boqByItemId.set(itemId, { qty, pricePerPiece })
    }
    const covered = items.every(it => {
      const id = it.item_id ?? it.itemId
      return id != null && boqByItemId.has(Number(id))
    })
    if (!covered || boqByItemId.size === 0) {
      return { error: 'BOQ (quantity and price per piece) is required for every item. Please fill all items and submit again.', status: 400 }
    }
  } else {
    for (const it of items) {
      const qty = (it.item_qty != null && !Number.isNaN(Number(it.item_qty))) ? Number(it.item_qty) : (it.hod_item_qty != null ? Number(it.hod_item_qty) : 0)
      const pricePerPiece = getEffectiveUnitPricePkrFromItem(it)
      if (pricePerPiece == null || pricePerPiece < 0) {
        return { error: 'Every item must have a valid price per piece (PKR): numbers only, optional decimal.', status: 400 }
      }
      if (qty < 0 || Number.isNaN(qty)) {
        return { error: 'Every item must have a valid quantity.', status: 400 }
      }
    }
  }

  await reqRepo.approveHod(requisitionId, approverEid)
  const nextKey = categoryName ? await reqRepo.getNextStageKey(categoryName, 'hod') : null
  await setCurrentStage(requisitionId, nextKey || 'committee')
  const bucket = nextKey === 'hr' ? 'hr' : 'committee'
  await notifyBucketChanged(requisitionId, bucket)
  notifSvc.notifySafe(inAppNotifyRequisitionBucket(requisitionId, bucket, deptIdForReq))
  const statusLabel = nextKey === 'hr' ? 'Pending HR' : 'Pending Committee'
  return { message: 'HOD approval recorded', status: statusLabel }
}

export async function getPendingHR(employeeId) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return { error: 'Valid employee ID is required', status: 400 }
  const useFlow = (await reqRepo.getFlowStages()).length > 0
  const ok = useFlow ? await reqRepo.isEmployeeTypeForStage(eid, 'hr') : await reqRepo.isHrMember(eid)
  if (!ok) return []
  // Always filter by current stage key to show only HR bucket requisitions
  const rows = await reqRepo.getPendingRequisitionsByCurrentStage('hr')
  const reqIds = rows.map(r => r.req_id)
  const items = reqIds.length ? await reqRepo.getItemsByReqIds(reqIds) : []
  const list = rows.map(req => ({ ...req, status: 'Pending HR', items: items.filter(i => i.req_id === req.req_id) }))
  return list
}

export async function getPendingAdmin(employeeId) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return { error: 'Valid employee ID is required', status: 400 }
  const useFlow = (await reqRepo.getFlowStages()).length > 0
  const ok = useFlow ? await reqRepo.isEmployeeTypeForStage(eid, 'admin') : await reqRepo.isAdminMember(eid)
  if (!ok) return []
  // Always filter by current stage key to show only Admin bucket requisitions
  const rows = await reqRepo.getPendingRequisitionsByCurrentStage('admin')
  const reqIds = rows.map(r => r.req_id)
  const items = reqIds.length ? await reqRepo.getItemsByReqIds(reqIds) : []
  const list = rows.map(req => ({ ...req, status: 'Pending Admin', items: items.filter(i => i.req_id === req.req_id) }))
  return list
}

export async function getPendingCommittee(employeeId) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return { error: 'Valid employee ID is required', status: 400 }
  const useFlow = (await reqRepo.getFlowStages()).length > 0
  const ok = useFlow ? await reqRepo.isEmployeeTypeForStage(eid, 'committee') : await reqRepo.isCommitteeMember(eid)
  if (!ok) return []
  // Always filter by current stage key to show only Committee bucket requisitions
  const rows = await reqRepo.getPendingRequisitionsByCurrentStage('committee')
  const reqIds = rows.map(r => r.req_id)
  const items = reqIds.length ? await reqRepo.getItemsByReqIds(reqIds) : []
  const list = rows.map(req => ({ ...req, status: 'Pending Committee', items: items.filter(i => i.req_id === req.req_id) }))
  return list
}

export async function approveHR(body) {
  const { requisitionId, approved } = body
  const reqId = requisitionId != null ? parseInt(requisitionId, 10) : null
  const eid = await resolveApproverEmployeeId(body)
  if (reqId == null || Number.isNaN(reqId) || eid == null) {
    return { error: 'Valid requisitionId and approvedByEmployeeId or approvedByEmployeeCode are required', status: 400 }
  }
  const useFlow = (await reqRepo.getFlowStages()).length > 0
  console.log('[approveHR] Flow check:', { useFlow, stagesLength: (await reqRepo.getFlowStages()).length })
  const ok = useFlow ? await reqRepo.isEmployeeTypeForStage(eid, 'hr') : await reqRepo.isHrMember(eid)
  console.log('[approveHR] Role check:', { ok, useFlow, eid })
  if (!ok) {
    return { error: 'Only HR can approve this stage. Check your Employee Type or Designation.', status: 403 }
  }
  if (approved === false) {
    const reason = body.rejectionReason != null ? String(body.rejectionReason).trim() : ''
    if (!reason) return { error: 'Rejection reason is required. Please state why this requisition is being rejected.', status: 400 }
    const creatorId = await notifRepo.getRequisitionCreatorId(reqId)
    await rejectWithReason(reqId, reason, eid, 'hr')
    if (creatorId) {
      notifSvc.notifySafe(notifSvc.notify({
        recipientEmployeeId: creatorId,
        type: 'requisition_rejected',
        title: 'Requisition rejected by HR',
        body: `Your requisition was rejected by HR. Reason: ${reason}`,
        url: '/requisition/history',
        relatedEntityType: 'requisition',
        relatedEntityId: reqId
      }))
    }
    return { message: 'Requisition rejected', status: 'Rejected' }
  }
  await reqRepo.approveHr(reqId)
  const reqRow = await reqRepo.getRequisitionAndDepartment(reqId)
  const categoryName = reqRow[0]?.req_category
  let nextKey = categoryName ? await reqRepo.getNextStageKey(categoryName, 'hr') : 'committee'
  // Loan & Advance Salary: Amount <50K -> Finance only; >=50K -> CEO then Finance
  if (isCategoryHrAfterHod(categoryName)) {
    const items = await reqRepo.getRequisitionItems(reqId)
    let total = 0
    for (const it of items || []) {
      const qty = Number(it.hod_item_qty ?? it.item_qty) || 0
      const cost = parseFloat(String(it.hod_item_est_cost ?? it.item_est_cost ?? '0').replace(/,/g, '')) || 0
      total += qty * cost
    }
    nextKey = total < 50000 ? 'finance' : 'ceo'
  }
  await setCurrentStage(reqId, nextKey || 'committee')
  await notifyBucketChanged(reqId, nextKey || 'committee')
  const bucketAfterHr = nextKey || 'committee'
  const deptIdHr = reqRow[0]?.department_id
  notifSvc.notifySafe(inAppNotifyRequisitionBucket(reqId, bucketAfterHr, deptIdHr))
  return { message: 'HR approval recorded', status: nextKey === 'ceo' ? 'Pending CEO' : (nextKey === 'finance' ? 'Pending Finance' : (nextKey === 'committee' ? 'Pending Committee' : `Pending ${nextKey}`)) }
}

export async function approveCommittee(body) {
  const { requisitionId, approved, approvedQuantities } = body
  const reqId = requisitionId != null ? parseInt(requisitionId, 10) : null
  const eid = await resolveApproverEmployeeId(body)
  if (reqId == null || Number.isNaN(reqId) || eid == null) {
    return { error: 'Valid requisitionId and approvedByEmployeeId or approvedByEmployeeCode are required', status: 400 }
  }
  const useFlow = (await reqRepo.getFlowStages()).length > 0
  const ok = useFlow ? await reqRepo.isEmployeeTypeForStage(eid, 'committee') : await reqRepo.isCommitteeMember(eid)
  if (!ok) {
    return { error: 'Only Committee members can approve. Check your Employee Type or Designation in Administration.', status: 403 }
  }
  if (approved === false) {
    const reason = body.rejectionReason != null ? String(body.rejectionReason).trim() : ''
    if (!reason) return { error: 'Rejection reason is required. Please state why this requisition is being cancelled.', status: 400 }
    const creatorId = await notifRepo.getRequisitionCreatorId(reqId)
    await rejectWithReason(reqId, reason, eid, 'committee')
    if (creatorId) {
      notifSvc.notifySafe(notifSvc.notify({
        recipientEmployeeId: creatorId,
        type: 'requisition_rejected',
        title: 'Requisition cancelled by Committee',
        body: `Your requisition was cancelled by Committee. Reason: ${reason}`,
        url: '/requisition/history',
        relatedEntityType: 'requisition',
        relatedEntityId: reqId
      }))
    }
    return { message: 'Requisition cancelled', status: 'Rejected' }
  }
  // On approve: approved quantity per item is mandatory
  const items = await reqRepo.getRequisitionItems(reqId)
  if (items.length === 0) {
    return { error: 'Requisition has no items', status: 400 }
  }
  const byItemId = Array.isArray(approvedQuantities)
    ? approvedQuantities.reduce((acc, x) => {
        const id = x.itemId != null ? parseInt(x.itemId, 10) : null
        const qty = x.approvedQty != null ? parseInt(x.approvedQty, 10) : null
        if (id != null && !Number.isNaN(id) && qty != null && !Number.isNaN(qty) && qty >= 0) acc[id] = qty
        return acc
      }, {})
    : {}
  for (const it of items) {
    const itemId = it.item_id ?? it.itemId
    if (itemId == null || byItemId[itemId] === undefined) {
      return { error: 'Approved quantity is required for every item. Please enter quantity for each line item.', status: 400 }
    }
  }
  for (const it of items) {
    const itemId = it.item_id ?? it.itemId
    await reqRepo.updateItemCommitteeApprovedQty(itemId, byItemId[itemId])
  }
  await reqRepo.approveCommittee(reqId)

  const reqRow = await reqRepo.getRequisitionAndDepartment(reqId)
  const categoryName = reqRow[0]?.req_category
  const stages = await reqRepo.getFlowStages()
  const nextKeyFromFlow = categoryName && stages.length > 0 ? await reqRepo.getNextStageKey(categoryName, 'committee') : null

  // When category flow defines next stage after committee (e.g. Devices/Accessories → Finance, not CEO), respect it.
  if (nextKeyFromFlow && nextKeyFromFlow !== 'ceo') {
    await setCurrentStage(reqId, nextKeyFromFlow)
    await notifyBucketChanged(reqId, nextKeyFromFlow)
    const deptRow = await reqRepo.getRequisitionAndDepartment(reqId)
    notifSvc.notifySafe(inAppNotifyRequisitionBucket(reqId, nextKeyFromFlow, deptRow[0]?.department_id))
    const statusLabel = nextKeyFromFlow === 'finance' ? 'Pending Finance Approval' : nextKeyFromFlow === 'procurement' ? 'Forwarded to Procurement' : `Pending ${nextKeyFromFlow}`
    return { message: 'Committee approval recorded', status: statusLabel }
  }

  // When next stage is CEO (or no flow): line total strictly under REQUISITION_CEO_MIN_AMOUNT_PKR → skip CEO, forward to Procurement.
  const itemsAfter = await reqRepo.getRequisitionItems(reqId)
  const totalAfterCommittee = computeCommitteeApprovedLineTotalPKR(itemsAfter)
  if (totalAfterCommittee < REQUISITION_CEO_MIN_AMOUNT_PKR) {
    await reqRepo.approveCeo(reqId)
    await setCurrentStage(reqId, 'procurement')
    await notifyBucketChanged(reqId, 'procurement')
    notifSvc.notifySafe(inAppNotifyRequisitionBucket(reqId, 'procurement', reqRow[0]?.department_id))
    return { message: `Committee approval recorded; forwarded to Procurement (line total under ${REQUISITION_CEO_MIN_AMOUNT_PKR.toLocaleString()} PKR — CEO stage skipped)`, status: 'Forwarded to Procurement' }
  }

  const nextKey = nextKeyFromFlow || 'ceo'
  await setCurrentStage(reqId, nextKey)
  await notifyBucketChanged(reqId, nextKey)
  notifSvc.notifySafe(inAppNotifyRequisitionBucket(reqId, nextKey, reqRow[0]?.department_id))
  return { message: 'Committee approval recorded', status: 'Pending CEO' }
}

/** Auto-approve CEO and move to Procurement when line total is under threshold (same rule as Committee approve). */
async function applyCeoSkipToProcurementIfUnderThreshold(reqId) {
  const lineItems = await reqRepo.getRequisitionItems(reqId)
  const lineTotal = computeCommitteeApprovedLineTotalPKR(lineItems)
  if (lineTotal >= REQUISITION_CEO_MIN_AMOUNT_PKR) return false
  await reqRepo.approveCeo(reqId)
  await setCurrentStage(reqId, 'procurement')
  await notifyBucketChanged(reqId, 'procurement')
  const deptRow = await reqRepo.getRequisitionAndDepartment(reqId)
  notifSvc.notifySafe(inAppNotifyRequisitionBucket(reqId, 'procurement', deptRow[0]?.department_id))
  return true
}

/**
 * Fix stuck rows: DB stage CEO but committee line total is below CEO threshold (e.g. after raising REQUISITION_CEO_MIN_AMOUNT_PKR).
 * Safe to call from diagnostics lookup or CEO pending list.
 */
export async function repairCeoBucketIfUnderThreshold(reqId) {
  const rows = await executeQuery(
    `SELECT r.req_id, r.req_hod_approval, r.req_committee_approval, r.req_ceo_approval,
            r.req_is_rejected, r.req_purchase_completed, r.req_hod_acknowledged, r.req_creator_role
     FROM requisition r WHERE r.req_id = $1`,
    [reqId]
  )
  const row = rows[0]
  if (!row || Number(row.req_is_rejected) === 1) return { repaired: false }
  const hodOk = Number(row.req_hod_approval) === 1
  const committeeOk = Number(row.req_committee_approval) === 1
  const ceoPending = row.req_ceo_approval == null || Number(row.req_ceo_approval) === 0
  const ceoAckPurchaseRow =
    Number(row.req_purchase_completed) === 1 &&
    (row.req_hod_acknowledged == null || Number(row.req_hod_acknowledged) === 0) &&
    String(row.req_creator_role || '') === 'CEO'
  if (!hodOk || !committeeOk || !ceoPending || ceoAckPurchaseRow) return { repaired: false }
  const repaired = await applyCeoSkipToProcurementIfUnderThreshold(reqId)
  return { repaired }
}

export async function getPendingCeo(employeeId) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return { error: 'Valid employee ID is required', status: 400 }
  const useFlow = (await reqRepo.getFlowStages()).length > 0
  const ok = useFlow ? await reqRepo.isEmployeeTypeForStage(eid, 'ceo') : await reqRepo.isCeoMember(eid)
  if (!ok) return []
  // Always filter by current stage key to show only CEO bucket requisitions
  let rows = await reqRepo.getPendingRequisitionsByCurrentStage('ceo')
  const repaired = []
  for (const r of rows) {
    const hodOk = Number(r.req_hod_approval) === 1
    const committeeOk = Number(r.req_committee_approval) === 1
    const ceoPending = r.req_ceo_approval == null || Number(r.req_ceo_approval) === 0
    const normalCeoApprovalPending = hodOk && committeeOk && ceoPending
    const ceoAckPurchaseRow =
      Number(r.req_purchase_completed) === 1 &&
      (r.req_hod_acknowledged == null || Number(r.req_hod_acknowledged) === 0) &&
      String(r.req_creator_role || '') === 'CEO'
    if (normalCeoApprovalPending && !ceoAckPurchaseRow) {
      const skipped = await applyCeoSkipToProcurementIfUnderThreshold(r.req_id)
      if (skipped) continue
    }
    repaired.push(r)
  }
  rows = repaired
  const reqIds = rows.map((r) => r.req_id)
  const items = reqIds.length ? await reqRepo.getItemsByReqIds(reqIds) : []
  return rows.map((req) => ({ ...req, status: 'Pending CEO', items: items.filter((i) => i.req_id === req.req_id) }))
}

export async function approveCeo(body) {
  const { requisitionId, approved } = body
  const reqId = requisitionId != null ? parseInt(requisitionId, 10) : null
  const eid = await resolveApproverEmployeeId(body)
  if (reqId == null || Number.isNaN(reqId) || eid == null) {
    return { error: 'Valid requisitionId and approvedByEmployeeId or approvedByEmployeeCode are required', status: 400 }
  }
  const ok = await reqRepo.isCeoMember(eid)
  if (!ok) {
    return { error: 'Only CEO can approve. Check your Employee Type or Designation in Administration.', status: 403 }
  }
  if (approved === false) {
    const reason = body.rejectionReason != null ? String(body.rejectionReason).trim() : ''
    if (!reason) return { error: 'Rejection reason is required. Please state why this requisition is being rejected.', status: 400 }
    const creatorId = await notifRepo.getRequisitionCreatorId(reqId)
    await rejectWithReason(reqId, reason, eid, 'ceo')
    if (creatorId) {
      notifSvc.notifySafe(notifSvc.notify({
        recipientEmployeeId: creatorId,
        type: 'requisition_rejected',
        title: 'Requisition rejected by CEO',
        body: `Your requisition was rejected by CEO. Reason: ${reason}`,
        url: '/requisition/history',
        relatedEntityType: 'requisition',
        relatedEntityId: reqId
      }))
    }
    return { message: 'Requisition rejected', status: 'Rejected' }
  }
  await reqRepo.approveCeo(reqId)
  const reqRow = await reqRepo.getRequisitionAndDepartment(reqId)
  const categoryName = reqRow[0]?.req_category
  const stages = await reqRepo.getFlowStages()
  const useFlow = stages && stages.length > 0
  const nextKeyFromFlow = categoryName && useFlow ? await reqRepo.getNextStageKey(categoryName, 'ceo') : null
  const nextKey = nextKeyFromFlow ?? (isCategoryHrAfterHod(categoryName) ? 'finance' : 'procurement')
  await setCurrentStage(reqId, nextKey)
  await notifyBucketChanged(reqId, nextKey)
  const statusLabel = nextKey === 'finance' ? 'Pending Finance' : nextKey === 'admin' ? 'Pending Admin' : 'Forwarded to Procurement'
  notifSvc.notifySafe(inAppNotifyRequisitionBucket(reqId, nextKey, reqRow[0]?.department_id))
  return { message: 'CEO approval recorded', status: statusLabel }
}

export async function approveAdmin(body) {
  const { requisitionId, approved } = body
  const reqId = requisitionId != null ? parseInt(requisitionId, 10) : null
  const eid = await resolveApproverEmployeeId(body)
  if (reqId == null || Number.isNaN(reqId) || eid == null) {
    return { error: 'Valid requisitionId and approvedByEmployeeId or approvedByEmployeeCode are required', status: 400 }
  }
  const useFlow = (await reqRepo.getFlowStages()).length > 0
  const ok = useFlow ? await reqRepo.isEmployeeTypeForStage(eid, 'admin') : await reqRepo.isAdminMember(eid)
  if (!ok) {
    return { error: 'Only Admin can approve this stage.', status: 403 }
  }
  if (approved === false) {
    const reason = body.rejectionReason != null ? String(body.rejectionReason).trim() : ''
    if (!reason) return { error: 'Rejection reason is required. Please state why this requisition is being rejected.', status: 400 }
    const creatorId = await notifRepo.getRequisitionCreatorId(reqId)
    await rejectWithReason(reqId, reason, eid, 'admin')
    if (creatorId) {
      notifSvc.notifySafe(notifSvc.notify({
        recipientEmployeeId: creatorId,
        type: 'requisition_rejected',
        title: 'Requisition rejected by Admin',
        body: `Your requisition was rejected by Admin. Reason: ${reason}`,
        url: '/requisition/history',
        relatedEntityType: 'requisition',
        relatedEntityId: reqId
      }))
    }
    return { message: 'Requisition rejected', status: 'Rejected' }
  }
  await reqRepo.approveAdmin(reqId)
  notifyCreatorAckRequired(reqId).catch((e) => console.error('notifyCreatorAckRequired after Admin:', e?.message))
  return { message: 'Admin approval recorded', status: 'Completed' }
}

export async function getPendingProcurement(employeeId) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return { error: 'Valid employee ID is required', status: 400 }
  const useFlow = (await reqRepo.getFlowStages()).length > 0
  const ok = useFlow ? await reqRepo.isEmployeeTypeForStage(eid, 'procurement') : await reqRepo.isProcurementMember(eid)
  if (!ok) return []
  // Always filter by current stage key to show only Procurement bucket requisitions
  let rows = await reqRepo.getPendingRequisitionsByCurrentStage('procurement')
  const reqIds = rows.map(r => r.req_id)
  const items = reqIds.length ? await reqRepo.getItemsByReqIds(reqIds) : []
  return rows.map(req => ({ ...req, status: getRequisitionStatus(req), items: items.filter(i => i.req_id === req.req_id) }))
}

export async function acknowledgeProcurement(body) {
  const { requisitionId } = body
  const reqId = requisitionId != null ? parseInt(requisitionId, 10) : null
  const eid = await resolveApproverEmployeeId({ approvedByEmployeeId: body.acknowledgedByEmployeeId, approvedByEmployeeCode: body.acknowledgedByEmployeeCode })
  if (reqId == null || Number.isNaN(reqId) || eid == null) {
    return { error: 'Valid requisitionId and acknowledgedByEmployeeId or acknowledgedByEmployeeCode are required', status: 400 }
  }
  const ok = await reqRepo.isProcurementMember(eid)
  if (!ok) return { error: 'Only Procurement can acknowledge', status: 403 }
  const rows = await reqRepo.getRequisitionForProcurementAck(reqId)
  if (!rows.length) return { error: 'Requisition not found or not yet forwarded to Procurement', status: 404 }
  await reqRepo.acknowledgeProcurement(reqId, eid)
  return { message: 'Requisition acknowledged by Procurement', status: 'Acknowledged by Procurement - Add 3 Quotations' }
}

export async function rejectProcurement(body) {
  const { requisitionId } = body
  const reqId = requisitionId != null ? parseInt(requisitionId, 10) : null
  const eid = await resolveApproverEmployeeId({ approvedByEmployeeId: body.approvedByEmployeeId, approvedByEmployeeCode: body.approvedByEmployeeCode })
  if (reqId == null || Number.isNaN(reqId) || eid == null) {
    return { error: 'Valid requisitionId and approvedByEmployeeId or approvedByEmployeeCode are required', status: 400 }
  }
  const reason = body.rejectionReason != null ? String(body.rejectionReason).trim() : ''
  if (!reason) return { error: 'Rejection reason is required. Please state why this requisition is being rejected.', status: 400 }
  const ok = await reqRepo.isProcurementMember(eid)
  if (!ok) return { error: 'Only Procurement can reject at this stage', status: 403 }
  const creatorId = await notifRepo.getRequisitionCreatorId(reqId)
  await rejectWithReason(reqId, reason, eid, 'procurement')
  if (creatorId) {
    notifSvc.notifySafe(notifSvc.notify({
      recipientEmployeeId: creatorId,
      type: 'requisition_rejected',
      title: 'Requisition rejected by Procurement',
      body: `Your requisition was rejected by Procurement. Reason: ${reason}`,
      url: '/requisition/history',
      relatedEntityType: 'requisition',
      relatedEntityId: reqId
    }))
  }
  return { message: 'Requisition rejected', status: 'Rejected' }
}

export async function updateQuotations(reqId, body) {
  const reqIdNum = parseInt(reqId, 10)
  if (Number.isNaN(reqIdNum)) return { error: 'Valid requisition ID required', status: 400 }
  const { quotation1Url, quotation2Url, quotation3Url } = body
  const eid = await resolveApproverEmployeeId({ approvedByEmployeeId: body.updatedByEmployeeId, approvedByEmployeeCode: body.updatedByEmployeeCode })
  if (eid == null) return { error: 'Valid updatedByEmployeeId or updatedByEmployeeCode required', status: 400 }
  const ok = await reqRepo.isProcurementMember(eid)
  if (!ok) return { error: 'Only Procurement can add quotations', status: 403 }
  const rows = await reqRepo.getRequisitionForQuotations(reqIdNum)
  if (!rows.length) return { error: 'Requisition not found or not acknowledged', status: 404 }
  await reqRepo.updateQuotations(reqIdNum, quotation1Url, quotation2Url, quotation3Url)
  return { message: 'Quotations updated', status: 'Quotations Added - Hand over to Finance' }
}

export async function uploadQuotations(reqId, files, updatedByEmployeeId, updatedByEmployeeCode) {
  const reqIdNum = parseInt(reqId, 10)
  if (Number.isNaN(reqIdNum)) return { error: 'Valid requisition ID required', status: 400 }
  const eid = await resolveApproverEmployeeId({ approvedByEmployeeId: updatedByEmployeeId, approvedByEmployeeCode: updatedByEmployeeCode })
  if (eid == null) return { error: 'Valid updatedByEmployeeId or updatedByEmployeeCode required', status: 400 }
  const ok = await reqRepo.isProcurementMember(eid)
  if (!ok) return { error: 'Only Procurement can add quotations', status: 403 }
  const rows = await reqRepo.getRequisitionForQuotations(reqIdNum)
  if (!rows.length) return { error: 'Requisition not found or not acknowledged', status: 404 }
  const { fileToDataUrl } = await import('../utils/file.utils.js')
  const q1 = files.quotation1?.[0]
  const q2 = files.quotation2?.[0]
  const q3 = files.quotation3?.[0]
  if (!q1 || !q2 || !q3) {
    return { error: 'Upload all 3 quotation images (quotation1, quotation2, quotation3)', status: 400 }
  }
  const dataUrl1 = fileToDataUrl(q1)
  const dataUrl2 = fileToDataUrl(q2)
  const dataUrl3 = fileToDataUrl(q3)
  if (!dataUrl1 || !dataUrl2 || !dataUrl3) {
    return { error: 'Could not read uploaded image data', status: 400 }
  }
  await reqRepo.updateQuotationsUpload(reqIdNum, dataUrl1, dataUrl2, dataUrl3)
  return {
    message: 'Quotations uploaded',
    status: 'Quotations Added - Hand over to Finance',
    quotation1Url: dataUrl1,
    quotation2Url: dataUrl2,
    quotation3Url: dataUrl3
  }
}

export async function setExpectedHandover(reqId, body) {
  const reqIdNum = parseInt(reqId, 10)
  if (Number.isNaN(reqIdNum)) return { error: 'Valid requisition ID required', status: 400 }
  const { expectedHandoverDate } = body
  const eid = await resolveApproverEmployeeId({ approvedByEmployeeId: body.updatedByEmployeeId, approvedByEmployeeCode: body.updatedByEmployeeCode })
  if (eid == null) return { error: 'Valid updatedByEmployeeId or updatedByEmployeeCode required', status: 400 }
  const ok = await reqRepo.isProcurementMember(eid)
  if (!ok) return { error: 'Only Procurement can set expected handover date', status: 403 }
  const rows = await reqRepo.getRequisitionForExpectedHandover(reqIdNum)
  if (!rows.length) return { error: 'Requisition not found or not in Procurement flow', status: 404 }
  const dateVal = expectedHandoverDate && typeof expectedHandoverDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(expectedHandoverDate.trim())
    ? expectedHandoverDate.trim()
    : null
  await reqRepo.setExpectedHandover(reqIdNum, dateVal)
  return { message: 'Expected handover date updated', expectedHandoverDate: dateVal }
}

/** HOD: update required-by date for a requisition. */
/** HOD only: update requisition items (description, size, brand, qty, est cost, remarks). Allowed only while requisition is in HOD bucket (not yet approved/forwarded). */
export async function updateItemsByHod(reqId, body) {
  const reqIdNum = parseInt(reqId, 10)
  if (Number.isNaN(reqIdNum)) return { error: 'Valid requisition ID required', status: 400 }
  const rows = await reqRepo.getRequisitionById(reqIdNum)
  if (!rows.length) return { error: 'Requisition not found', status: 404 }
  const row = rows[0]
  if (row.req_hod_approval === 1) {
    return { error: 'Requisition already forwarded. Items can only be edited while in HOD bucket.', status: 403 }
  }
  const items = Array.isArray(body.items) ? body.items : []
  if (items.length === 0) return { error: 'At least one item is required', status: 400 }
  const existingItems = await reqRepo.getRequisitionItems(reqIdNum)
  const existingIds = new Set((existingItems || []).map((i) => i.item_id))
  for (const it of items) {
    const itemId = it.itemId != null ? parseInt(it.itemId, 10) : null
    if (itemId == null || Number.isNaN(itemId) || !existingIds.has(itemId)) continue
    const item_desc = it.itemProductDescription != null ? String(it.itemProductDescription).trim() || null : undefined
    const item_size = it.itemSize != null ? String(it.itemSize).trim() || null : undefined
    const item_brand = it.itemBrand != null ? String(it.itemBrand).trim() || null : undefined
    const item_qty = it.itemQty != null ? parseInt(it.itemQty, 10) : undefined
    let item_est_cost = it.itemEstCost != null ? String(it.itemEstCost).trim() || null : undefined
    if (item_est_cost != null && item_est_cost !== '') {
      const n = parseNumericCostPkr(item_est_cost)
      if (n == null) {
        return { error: 'Estimated cost must be numeric (optional decimal) for each item.', status: 400 }
      }
      item_est_cost = String(n)
    }
    const item_remarks = it.itemRemarks != null ? String(it.itemRemarks).trim() || null : undefined
    await reqRepo.updateRequisitionItem(itemId, reqIdNum, {
      item_desc,
      item_size,
      item_brand,
      item_qty: (item_qty != null && !Number.isNaN(item_qty)) ? item_qty : undefined,
      item_est_cost,
      item_remarks
    })
  }
  return { message: 'Items updated' }
}

/** HOD only: delete a single item from a requisition. Allowed only while in HOD bucket. Must keep at least 1 item. */
export async function deleteItemByHod(reqId, itemId) {
  const reqIdNum = parseInt(reqId, 10)
  const itemIdNum = parseInt(itemId, 10)
  if (Number.isNaN(reqIdNum) || Number.isNaN(itemIdNum)) {
    return { error: 'Valid requisition ID and item ID required', status: 400 }
  }
  const rows = await reqRepo.getRequisitionById(reqIdNum)
  if (!rows.length) return { error: 'Requisition not found', status: 404 }
  const row = rows[0]
  if (row.req_hod_approval === 1) {
    return { error: 'Requisition already forwarded. Items can only be deleted while in HOD bucket.', status: 403 }
  }
  const existingItems = await reqRepo.getRequisitionItems(reqIdNum)
  if (existingItems.length <= 1) {
    return { error: 'Cannot delete the last item. A requisition must have at least one item.', status: 400 }
  }
  const belongs = existingItems.some((i) => i.item_id === itemIdNum)
  if (!belongs) return { error: 'Item not found in this requisition', status: 404 }
  await reqRepo.deleteRequisitionItem(itemIdNum, reqIdNum)
  return { message: 'Item deleted' }
}

/** HOD only: add a single item to a requisition. Allowed only while in HOD bucket. */
export async function addItemByHod(reqId, body) {
  const reqIdNum = parseInt(reqId, 10)
  if (Number.isNaN(reqIdNum)) return { error: 'Valid requisition ID required', status: 400 }
  const rows = await reqRepo.getRequisitionById(reqIdNum)
  if (!rows.length) return { error: 'Requisition not found', status: 404 }
  const row = rows[0]
  if (row.req_hod_approval === 1) {
    return { error: 'Requisition already forwarded. Items can only be added while in HOD bucket.', status: 403 }
  }
  const { item_desc, item_size, item_brand, item_qty, item_est_cost, item_remarks } = body
  if (!item_desc || String(item_desc).trim() === '') {
    return { error: 'Item description is required', status: 400 }
  }
  const item = {
    item_desc: String(item_desc).trim(),
    item_size: item_size != null ? String(item_size).trim() || null : null,
    item_brand: item_brand != null ? String(item_brand).trim() || null : null,
    item_qty: item_qty != null ? parseInt(item_qty, 10) || 1 : 1,
    item_est_cost: item_est_cost != null ? String(item_est_cost).trim() || null : null,
    item_remarks: item_remarks != null ? String(item_remarks).trim() || null : null
  }
  // Validate cost if provided
  if (item.item_est_cost && item.item_est_cost !== '') {
    const n = parseNumericCostPkr(item.item_est_cost)
    if (n == null) {
      return { error: 'Estimated cost must be numeric (optional decimal).', status: 400 }
    }
    item.item_est_cost = String(n)
  }
  await reqRepo.insertRequisitionItem(reqIdNum, item)
  return { message: 'Item added' }
}

function toDateOnlyString(val) {
  if (val == null) return null
  const s = String(val)
  if (s.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function todayDateOnlyStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function isCommitteeActor(employeeId) {
  const useFlow = (await reqRepo.getFlowStages()).length > 0
  return useFlow ? reqRepo.isEmployeeTypeForStage(employeeId, 'committee') : reqRepo.isCommitteeMember(employeeId)
}

export async function updateRequiredByDate(reqId, body) {
  const reqIdNum = parseInt(reqId, 10)
  if (Number.isNaN(reqIdNum)) return { error: 'Valid requisition ID required', status: 400 }
  const { requiredByDate } = body
  const eid = await resolveApproverEmployeeId({ approvedByEmployeeId: body.updatedByEmployeeId, approvedByEmployeeCode: body.updatedByEmployeeCode })
  if (eid == null) return { error: 'Valid updatedByEmployeeId or updatedByEmployeeCode required', status: 400 }
  const rows = await reqRepo.getRequisitionById(reqIdNum)
  if (!rows.length) return { error: 'Requisition not found', status: 404 }
  const row = rows[0]
  if (row.req_is_rejected === 1) {
    return { error: 'Cannot change date for a rejected requisition', status: 400 }
  }
  if (row.req_purchase_completed === 1) {
    return { error: 'Cannot change date after purchase is marked complete', status: 400 }
  }

  const reqRowDept = await reqRepo.getRequisitionAndDepartment(reqIdNum)
  const deptId = reqRowDept[0]?.department_id
  const isHod = deptId != null && (await reqRepo.isHodOfDepartment(eid, deptId))
  const isCommittee = await isCommitteeActor(eid)

  const reqDateStr = toDateOnlyString(row.req_required_by_date)
  const todayStr = todayDateOnlyStr()
  const deadlineReachedOrPassed = reqDateStr != null && reqDateStr <= todayStr
  const extensionScenario = deadlineReachedOrPassed

  const normalHodPath = !row.req_hod_approval && isHod
  const extensionPath = extensionScenario && (isHod || isCommittee)

  if (!normalHodPath && !extensionPath) {
    if (extensionScenario && !isHod && !isCommittee) {
      return { error: 'Only the requestor\'s HOD or a Committee member can extend the required-by date after the deadline.', status: 403 }
    }
    if (!extensionScenario && !normalHodPath) {
      return { error: 'Only the requestor\'s HOD can change the required-by date before forwarding, or HOD/Committee can extend after the required-by date has passed.', status: 403 }
    }
    return { error: 'You are not allowed to update this requisition\'s required-by date.', status: 403 }
  }

  const dateVal = requiredByDate && typeof requiredByDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(requiredByDate.trim())
    ? requiredByDate.trim()
    : null
  if (dateVal) {
    const minDate = new Date()
    minDate.setDate(minDate.getDate() + 4)
    const minStr = `${minDate.getFullYear()}-${String(minDate.getMonth() + 1).padStart(2, '0')}-${String(minDate.getDate()).padStart(2, '0')}`
    if (dateVal < minStr) {
      return { error: 'Required by date must be at least 4 days from today. You cannot select today or the next 3 days.', status: 400 }
    }
    const d = new Date(dateVal + 'T12:00:00')
    if (d.getDay() === 0) {
      return { error: 'Sundays are not allowed. Please select another day.', status: 400 }
    }
  }
  await reqRepo.updateRequiredByDate(reqIdNum, dateVal)
  return { message: 'Required by date updated', requiredByDate: dateVal }
}

/** List requisitions finance-approved, category has execution_admin=1, not yet completed (for Admin to mark complete). */
export async function getPendingAdminExecution(employeeId) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return { error: 'Valid employee ID is required', status: 400 }
  const ok = await reqRepo.isAdminMember(eid)
  if (!ok) return []
  try {
    const rows = await reqRepo.getPendingAdminExecutionRequisitions()
    const reqIds = rows.map(r => r.req_id)
    const items = reqIds.length ? await reqRepo.getItemsByReqIds(reqIds) : []
    const list = rows.map(req => ({
      ...req,
      status: getRequisitionStatus(req),
      items: items.filter(i => i.req_id === req.req_id)
    }))
    return list
  } catch (_) {
    return []
  }
}

/** Procurement or Admin (for execution_admin categories): mark requisition as complete. */
export async function completePurchase(reqId, body) {
  const reqIdNum = parseInt(reqId, 10)
  if (Number.isNaN(reqIdNum)) return { error: 'Valid requisition ID required', status: 400 }
  const eid = await resolveApproverEmployeeId({ approvedByEmployeeId: body.completedByEmployeeId, approvedByEmployeeCode: body.completedByEmployeeCode })
  if (eid == null) return { error: 'Valid completedByEmployeeId or completedByEmployeeCode required', status: 400 }
  const isProcurement = await reqRepo.isProcurementMember(eid)
  const isAdmin = await reqRepo.isAdminMember(eid)
  const rows = await reqRepo.getRequisitionForCompletePurchase(reqIdNum)
  if (!rows.length) return { error: 'Requisition not found or not finance approved', status: 404 }
  if (isProcurement) {
    await reqRepo.updatePurchaseCompleted(reqIdNum, eid)
    notifyCreatorAckRequired(reqIdNum).catch((e) => console.error('notifyCreatorAckRequired after completePurchase:', e?.message))
    const creatorC = await notifRepo.getRequisitionCreatorId(reqIdNum)
    if (creatorC) {
      notifSvc.notifySafe(notifSvc.notify({
        recipientEmployeeId: creatorC,
        type: 'requisition_ready_for_receipt',
        title: 'Purchase complete',
        body: 'Procurement marked your requisition complete. Follow acknowledgment steps in the portal.',
        url: '/requisition/acknowledgment',
        relatedEntityType: 'requisition',
        relatedEntityId: reqIdNum
      }))
    }
    return { message: 'Requisition marked complete. HOD can acknowledge receipt.', status: 'Completed - Pending HOD Acknowledgment' }
  }
  if (isAdmin) {
    const reqRow = await reqRepo.getRequisitionAndDepartment(reqIdNum)
    const categoryName = reqRow[0]?.req_category
    const cat = categoryName ? await reqRepo.getRequisitionCategoryByName(categoryName) : null
    if (cat && cat.execution_admin === 1) {
      await reqRepo.updatePurchaseCompleted(reqIdNum, eid)
      notifyCreatorAckRequired(reqIdNum).catch((e) => console.error('notifyCreatorAckRequired after completePurchase (Admin):', e?.message))
      const creatorA = await notifRepo.getRequisitionCreatorId(reqIdNum)
      if (creatorA) {
        notifSvc.notifySafe(notifSvc.notify({
          recipientEmployeeId: creatorA,
          type: 'requisition_ready_for_receipt',
          title: 'Purchase complete',
          body: 'Your requisition execution is complete. Please acknowledge in the portal.',
          url: '/requisition/acknowledgment',
          relatedEntityType: 'requisition',
          relatedEntityId: reqIdNum
        }))
      }
      return { message: 'Requisition marked complete (Admin execution). HOD can acknowledge receipt.', status: 'Completed - Pending HOD Acknowledgment' }
    }
  }
  return { error: 'Only Procurement or Admin (for execution-admin categories) can mark as complete.', status: 403 }
}

/** List requisitions completed by Procurement, pending HOD acknowledgment (same department as HOD). */
export async function getPendingHodAcknowledge(employeeId) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return { error: 'Valid employee ID is required', status: 400 }

  // Get ALL departments this employee is HOD of (handles multi-department HODs)
  const hodDepartments = await reqRepo.getHodDepartmentsForEmployee(eid)
  if (hodDepartments.length === 0) return []

  const allRows = []
  const seenReqIds = new Set()

  for (const dept of hodDepartments) {
    const deptId = dept.department_id
    const deptName = (dept.department_name || '').trim().toLowerCase()
    try {
      const rows = await reqRepo.getPendingHodAcknowledgeList(deptId, deptName)
      for (const r of rows || []) {
        if (r.req_id != null && !seenReqIds.has(r.req_id)) {
          seenReqIds.add(r.req_id)
          allRows.push(r)
        }
      }
    } catch (err) {
      if (err.code === '42703') continue
      throw err
    }
  }

  const reqIds = allRows.map(r => r.req_id)
  const items = reqIds.length ? await reqRepo.getItemsByReqIds(reqIds) : []
  return allRows.map(req => ({
    ...req,
    status: getRequisitionStatus(req),
    items: items.filter(i => i.req_id === req.req_id)
  }))
}

/** HOD/Committee/CEO: acknowledge receipt of completed purchase based on creator role. */
export async function acknowledgeReceipt(body) {
  const { requisitionId } = body
  const reqId = requisitionId != null ? parseInt(requisitionId, 10) : null
  const eid = await resolveApproverEmployeeId({ approvedByEmployeeId: body.acknowledgedByEmployeeId, approvedByEmployeeCode: body.acknowledgedByEmployeeCode })
  if (reqId == null || Number.isNaN(reqId) || eid == null) {
    return { error: 'Valid requisitionId and acknowledgedByEmployeeId or acknowledgedByEmployeeCode required', status: 400 }
  }
  const rows = await reqRepo.getRequisitionForHodAcknowledge(reqId)
  if (!rows.length) return { error: 'Requisition not found or not pending acknowledgment', status: 404 }
  
  const creatorDeptId = rows[0].department_id
  const creatorRole = rows[0].req_creator_role

  // Determine who can acknowledge based on creator role
  let canAcknowledge = false
  let errorMessage = 'You are not authorized to acknowledge this requisition'

  if (creatorRole === 'CEO') {
    // CEO must acknowledge
    const isCeo = await reqRepo.isCeoMember(eid)
    canAcknowledge = isCeo
    errorMessage = 'Only CEO can acknowledge requisitions created by CEO'
  } else if (creatorRole === 'Committee') {
    // Committee member must acknowledge
    const isCommittee = await reqRepo.isCommitteeMember(eid)
    canAcknowledge = isCommittee
    errorMessage = 'Only Committee members can acknowledge requisitions created by Committee'
  } else {
    // HOD or regular employee - HOD of creator's department must acknowledge
    const isHodOfCreatorDept = await reqRepo.isHodOfDepartment(eid, creatorDeptId)
    canAcknowledge = isHodOfCreatorDept
    errorMessage = 'Only HOD of the requester department can acknowledge receipt'
  }

  if (!canAcknowledge) return { error: errorMessage, status: 403 }
  
  await reqRepo.updateHodAcknowledged(reqId, eid)
  return { message: 'Receipt acknowledged', status: 'Completed' }
}

/** Total count of requisitions pending for this employee across all buckets (for dashboard toast). */
export async function getPendingCount(employeeId) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return { count: 0 }
  const f = (r) => (Array.isArray(r) ? r.length : 0)
  const [hod, hr, admin, committee, ceo, procurement, finance, hodAck, adminExec, creatorAck] = await Promise.all([
    getPendingHod(employeeId),
    getPendingHR(employeeId),
    getPendingAdmin(employeeId),
    getPendingCommittee(employeeId),
    getPendingCeo(employeeId),
    getPendingProcurement(employeeId),
    getPendingFinance(employeeId),
    getPendingHodAcknowledge(employeeId),
    getPendingAdminExecution(employeeId),
    getPendingCreatorAcknowledge(employeeId)
  ])
  const count = f(hod) + f(hr) + f(admin) + f(committee) + f(ceo) + f(procurement) + f(finance) + f(hodAck) + f(adminExec) + f(creatorAck)
  return { count }
}

/** Requisitions created by this employee where execution is done but creator has not acknowledged (close ticket). */
export async function getPendingCreatorAcknowledge(employeeId) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return { error: 'Valid employee ID is required', status: 400 }
  const rows = await reqRepo.getPendingCreatorAcknowledgeList(eid)
  const reqIds = rows.map(r => r.req_id)
  const items = reqIds.length ? await reqRepo.getItemsByReqIds(reqIds) : []
  const list = rows.map(req => ({
    ...req,
    status: 'Pending your acknowledgment',
    items: items.filter(i => i.req_id === req.req_id)
  }))
  return list
}

/** Creator (requester) acknowledges – closes the requisition ticket. */
export async function acknowledgeByCreator(body) {
  const { requisitionId } = body
  const reqId = requisitionId != null ? parseInt(requisitionId, 10) : null
  const eid = await resolveApproverEmployeeId({ approvedByEmployeeId: body.acknowledgedByEmployeeId, approvedByEmployeeCode: body.acknowledgedByEmployeeCode })
  if (reqId == null || Number.isNaN(reqId) || eid == null) {
    return { error: 'Valid requisitionId and acknowledgedByEmployeeId or acknowledgedByEmployeeCode required', status: 400 }
  }
  const rows = await reqRepo.getRequisitionForCreatorAcknowledge(reqId, eid)
  if (!rows.length) return { error: 'Requisition not found or you are not the creator or it is not ready for your acknowledgment', status: 404 }
  await reqRepo.updateCreatorAcknowledged(reqId)
  return { message: 'Requisition acknowledged and closed', status: 'Closed' }
}

export async function handoverFinance(body) {
  const { requisitionId } = body
  const reqId = requisitionId != null ? parseInt(requisitionId, 10) : null
  const eid = await resolveApproverEmployeeId({ approvedByEmployeeId: body.handedByEmployeeId, approvedByEmployeeCode: body.handedByEmployeeCode })
  if (reqId == null || Number.isNaN(reqId) || eid == null) {
    return { error: 'Valid requisitionId and handedByEmployeeId or handedByEmployeeCode are required', status: 400 }
  }
  const ok = await reqRepo.isProcurementMember(eid)
  if (!ok) return { error: 'Only Procurement can hand over to Finance', status: 403 }
  const rows = await reqRepo.getRequisitionForHandover(reqId)
  if (!rows.length) return { error: 'Requisition not found or not acknowledged', status: 404 }
  const r = rows[0]
  if (!r.req_quotation_1_url || !r.req_quotation_2_url || !r.req_quotation_3_url) {
    return { error: 'Add all 3 quotation images before handing over to Finance', status: 400 }
  }
  await reqRepo.handoverToFinance(reqId)
  await setCurrentStage(reqId, 'finance')
  await notifyBucketChanged(reqId, 'finance')
  const deptHandover = await reqRepo.getRequisitionAndDepartment(reqId)
  notifSvc.notifySafe(inAppNotifyRequisitionBucket(reqId, 'finance', deptHandover[0]?.department_id))
  return { message: 'Handed over to Finance', status: 'Pending Finance Approval' }
}

export async function getPendingFinance(employeeId) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return { error: 'Valid employee ID is required', status: 400 }
  const useFlow = (await reqRepo.getFlowStages()).length > 0
  // Check role: try flow stage check first, fallback to legacy Finance HOD check
  let ok = false
  if (useFlow) {
    ok = await reqRepo.isEmployeeTypeForStage(eid, 'finance')
    // Fallback to legacy check if flow stage check fails (e.g., no finance stage in table or designation mismatch)
    if (!ok) ok = await reqRepo.isFinanceHod(eid)
  } else {
    ok = await reqRepo.isFinanceHod(eid)
  }
  if (!ok) return []
  // Always filter by current stage key to show only Finance bucket requisitions
  const rows = await reqRepo.getPendingRequisitionsByCurrentStage('finance')
  const reqIds = rows.map(r => r.req_id)
  const items = reqIds.length ? await reqRepo.getItemsByReqIds(reqIds) : []
  const list = rows.map(req => ({
    ...req,
    status: 'Pending Finance Approval',
    items: items.filter(i => i.req_id === req.req_id)
  }))
  return list
}

export async function approveFinance(body) {
  const { requisitionId, approvedQuotationIndex, approved } = body
  const reqId = requisitionId != null ? parseInt(requisitionId, 10) : null
  const eid = await resolveApproverEmployeeId(body)
  if (reqId == null || Number.isNaN(reqId) || eid == null) {
    return { error: 'Valid requisitionId and approvedByEmployeeId or approvedByEmployeeCode are required', status: 400 }
  }
  // Check role: try flow stage check first (if stages exist), fallback to legacy Finance HOD check
  const useFlow = (await reqRepo.getFlowStages()).length > 0
  let ok = false
  if (useFlow) {
    ok = await reqRepo.isEmployeeTypeForStage(eid, 'finance')
    if (!ok) ok = await reqRepo.isFinanceHod(eid)
  } else {
    ok = await reqRepo.isFinanceHod(eid)
  }
  if (!ok) return { error: 'Only Finance HOD can approve', status: 403 }
  const rows = await reqRepo.getRequisitionForFinanceApproval(reqId)
  if (!rows.length) return { error: 'Requisition not found or not pending finance approval', status: 404 }

  if (approved === false) {
    const reason = body.rejectionReason != null ? String(body.rejectionReason).trim() : ''
    if (!reason) return { error: 'Rejection reason is required. Please state why this requisition is being rejected.', status: 400 }
    const creatorId = await notifRepo.getRequisitionCreatorId(reqId)
    await rejectWithReason(reqId, reason, eid, 'finance')
    if (creatorId) {
      notifSvc.notifySafe(notifSvc.notify({
        recipientEmployeeId: creatorId,
        type: 'requisition_rejected',
        title: 'Requisition rejected by Finance',
        body: `Your requisition was rejected by Finance. Reason: ${reason}`,
        url: '/requisition/history',
        relatedEntityType: 'requisition',
        relatedEntityId: reqId
      }))
    }
    return { message: 'Requisition rejected', status: 'Rejected' }
  }
  // Loan & Advance Salary (direct from HR/CEO): no quotations, use default index 1
  const isLoan = isCategoryHrAfterHod(rows[0]?.req_category)
  const idx = (approvedQuotationIndex != null && [1, 2, 3].includes(parseInt(approvedQuotationIndex, 10)))
    ? parseInt(approvedQuotationIndex, 10)
    : (isLoan ? 1 : null)
  if (idx !== 1 && idx !== 2 && idx !== 3) {
    return { error: 'approvedQuotationIndex must be 1, 2, or 3 (for requisitions with quotations)', status: 400 }
  }
  await reqRepo.approveFinance(reqId, eid, idx)
  try {
    const stages = await reqRepo.getFlowStages()
    if (stages && stages.length > 0) await reqRepo.setRequisitionCurrentStage(reqId, null)
  } catch (_) {}
  const deptFin = await reqRepo.getRequisitionAndDepartment(reqId)
  if (isLoan) {
    notifyCreatorAckRequired(reqId).catch((e) => console.error('notifyCreatorAckRequired after Finance (Loan):', e?.message))
    const cid = await notifRepo.getRequisitionCreatorId(reqId)
    if (cid) {
      notifSvc.notifySafe(notifSvc.notify({
        recipientEmployeeId: cid,
        type: 'requisition_finance_approved',
        title: 'Finance approved',
        body: 'Your requisition was approved by Finance. Please acknowledge when ready.',
        url: '/requisition/acknowledgment',
        relatedEntityType: 'requisition',
        relatedEntityId: reqId
      }))
    }
  } else {
    await notifyBucketChanged(reqId, 'procurement')
    notifSvc.notifySafe(inAppNotifyRequisitionBucket(reqId, 'procurement', deptFin[0]?.department_id))
  }
  return { message: isLoan ? 'Finance approved (Loan).' : 'Finance approved; quotation selected. Forwarded to Procurement for purchase.', status: isLoan ? 'Completed' : 'Finance Approved - Ready for Purchase' }
}

export async function getTatReport(query) {
  const from = query.from
  const to = query.to
  const referenceNo = query.referenceNo ? String(query.referenceNo).trim() : ''
  const creatorName = query.creatorName ? String(query.creatorName).trim() : ''
  const status = query.status ? String(query.status).trim() : ''
  const page = Math.max(1, parseInt(query.page, 10) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20))
  const offset = (page - 1) * limit

  const params = []
  let whereClause = 'WHERE 1=1'
  if (from) {
    params.push(from)
    whereClause += ` AND r.req_created_at >= $${params.length}::date`
  }
  if (to) {
    params.push(to)
    whereClause += ` AND r.req_created_at <= $${params.length}::date + interval '1 day'`
  }
  if (referenceNo) {
    params.push('%' + referenceNo + '%')
    whereClause += ` AND r.req_reference_no ILIKE $${params.length}`
  }
  if (creatorName) {
    params.push('%' + creatorName + '%')
    whereClause += ` AND (e.first_name || ' ' || e.last_name) ILIKE $${params.length}`
  }
  const statusSql = tatReportStatusCondition(status)
  if (statusSql) whereClause += statusSql

  const total = await reqRepo.getTatReportCount(whereClause, params)
  let rows
  try {
    rows = await reqRepo.getTatReportData(whereClause, params, limit, offset)
  } catch (err) {
    if (err.code === '42703') rows = await reqRepo.getTatReportDataFallback(whereClause, params, limit, offset)
    else throw err
  }
  const stages = await reqRepo.getFlowStages()
  const categories = [...new Set(rows.map((r) => r.req_category).filter(Boolean))]
  const behaviorByCategory = new Map()
  for (const cat of categories) {
    const m = await reqRepo.getCategoryStageBehaviorMap(cat)
    if (m) behaviorByCategory.set(String(cat).trim().toLowerCase(), m)
  }

  // Fetch all items for these requisitions in bulk (for CEO skip rule)
  const reqIds = rows.map((r) => r.req_id)
  let allItems = []
  if (reqIds.length > 0) {
    allItems = await reqRepo.getRequisitionItemsByReqIds(reqIds)
  }
  const itemsByReqId = new Map()
  for (const it of allItems) {
    const list = itemsByReqId.get(it.req_id) || []
    list.push(it)
    itemsByReqId.set(it.req_id, list)
  }

  const data = rows.map((row) => {
    // Attach items to row for CEO skip calculation
    row.items = itemsByReqId.get(row.req_id) || []
    const bm = row.req_category ? behaviorByCategory.get(String(row.req_category).trim().toLowerCase()) : null
    const { totalHours } =
      stages?.length && bm
        ? buildTatFromRequisition(row, stages, bm)
        : getTATFromRequisition(row)
    const creatorNameVal = `${row.first_name || ''} ${row.last_name || ''}`.trim() || '—'
    return {
      requisitionId: row.req_id,
      referenceNo: row.req_reference_no || '#' + row.req_id,
      creatorName: creatorNameVal,
      totalHours,
      totalTimeFormatted: formatTotalTime(totalHours),
      status: row.req_is_rejected === 1 ? 'Rejected' : getRequisitionStatus(row),
      createdAt: row.req_created_at
    }
  })
  return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 } }
}

export async function getTat(reqId) {
  let rows
  try {
    rows = await reqRepo.getRequisitionRowForTat(reqId)
  } catch (err) {
    if (err.code === '42703') rows = await reqRepo.getRequisitionRowForTatFallback(reqId)
    else throw err
  }
  if (!rows.length) return { error: 'Requisition not found', status: 404 }
  const row = rows[0]

  // Fetch items for CEO skip rule calculation
  const items = await reqRepo.getRequisitionItems(reqId)
  row.items = items || []

  const stages = await reqRepo.getFlowStages()
  const behaviorMap = row.req_category ? await reqRepo.getCategoryStageBehaviorMap(row.req_category) : null
  const { buckets, totalHours } =
    stages?.length && behaviorMap
      ? buildTatFromRequisition(row, stages, behaviorMap)
      : getTATFromRequisition(row)
  return {
    requisitionId: row.req_id,
    referenceNo: row.req_reference_no,
    status: row.req_is_rejected === 1 ? 'Rejected' : getRequisitionStatus(row),
    totalHours,
    buckets,
    purchaseCompletedDate: row.req_purchase_completed_date || null,
    hodAcknowledgedDate: row.req_hod_acknowledged_date || null
  }
}

export async function getById(reqId) {
  const rows = await reqRepo.getRequisitionById(reqId)
  if (!rows.length) return { error: 'Requisition not found', status: 404 }
  const reqRow = rows[0]
  const [items, comments] = await Promise.all([
    reqRepo.getRequisitionItems(reqId),
    reqRepo.getRequisitionComments(reqId)
  ])

  let rejectionStage = null
  if (reqRow.req_is_rejected === 1) {
    const rejectionComment = (comments || []).find(c => c.comment_text && c.comment_text.startsWith('[Rejection reason]'))
    rejectionStage = rejectionComment?.stage_key || null
  }

  return {
    ...reqRow,
    requiredByDate: reqRow.req_required_by_date || null,
    status: getRequisitionStatus(reqRow),
    rejection_stage: rejectionStage,
    items: items.map(i => ({
      item_id: i.item_id,
      req_id: i.req_id,
      item_desc: i.item_desc,
      item_size: i.item_size,
      item_brand: i.item_brand,
      item_qty: i.item_qty,
      item_est_cost: i.item_est_cost,
      item_remarks: i.item_remarks
    }))
  }
}

/** Toggle hidden status of a requisition (soft delete/restore). Only SuperAdmin can hide/show. */
export async function toggleRequisitionHiddenService(reqId, isHidden, actorEmployeeId) {
  if (!reqId) throw new Error('Requisition ID is required')
  if (actorEmployeeId == null) throw new Error('Employee ID is required')

  const isSuperAdmin = await reqRepo.employeeHasPermission(actorEmployeeId, 'can_hide_requisitions')
    || await reqRepo.isSuperAdmin(actorEmployeeId)

  if (!isSuperAdmin) {
    throw new Error('Only SuperAdmin can hide/unhide requisitions')
  }

  const result = await reqRepo.toggleRequisitionHidden(reqId, isHidden)
  if (!result || result.length === 0) {
    throw new Error('Requisition not found')
  }
  return { reqId, isHidden: result[0].is_hidden }
}

export async function getTrackRecords(query = {}, includeHidden = false) {
  const page = Math.max(1, parseInt(query.page || query.pageNumber || 1, 10))
  const limit = Math.max(1, Math.min(100, parseInt(query.limit || query.pageSize || 20, 10)))
  const offset = (page - 1) * limit

  const [countRows, rows] = await Promise.all([
    reqRepo.getTrackRecordsCount(includeHidden),
    reqRepo.getTrackRecordsAll(limit, offset, includeHidden)
  ])

  const total = parseInt(countRows?.[0]?.total ?? 0, 10)
  const data = await attachItemsToRequisitions(rows || [])

  return {
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 }
  }
}
