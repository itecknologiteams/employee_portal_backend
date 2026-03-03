import { getQueue, isBullMQEnabled } from '../../config/bullmq.js'
import { sendRequisitionReminder, isEmailConfigured } from '../../config/email.js'
import { notifyCreatorAckRequired } from '../../jobs/requisition-emailer.js'
import { buildRequisitionEmailHtml, buildRequisitionEmailPlainText } from '../../config/requisition-email-template.js'
import * as reqRepo from '../repositories/requisition.repository.js'
import {
  getRequisitionStatus,
  getPendingAt,
  parseEmployeeId,
  getTATFromRequisition,
  formatTotalTime,
  tatReportStatusCondition
} from '../utils/requisition.utils.js'

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
          execution_procurement: r.execution_procurement === 1
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

/** Set req_current_stage_key when DB-driven flow is enabled. stageKey: string = set as-is; null + categoryName = first stage for category. */
async function setCurrentStageIfFlowEnabled(reqId, stageKey, categoryNameForFirst) {
  try {
    const stages = await reqRepo.getFlowStages()
    if (!stages || stages.length === 0) return
    let key = stageKey
    if (key == null && categoryNameForFirst) {
      key = await reqRepo.getFirstStageKey(categoryNameForFirst)
    }
    if (key == null) key = stages[0]?.stage_key || 'hod'
    await reqRepo.setRequisitionCurrentStage(reqId, key)
  } catch (_) {
    /* flow tables may not exist */
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

export async function getTrackRecords(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20))
  const offset = (page - 1) * limit
  const total = await reqRepo.getTrackRecordsCount()
  const totalPages = Math.max(1, Math.ceil(total / limit))
  const rows = await reqRepo.getTrackRecordsAll(limit, offset)
  const reqIds = rows.map(r => r.req_id)
  const itemCounts = reqIds.length ? await reqRepo.getItemCountsByReqIds(reqIds) : []
  const countByReq = Object.fromEntries((itemCounts || []).map(c => [c.req_id, parseInt(c.cnt, 10)]))
  const data = rows.map(req => {
    const status = getRequisitionStatus(req)
    return {
      requisitionId: req.req_id,
      referenceNo: req.req_reference_no,
      employeeId: req.req_emp_id,
      creatorName: [req.first_name, req.last_name].filter(Boolean).join(' ').trim() || null,
      creatorEmail: req.email || null,
      departmentName: req.department_name || null,
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

export async function createRequisition(body) {
  const { employeeId, location, material, requiredByDate, business, items, category } = body
  if (!employeeId || !items || !Array.isArray(items) || items.length === 0) {
    return { error: 'employeeId and at least one item are required', status: 400 }
  }
  const validItems = items.filter(it => {
    const qty = it.itemQty ?? it.item_qty ?? 0
    const hasData = (it.itemDesc && it.itemDesc.trim()) || (it.item_desc && String(it.item_desc).trim()) ||
      (it.itemSize && it.itemSize.trim()) || (it.item_size && String(it.item_size).trim()) ||
      (it.itemBrand && it.itemBrand.trim()) || (it.item_brand && String(it.item_brand).trim()) ||
      (Number(qty) > 0)
    return hasData
  })
  if (validItems.length === 0) {
    return { error: 'Each item must have at least size, brand, or quantity', status: 400 }
  }
  if (!category || typeof category !== 'string' || !category.trim()) {
    return { error: 'Category is required', status: 400 }
  }
  const categoryTrimmed = category.trim()
  let allowedCategories = REQUISITION_CATEGORIES
  try {
    const { categories } = await getCategories()
    if (Array.isArray(categories) && categories.length > 0) allowedCategories = categories
  } catch (_) {}
  if (!allowedCategories.includes(categoryTrimmed)) {
    return { error: `Category must be one of: ${allowedCategories.join(', ')}`, status: 400 }
  }

  const deptId = await reqRepo.getCreatorDepartment(employeeId)
  const hodId = await reqRepo.getHodByDepartment(deptId)
  const creatorIsHod = hodId != null && hodId === parseInt(employeeId, 10)
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

  const created = await reqRepo.createRequisition(employeeId, location, material, requiredByDate, business, creatorRole, categoryTrimmed)
  const reqId = created.req_id
  const refNo = created.req_reference_no

  if (validItems.length > 0) {
    await reqRepo.insertRequisitionItemsBatch(reqId, validItems)
  }

  // Category-based flow: if category has HOD "For Info" only (no approval), auto-advance past HOD to next real stage (1.csv)
  let categoryFlowBucket = null
  try {
    const cat = await reqRepo.getRequisitionCategoryByName(categoryTrimmed)
    if (cat && cat.hod_for_info === 1 && cat.hod_approval === 0 && !creatorIsHod && !creatorIsCommittee && !creatorIsCeo) {
      await reqRepo.setHodApprovalForInfoOnly(reqId)
      // Use DB-driven next stage after HOD (e.g. Stationary → procurement, Vehicle Repair → committee)
      categoryFlowBucket = await reqRepo.getNextStageKey(categoryTrimmed, 'hod') || 'committee'
    }
  } catch (_) {
    /* requisition_category table may not exist yet */
  }

  // Auto-advance based on creator role
  if (creatorIsCeo) {
    await reqRepo.autoAdvanceCeoRequisition(reqId)
    await setCurrentStageIfFlowEnabled(reqId, 'procurement')
    await notifyBucketChanged(reqId, 'procurement')
  } else if (creatorIsCommittee) {
    await reqRepo.autoAdvanceCommitteeRequisition(reqId)
    await setCurrentStageIfFlowEnabled(reqId, 'ceo')
    await notifyBucketChanged(reqId, 'ceo')
  } else if (creatorIsHod) {
    await reqRepo.autoAdvanceHodRequisition(reqId)
    await setCurrentStageIfFlowEnabled(reqId, 'committee')
    await notifyBucketChanged(reqId, 'committee')
  } else if (categoryFlowBucket) {
    await setCurrentStageIfFlowEnabled(reqId, categoryFlowBucket)
    await notifyBucketChanged(reqId, categoryFlowBucket)
  } else {
    await setCurrentStageIfFlowEnabled(reqId, null, categoryTrimmed)
  }

  try {
    const creator = await reqRepo.getCreatorForQueue(employeeId)
    const creatorName = creator ? `${creator.first_name || ''} ${creator.last_name || ''}`.trim() : 'Employee'
    const requiredByStr = requiredByDate ? new Date(requiredByDate).toLocaleDateString() : 'Not set'
    const departmentId = creator?.department_id ?? null
    const departmentName = creator?.department_name || ''
    const hodEmails = departmentId != null ? await reqRepo.getHodEmailsForDepartment(departmentId) : []
    const creatorDescription = (material || '').trim() || ''
    if (hodEmails.length > 0 && isEmailConfigured()) {
      let items = []
      try {
        items = await reqRepo.getRequisitionItems(reqId) || []
      } catch (_) {}
      const html = buildRequisitionEmailHtml({
        title: 'New requisition',
        refNo,
        creatorName,
        requiredBy: requiredByStr,
        departmentName,
        bucketLabel: 'Pending HOD',
        creatorDescription,
        items
      })
      const subject = `New requisition ${refNo} – pending your approval`
      const bodyText = buildRequisitionEmailPlainText({ refNo, creatorName, requiredBy: requiredByStr, departmentName, bucketLabel: 'Pending HOD', creatorDescription, items })
      await sendRequisitionReminder({ to: hodEmails.join(','), subject, body: bodyText, html })
    }
    if (isBullMQEnabled()) {
      const q = getQueue()
      const payload = {
        event: 'requisition.created',
        requisitionId: reqId,
        referenceNo: refNo,
        employeeId: parseInt(employeeId, 10),
        creatorName,
        creatorDescription,
        creatorEmail: process.env.TEST_REMINDER_EMAIL || creator?.email || null,
        departmentId,
        departmentName: creator?.department_name ?? null,
        itemCount: validItems.length,
        requiredByDate: requiredByDate || null,
        createdAt: new Date().toISOString()
      }
      await q.add('requisition-created', payload)
    }
  } catch (publishErr) {
    console.error('Requisition created but notify/add job failed:', publishErr.message)
  }

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
  const [waiting, completed] = await Promise.all([
    q.getJobs(['waiting'], 0, 9),
    q.getJobs(['completed'], 0, 9)
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
    recentCompleted: completed.map(j => ({ id: j.id, name: j.name, data: j.data, finishedOn: j.finishedOn }))
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
  const youAreHod = deptId != null && (await reqRepo.getHodByDepartment(deptId)) === eid
  const [isCommittee, isCeo] = await Promise.all([
    reqRepo.isCommitteeMember(eid),
    reqRepo.isCeoMember(eid)
  ])
  const canView = youAreHod || isCommittee || isCeo
  if (!canView) return []

  const hodOnlyFilter = youAreHod && !isCommittee && !isCeo
  const rows = hodOnlyFilter
    ? await reqRepo.getReportAllRequisitionsHod(deptId, deptNameLower)
    : await reqRepo.getReportAllRequisitions()
  const reqIds = rows.map(r => r.req_id)
  const items = reqIds.length ? await reqRepo.getItemsByReqIds(reqIds) : []
  return rows.map(req => ({
    ...req,
    status: getRequisitionStatus(req),
    items: items.filter(i => i.req_id === req.req_id)
  }))
}

export async function getPendingHod(employeeId) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return { error: 'Valid employee ID is required', status: 400 }
  const emp = await reqRepo.getEmployeeDept(employeeId)
  if (!emp) return { error: 'Employee not found', status: 404 }
  const deptId = emp.department_id
  const deptName = (emp.department_name || '').trim().toLowerCase()
  if (deptId == null && !deptName) return []
  const hodId = await reqRepo.getHodByDepartment(deptId)
  if (hodId == null || hodId !== eid) return []

  let rows
  try {
    const flowStages = await reqRepo.getFlowStages()
    if (flowStages && flowStages.length > 0) {
      const byStage = await reqRepo.getPendingRequisitionsByCurrentStage('hod', { departmentId: deptId, departmentName: deptName, excludeEmployeeId: eid })
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
    } else {
      rows = await reqRepo.getPendingHodRequisitions(deptId, deptName, eid)
    }
  } catch (err) {
    if (err.code === '42703') rows = await reqRepo.getPendingHodRequisitionsFallback(deptId, deptName, eid)
    else throw err
  }
  const reqIds = rows.map(r => r.req_id)
  const items = reqIds.length ? await reqRepo.getItemsByReqIds(reqIds) : []
  return rows.map(req => ({ ...req, status: getRequisitionStatus(req), items: items.filter(i => i.req_id === req.req_id) }))
}

export async function getApprovedByHod(employeeId) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return { error: 'Valid employee ID is required', status: 400 }
  const emp = await reqRepo.getEmployeeDept(employeeId)
  if (!emp) return { error: 'Employee not found', status: 404 }
  const deptId = emp.department_id
  const deptName = (emp.department_name || '').trim().toLowerCase()
  if (deptId == null && !deptName) return []
  const hodId = await reqRepo.getHodByDepartment(deptId)
  if (hodId == null || hodId !== eid) return []

  const rows = await reqRepo.getApprovedByHodRequisitions(deptId, deptName)
  const reqIds = rows.map(r => r.req_id)
  const items = reqIds.length ? await reqRepo.getItemsByReqIds(reqIds) : []
  return rows.map(req => ({ ...req, status: getRequisitionStatus(req), items: items.filter(i => i.req_id === req.req_id) }))
}

export async function approveHod(body) {
  const boqItemsRaw = body.boqItems ?? body.boq_items
  const boqItems = Array.isArray(boqItemsRaw) ? boqItemsRaw : []
  const { requisitionId, approvedByEmployeeId, approved } = body
  if (!requisitionId || approvedByEmployeeId == null) {
    return { error: 'requisitionId and approvedByEmployeeId required', status: 400 }
  }
  const reqRow = await reqRepo.getRequisitionAndDepartment(requisitionId)
  if (!reqRow.length) return { error: 'Requisition not found', status: 404 }
  const hodId = await reqRepo.getHodByDepartment(reqRow[0].department_id)
  if (hodId !== parseInt(approvedByEmployeeId, 10)) {
    return { error: 'Only HOD of the same department can approve', status: 403 }
  }
  if (approved === false) {
    await reqRepo.rejectRequisition(requisitionId)
    return { message: 'Requisition rejected', status: 'Rejected' }
  }

  // Category from DB or from request body (fallback for old reqs or when column missing)
  const categoryName = reqRow[0]?.req_category ?? body.req_category ?? null
  const noBoqCategory = isCategoryNoBoq(categoryName)

  // For no-BOQ categories (Loan, Event, Vehicle Maintenance, etc.): approve without BOQ, advance by flow only
  if (noBoqCategory) {
    await reqRepo.approveHod(requisitionId)
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
    await setCurrentStageIfFlowEnabled(requisitionId, nextKey)
    const bucket = nextKey === 'hr' ? 'hr' : (nextKey === 'committee' ? 'committee' : nextKey)
    await notifyBucketChanged(requisitionId, bucket)
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

  const LIMIT_50K = 50000
  const LIMIT_100K = 100000
  let totalAmount = 0

  if (boqItems.length > 0) {
    // Route purely from request BOQ: total = sum(quantity * price per piece) from payload only.
    const boqByItemId = new Map()
    for (const row of boqItems) {
      const itemId = (row.itemId ?? row.item_id) != null ? parseInt(row.itemId ?? row.item_id, 10) : null
      if (itemId == null || Number.isNaN(itemId)) continue
      const qtyRaw = row.quantity
      const qty = (qtyRaw != null && qtyRaw !== '') ? parseInt(qtyRaw, 10) : 0
      const costVal = row.estCost ?? row.est_cost ?? ''
      const costStr = costVal != null ? String(costVal).trim() : ''
      const pricePerPiece = costStr !== '' ? parseFloat(String(costStr).replace(/,/g, '')) : NaN
      if (Number.isNaN(pricePerPiece) || pricePerPiece < 0) {
        return { error: 'Every item must have a price per piece (PKR). Please fill price per piece for all items in the BOQ.', status: 400 }
      }
      if (Number.isNaN(qty) || qty < 0) {
        return { error: 'Every item must have a valid quantity.', status: 400 }
      }
      boqByItemId.set(itemId, { qty, pricePerPiece })
      totalAmount += qty * pricePerPiece
    }
    const covered = items.every(it => {
      const id = it.item_id ?? it.itemId
      return id != null && boqByItemId.has(Number(id))
    })
    if (!covered || boqByItemId.size === 0) {
      return { error: 'BOQ (quantity and price per piece) is required for every item. Please fill all items and submit again.', status: 400 }
    }
    totalAmount = Math.round(Number(totalAmount))
  } else {
    const boqByItemId = new Map()
    for (const it of items) {
      const itemId = it.item_id ?? it.itemId
      const qty = (it.item_qty != null && !Number.isNaN(Number(it.item_qty))) ? Number(it.item_qty) : (it.hod_item_qty != null ? Number(it.hod_item_qty) : 0)
      const costRaw = it.item_est_cost ?? it.hod_item_est_cost ?? ''
      const pricePerPiece = (costRaw != null && String(costRaw).trim() !== '')
        ? parseFloat(String(costRaw).replace(/,/g, '').trim()) : NaN
      if (Number.isNaN(pricePerPiece) || pricePerPiece < 0) {
        return { error: 'Every item must have a price per piece (PKR). Please fill price per piece for all items in the BOQ.', status: 400 }
      }
      if (qty < 0 || Number.isNaN(qty)) {
        return { error: 'Every item must have a valid quantity.', status: 400 }
      }
      totalAmount += qty * pricePerPiece
    }
    totalAmount = Math.round(Number(totalAmount))
  }

  if (totalAmount < LIMIT_50K) {
    await reqRepo.approveHodDirectToProcurement(requisitionId)
    await setCurrentStageIfFlowEnabled(requisitionId, 'procurement')
    await notifyBucketChanged(requisitionId, 'procurement')
    return { message: 'HOD approval recorded; forwarded to Procurement (total under 50K)', status: 'Forwarded to Procurement' }
  }

  await reqRepo.approveHod(requisitionId)
  const nextKey = categoryName ? await reqRepo.getNextStageKey(categoryName, 'hod') : null
  await setCurrentStageIfFlowEnabled(requisitionId, nextKey || 'committee')
  const bucket = nextKey === 'hr' ? 'hr' : 'committee'
  await notifyBucketChanged(requisitionId, bucket)
  return { message: 'HOD approval recorded', status: nextKey === 'hr' ? 'Pending HR' : (totalAmount < LIMIT_100K ? 'Pending Committee' : 'Pending Committee (then CEO if ≥100K)') }
}

export async function getPendingHR(employeeId) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return { error: 'Valid employee ID is required', status: 400 }
  const useFlow = (await reqRepo.getFlowStages()).length > 0
  const ok = useFlow ? await reqRepo.isEmployeeTypeForStage(eid, 'hr') : await reqRepo.isHrMember(eid)
  if (!ok) return []
  const rows = useFlow
    ? await reqRepo.getPendingRequisitionsByCurrentStage('hr')
    : []
  const reqIds = rows.map(r => r.req_id)
  const items = reqIds.length ? await reqRepo.getItemsByReqIds(reqIds) : []
  return rows.map(req => ({ ...req, status: 'Pending HR', items: items.filter(i => i.req_id === req.req_id) }))
}

export async function getPendingAdmin(employeeId) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return { error: 'Valid employee ID is required', status: 400 }
  const useFlow = (await reqRepo.getFlowStages()).length > 0
  const ok = useFlow ? await reqRepo.isEmployeeTypeForStage(eid, 'admin') : await reqRepo.isAdminMember(eid)
  if (!ok) return []
  const rows = useFlow
    ? await reqRepo.getPendingRequisitionsByCurrentStage('admin')
    : []
  const reqIds = rows.map(r => r.req_id)
  const items = reqIds.length ? await reqRepo.getItemsByReqIds(reqIds) : []
  return rows.map(req => ({ ...req, status: 'Pending Admin', items: items.filter(i => i.req_id === req.req_id) }))
}

export async function getPendingCommittee(employeeId) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return { error: 'Valid employee ID is required', status: 400 }
  const useFlow = (await reqRepo.getFlowStages()).length > 0
  const ok = useFlow ? await reqRepo.isEmployeeTypeForStage(eid, 'committee') : await reqRepo.isCommitteeMember(eid)
  if (!ok) return []
  let rows = useFlow
    ? await reqRepo.getPendingRequisitionsByCurrentStage('committee')
    : await reqRepo.getPendingCommitteeRequisitions(eid)
  // Exclude any reqs that are in HR bucket (e.g. Loan & Advance Salary) – must not show in Committee list
  rows = (rows || []).filter((r) => r.req_current_stage_key !== 'hr')
  const reqIds = rows.map(r => r.req_id)
  const items = reqIds.length ? await reqRepo.getItemsByReqIds(reqIds) : []
  return rows.map(req => ({ ...req, status: 'Pending Committee', items: items.filter(i => i.req_id === req.req_id) }))
}

export async function approveHR(body) {
  const { requisitionId, approvedByEmployeeId, approved } = body
  const reqId = requisitionId != null ? parseInt(requisitionId, 10) : null
  const eid = parseEmployeeId(approvedByEmployeeId != null ? String(approvedByEmployeeId) : null)
  if (reqId == null || Number.isNaN(reqId) || eid == null) {
    return { error: 'Valid requisitionId and approvedByEmployeeId are required', status: 400 }
  }
  const useFlow = (await reqRepo.getFlowStages()).length > 0
  const ok = useFlow ? await reqRepo.isEmployeeTypeForStage(eid, 'hr') : await reqRepo.isHrMember(eid)
  if (!ok) {
    return { error: 'Only HR can approve this stage. Check your Employee Type or Designation.', status: 403 }
  }
  if (approved === false) {
    await reqRepo.rejectRequisition(reqId)
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
  await setCurrentStageIfFlowEnabled(reqId, nextKey || 'committee')
  await notifyBucketChanged(reqId, nextKey || 'committee')
  return { message: 'HR approval recorded', status: nextKey === 'ceo' ? 'Pending CEO' : (nextKey === 'finance' ? 'Pending Finance' : (nextKey === 'committee' ? 'Pending Committee' : `Pending ${nextKey}`)) }
}

export async function approveCommittee(body) {
  const { requisitionId, approvedByEmployeeId, approved, approvedQuantities } = body
  const reqId = requisitionId != null ? parseInt(requisitionId, 10) : null
  const eid = parseEmployeeId(approvedByEmployeeId != null ? String(approvedByEmployeeId) : null)
  if (reqId == null || Number.isNaN(reqId) || eid == null) {
    return { error: 'Valid requisitionId and approvedByEmployeeId are required', status: 400 }
  }
  const ok = await reqRepo.isCommitteeMember(eid)
  if (!ok) {
    return { error: 'Only Committee members can approve. Check your Employee Type or Designation in Administration.', status: 403 }
  }
  if (approved === false) {
    await reqRepo.rejectRequisition(reqId)
    return { message: 'Requisition rejected', status: 'Rejected' }
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

  // CEO approval is required only when total (after committee-approved qty) is greater than 100K; if total <= 100K skip CEO and forward to Procurement.
  const LIMIT_100K = 100000
  const itemsAfter = await reqRepo.getRequisitionItems(reqId)
  let totalAfterCommittee = 0
  for (const it of itemsAfter) {
    const qtyRaw = it.committee_approved_qty ?? it.committeeApprovedQty
    const qty = (qtyRaw != null && !Number.isNaN(Number(qtyRaw))) ? Number(qtyRaw) : 0
    const costRaw = it.item_est_cost ?? it.hod_item_est_cost ?? it.itemEstCost ?? ''
    const pricePerPiece = (costRaw != null && String(costRaw).trim() !== '')
      ? parseFloat(String(costRaw).replace(/,/g, '').trim()) : NaN
    if (!Number.isNaN(pricePerPiece) && pricePerPiece >= 0) totalAfterCommittee += qty * pricePerPiece
  }
  totalAfterCommittee = Math.round(totalAfterCommittee)
  if (totalAfterCommittee <= LIMIT_100K) {
    await reqRepo.approveCeo(reqId)
    await setCurrentStageIfFlowEnabled(reqId, 'procurement')
    await notifyBucketChanged(reqId, 'procurement')
    return { message: 'Committee approval recorded; forwarded to Procurement (total 100K or under)', status: 'Forwarded to Procurement' }
  }

  const reqRow = await reqRepo.getRequisitionAndDepartment(reqId)
  const categoryName = reqRow[0]?.req_category
  const nextKey = categoryName ? await reqRepo.getNextStageKey(categoryName, 'committee') : 'ceo'
  await setCurrentStageIfFlowEnabled(reqId, nextKey || 'ceo')
  await notifyBucketChanged(reqId, 'ceo')
  return { message: 'Committee approval recorded', status: 'Pending CEO' }
}

export async function getPendingCeo(employeeId) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return { error: 'Valid employee ID is required', status: 400 }
  const useFlow = (await reqRepo.getFlowStages()).length > 0
  const ok = useFlow ? await reqRepo.isEmployeeTypeForStage(eid, 'ceo') : await reqRepo.isCeoMember(eid)
  if (!ok) return []
  const rows = useFlow
    ? await reqRepo.getPendingRequisitionsByCurrentStage('ceo')
    : await reqRepo.getPendingCeoRequisitions()
  const reqIds = rows.map(r => r.req_id)
  const items = reqIds.length ? await reqRepo.getItemsByReqIds(reqIds) : []
  return rows.map(req => ({ ...req, status: 'Pending CEO', items: items.filter(i => i.req_id === req.req_id) }))
}

export async function approveCeo(body) {
  const { requisitionId, approvedByEmployeeId, approved } = body
  const reqId = requisitionId != null ? parseInt(requisitionId, 10) : null
  const eid = parseEmployeeId(approvedByEmployeeId != null ? String(approvedByEmployeeId) : null)
  if (reqId == null || Number.isNaN(reqId) || eid == null) {
    return { error: 'Valid requisitionId and approvedByEmployeeId are required', status: 400 }
  }
  const ok = await reqRepo.isCeoMember(eid)
  if (!ok) {
    return { error: 'Only CEO can approve. Check your Employee Type or Designation in Administration.', status: 403 }
  }
  if (approved === false) {
    await reqRepo.rejectRequisition(reqId)
    return { message: 'Requisition rejected', status: 'Rejected' }
  }
  await reqRepo.approveCeo(reqId)
  const reqRow = await reqRepo.getRequisitionAndDepartment(reqId)
  const categoryName = reqRow[0]?.req_category
  // Loan & Advance Salary: after CEO go to Finance (not Procurement)
  const nextKey = isCategoryHrAfterHod(categoryName) ? 'finance' : 'procurement'
  await setCurrentStageIfFlowEnabled(reqId, nextKey)
  await notifyBucketChanged(reqId, nextKey)
  return { message: 'CEO approval recorded', status: nextKey === 'finance' ? 'Pending Finance' : 'Forwarded to Procurement' }
}

export async function approveAdmin(body) {
  const { requisitionId, approvedByEmployeeId, approved } = body
  const reqId = requisitionId != null ? parseInt(requisitionId, 10) : null
  const eid = parseEmployeeId(approvedByEmployeeId != null ? String(approvedByEmployeeId) : null)
  if (reqId == null || Number.isNaN(reqId) || eid == null) {
    return { error: 'Valid requisitionId and approvedByEmployeeId are required', status: 400 }
  }
  const useFlow = (await reqRepo.getFlowStages()).length > 0
  const ok = useFlow ? await reqRepo.isEmployeeTypeForStage(eid, 'admin') : await reqRepo.isAdminMember(eid)
  if (!ok) {
    return { error: 'Only Admin can approve this stage.', status: 403 }
  }
  if (approved === false) {
    await reqRepo.rejectRequisition(reqId)
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
  let rows
  try {
    rows = useFlow
      ? await reqRepo.getPendingRequisitionsByCurrentStage('procurement')
      : await reqRepo.getPendingProcurementRequisitions()
  } catch (err) {
    if (err.code === '42703') {
      rows = await reqRepo.getPendingProcurementRequisitionsFallback()
    } else throw err
  }
  const reqIds = rows.map(r => r.req_id)
  const items = reqIds.length ? await reqRepo.getItemsByReqIds(reqIds) : []
  return rows.map(req => ({ ...req, status: getRequisitionStatus(req), items: items.filter(i => i.req_id === req.req_id) }))
}

export async function acknowledgeProcurement(body) {
  const { requisitionId, acknowledgedByEmployeeId } = body
  const reqId = requisitionId != null ? parseInt(requisitionId, 10) : null
  const eid = parseEmployeeId(acknowledgedByEmployeeId != null ? String(acknowledgedByEmployeeId) : null)
  if (reqId == null || Number.isNaN(reqId) || eid == null) {
    return { error: 'Valid requisitionId and acknowledgedByEmployeeId are required', status: 400 }
  }
  const ok = await reqRepo.isProcurementMember(eid)
  if (!ok) return { error: 'Only Procurement can acknowledge', status: 403 }
  const rows = await reqRepo.getRequisitionForProcurementAck(reqId)
  if (!rows.length) return { error: 'Requisition not found or not yet forwarded to Procurement', status: 404 }
  await reqRepo.acknowledgeProcurement(reqId, eid)
  return { message: 'Requisition acknowledged by Procurement', status: 'Acknowledged by Procurement - Add 3 Quotations' }
}

export async function updateQuotations(reqId, body) {
  const reqIdNum = parseInt(reqId, 10)
  if (Number.isNaN(reqIdNum)) return { error: 'Valid requisition ID required', status: 400 }
  const { quotation1Url, quotation2Url, quotation3Url, updatedByEmployeeId } = body
  const eid = parseEmployeeId(updatedByEmployeeId != null ? String(updatedByEmployeeId) : null)
  if (eid == null) return { error: 'Valid updatedByEmployeeId required', status: 400 }
  const ok = await reqRepo.isProcurementMember(eid)
  if (!ok) return { error: 'Only Procurement can add quotations', status: 403 }
  const rows = await reqRepo.getRequisitionForQuotations(reqIdNum)
  if (!rows.length) return { error: 'Requisition not found or not acknowledged', status: 404 }
  await reqRepo.updateQuotations(reqIdNum, quotation1Url, quotation2Url, quotation3Url)
  return { message: 'Quotations updated', status: 'Quotations Added - Hand over to Finance' }
}

export async function uploadQuotations(reqId, files, updatedByEmployeeId) {
  const reqIdNum = parseInt(reqId, 10)
  if (Number.isNaN(reqIdNum)) return { error: 'Valid requisition ID required', status: 400 }
  const eid = parseEmployeeId(updatedByEmployeeId != null ? String(updatedByEmployeeId) : null)
  if (eid == null) return { error: 'Valid updatedByEmployeeId required', status: 400 }
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
  const { expectedHandoverDate, updatedByEmployeeId } = body
  const eid = parseEmployeeId(updatedByEmployeeId != null ? String(updatedByEmployeeId) : null)
  if (eid == null) return { error: 'Valid updatedByEmployeeId required', status: 400 }
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
export async function updateRequiredByDate(reqId, body) {
  const reqIdNum = parseInt(reqId, 10)
  if (Number.isNaN(reqIdNum)) return { error: 'Valid requisition ID required', status: 400 }
  const { requiredByDate, updatedByEmployeeId } = body
  const eid = parseEmployeeId(updatedByEmployeeId != null ? String(updatedByEmployeeId) : null)
  if (eid == null) return { error: 'Valid updatedByEmployeeId required', status: 400 }
  const rows = await reqRepo.getRequisitionById(reqIdNum)
  if (!rows.length) return { error: 'Requisition not found', status: 404 }
  const dateVal = requiredByDate && typeof requiredByDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(requiredByDate.trim())
    ? requiredByDate.trim()
    : null
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
    return rows.map(req => ({
      ...req,
      status: getRequisitionStatus(req),
      items: items.filter(i => i.req_id === req.req_id)
    }))
  } catch (_) {
    return []
  }
}

/** Procurement or Admin (for execution_admin categories): mark requisition as complete. */
export async function completePurchase(reqId, body) {
  const reqIdNum = parseInt(reqId, 10)
  if (Number.isNaN(reqIdNum)) return { error: 'Valid requisition ID required', status: 400 }
  const { completedByEmployeeId } = body
  const eid = parseEmployeeId(completedByEmployeeId != null ? String(completedByEmployeeId) : null)
  if (eid == null) return { error: 'Valid completedByEmployeeId required', status: 400 }
  const isProcurement = await reqRepo.isProcurementMember(eid)
  const isAdmin = await reqRepo.isAdminMember(eid)
  const rows = await reqRepo.getRequisitionForCompletePurchase(reqIdNum)
  if (!rows.length) return { error: 'Requisition not found or not finance approved', status: 404 }
  if (isProcurement) {
    await reqRepo.updatePurchaseCompleted(reqIdNum, eid)
    notifyCreatorAckRequired(reqIdNum).catch((e) => console.error('notifyCreatorAckRequired after completePurchase:', e?.message))
    return { message: 'Requisition marked complete. HOD can acknowledge receipt.', status: 'Completed - Pending HOD Acknowledgment' }
  }
  if (isAdmin) {
    const reqRow = await reqRepo.getRequisitionAndDepartment(reqIdNum)
    const categoryName = reqRow[0]?.req_category
    const cat = categoryName ? await reqRepo.getRequisitionCategoryByName(categoryName) : null
    if (cat && cat.execution_admin === 1) {
      await reqRepo.updatePurchaseCompleted(reqIdNum, eid)
      notifyCreatorAckRequired(reqIdNum).catch((e) => console.error('notifyCreatorAckRequired after completePurchase (Admin):', e?.message))
      return { message: 'Requisition marked complete (Admin execution). HOD can acknowledge receipt.', status: 'Completed - Pending HOD Acknowledgment' }
    }
  }
  return { error: 'Only Procurement or Admin (for execution-admin categories) can mark as complete.', status: 403 }
}

/** List requisitions completed by Procurement, pending HOD acknowledgment (same department as HOD). */
export async function getPendingHodAcknowledge(employeeId) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return { error: 'Valid employee ID is required', status: 400 }
  const emp = await reqRepo.getEmployeeDept(eid)
  if (!emp) return []
  const deptId = emp.department_id
  const deptName = (emp.department_name || '').trim().toLowerCase()
  const isHod = await reqRepo.isHodOfDepartment(eid, deptId)
  if (!isHod) return []
  try {
    const rows = await reqRepo.getPendingHodAcknowledgeList(deptId, deptName)
    const reqIds = rows.map(r => r.req_id)
    const items = reqIds.length ? await reqRepo.getItemsByReqIds(reqIds) : []
    return rows.map(req => ({
      ...req,
      status: getRequisitionStatus(req),
      items: items.filter(i => i.req_id === req.req_id)
    }))
  } catch (err) {
    if (err.code === '42703') return []
    throw err
  }
}

/** HOD/Committee/CEO: acknowledge receipt of completed purchase based on creator role. */
export async function acknowledgeReceipt(body) {
  const { requisitionId, acknowledgedByEmployeeId } = body
  const reqId = requisitionId != null ? parseInt(requisitionId, 10) : null
  const eid = parseEmployeeId(acknowledgedByEmployeeId != null ? String(acknowledgedByEmployeeId) : null)
  if (reqId == null || Number.isNaN(reqId) || eid == null) {
    return { error: 'Valid requisitionId and acknowledgedByEmployeeId required', status: 400 }
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

/** Requisitions created by this employee where execution is done but creator has not acknowledged (close ticket). */
export async function getPendingCreatorAcknowledge(employeeId) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return { error: 'Valid employee ID is required', status: 400 }
  const rows = await reqRepo.getPendingCreatorAcknowledgeList(eid)
  const reqIds = rows.map(r => r.req_id)
  const items = reqIds.length ? await reqRepo.getItemsByReqIds(reqIds) : []
  return rows.map(req => ({
    ...req,
    status: 'Pending your acknowledgment',
    items: items.filter(i => i.req_id === req.req_id)
  }))
}

/** Creator (requester) acknowledges – closes the requisition ticket. */
export async function acknowledgeByCreator(body) {
  const { requisitionId, acknowledgedByEmployeeId } = body
  const reqId = requisitionId != null ? parseInt(requisitionId, 10) : null
  const eid = parseEmployeeId(acknowledgedByEmployeeId != null ? String(acknowledgedByEmployeeId) : null)
  if (reqId == null || Number.isNaN(reqId) || eid == null) {
    return { error: 'Valid requisitionId and acknowledgedByEmployeeId required', status: 400 }
  }
  const rows = await reqRepo.getRequisitionForCreatorAcknowledge(reqId, eid)
  if (!rows.length) return { error: 'Requisition not found or you are not the creator or it is not ready for your acknowledgment', status: 404 }
  await reqRepo.updateCreatorAcknowledged(reqId)
  return { message: 'Requisition acknowledged and closed', status: 'Closed' }
}

export async function handoverFinance(body) {
  const { requisitionId, handedByEmployeeId } = body
  const reqId = requisitionId != null ? parseInt(requisitionId, 10) : null
  const eid = parseEmployeeId(handedByEmployeeId != null ? String(handedByEmployeeId) : null)
  if (reqId == null || Number.isNaN(reqId) || eid == null) {
    return { error: 'Valid requisitionId and handedByEmployeeId are required', status: 400 }
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
  await setCurrentStageIfFlowEnabled(reqId, 'finance')
  await notifyBucketChanged(reqId, 'finance')
  return { message: 'Handed over to Finance', status: 'Pending Finance Approval' }
}

export async function getPendingFinance(employeeId) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return { error: 'Valid employee ID is required', status: 400 }
  const useFlow = (await reqRepo.getFlowStages()).length > 0
  const ok = useFlow ? await reqRepo.isEmployeeTypeForStage(eid, 'finance') : await reqRepo.isFinanceHod(eid)
  if (!ok) return []
  const rows = useFlow
    ? await reqRepo.getPendingRequisitionsByCurrentStage('finance')
    : await reqRepo.getPendingFinanceRequisitions()
  const reqIds = rows.map(r => r.req_id)
  const items = reqIds.length ? await reqRepo.getItemsByReqIds(reqIds) : []
  return rows.map(req => ({
    ...req,
    status: 'Pending Finance Approval',
    items: items.filter(i => i.req_id === req.req_id)
  }))
}

export async function approveFinance(body) {
  const { requisitionId, approvedByEmployeeId, approvedQuotationIndex } = body
  const reqId = requisitionId != null ? parseInt(requisitionId, 10) : null
  const eid = parseEmployeeId(approvedByEmployeeId != null ? String(approvedByEmployeeId) : null)
  if (reqId == null || Number.isNaN(reqId) || eid == null) {
    return { error: 'Valid requisitionId and approvedByEmployeeId are required', status: 400 }
  }
  const ok = await reqRepo.isFinanceHod(eid)
  if (!ok) return { error: 'Only Finance HOD can approve', status: 403 }
  const rows = await reqRepo.getRequisitionForFinanceApproval(reqId)
  if (!rows.length) return { error: 'Requisition not found or not pending finance approval', status: 404 }
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
  if (isLoan) {
    notifyCreatorAckRequired(reqId).catch((e) => console.error('notifyCreatorAckRequired after Finance (Loan):', e?.message))
  } else {
    await notifyBucketChanged(reqId, 'procurement')
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
  const data = rows.map((row) => {
    const { totalHours } = getTATFromRequisition(row)
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
  const { buckets, totalHours } = getTATFromRequisition(row)
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
  const items = await reqRepo.getRequisitionItems(reqId)
  return {
    ...reqRow,
    requiredByDate: reqRow.req_required_by_date || null,
    status: getRequisitionStatus(reqRow),
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
