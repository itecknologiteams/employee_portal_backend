import { executeQuery } from '../../config/database.js'
import { getQueue, isBullMQEnabled } from '../../config/bullmq.js'
import { sendRequisitionReminder, isEmailConfigured, EMAIL_FROM } from '../../config/email.js'
import { getEmailsForBucket } from '../utils/requisitionEmailRouting.js'
import { notifyCreatorAckRequired } from '../../jobs/requisition-emailer.js'
import * as reqRepo from '../repositories/requisition.repository.js'
import { getEmployeeIdByCode, getUserTypeByEmployeeId } from '../repositories/auth.repository.js'
import {
  getRequisitionStatus,
  getPendingAt,
  parseEmployeeId,
  getTATFromRequisition,
  buildTatFromRequisition,
  formatTotalTime,
  tatReportStatusCondition,
  computeCommitteeApprovedLineTotalPKR,
  REQUISITION_CEO_MIN_AMOUNT_PKR,
  isItEquipmentCategory,
  computeItemTaxAmountPkr,
  isItemExcluded,
  buildRevisionReference,
  canReviseRequisition
} from '../utils/requisition.utils.js'
import { parseNumericCostPkr, getEffectiveUnitPricePkrFromItem } from '../utils/requisitionAmountParse.js'
import { isCategoryNoBoq, isCategoryHrAfterHod, isCategoryNoDate } from '../config/requisitionCategoryPolicy.js'
import * as notifRepo from '../repositories/notification.repository.js'
import * as notifSvc from './notification.service.js'

/** Save rejection reason as a comment and update the rejection record. */
async function rejectWithReason(requisitionId, reason, approverEid, stageKey) {
  await reqRepo.rejectRequisition(requisitionId, reason, stageKey)
  if (reason && String(reason).trim()) {
    await reqRepo.insertRequisitionComment(requisitionId, stageKey, `[Rejection reason] ${String(reason).trim()}`, approverEid)
  }
  // Email the creator about the rejection
  await notifyRequisitionRejected(requisitionId, stageKey, reason || '')
}

async function resolveApproverEmployeeId(body) {

  if (body?.approvedByEmployeeId != null && String(body.approvedByEmployeeId).trim() !== '') {
    const eid = parseEmployeeId(String(body.approvedByEmployeeId))
    if (eid != null) return eid
  }
  if (body?.approvedByEmployeeCode != null && String(body.approvedByEmployeeCode).trim() !== '') {
    return await getEmployeeIdByCode(String(body.approvedByEmployeeCode).trim())
  }
  // Support for revert operation fields
  if (body?.revertedByEmployeeId != null && String(body.revertedByEmployeeId).trim() !== '') {
    const eid = parseEmployeeId(String(body.revertedByEmployeeId))
    if (eid != null) return eid
  }
  if (body?.revertedByEmployeeCode != null && String(body.revertedByEmployeeCode).trim() !== '') {
    return await getEmployeeIdByCode(String(body.revertedByEmployeeCode).trim())
  }
  // Support for HOD resubmit after revert
  if (body?.hodEmployeeCode != null && String(body.hodEmployeeCode).trim() !== '') {
    return await getEmployeeIdByCode(String(body.hodEmployeeCode).trim())
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
          form_layout: r.form_layout || null,
          requires_date: !isCategoryNoDate(r.name)
        }))
      }
    }
  } catch (_) {
    /* table may not exist */
  }
  return { categories: [...REQUISITION_CATEGORIES], flow: null }
}

const VALID_BUCKETS = ['hod', 'it', 'hr', 'committee', 'ceo', 'procurement', 'finance', 'admin', 'admin_acknowledge', 'admin_handover', 'hr_check']

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

async function notifyRequisitionReverted(requisitionId, fromStage, revertComment) {
  if (!requisitionId) return
  let queued = false
  if (isBullMQEnabled()) {
    try {
      const q = getQueue()
      await q.add('requisition-reverted', { requisitionId, fromStage, revertComment })
      queued = true
    } catch (e) {
      console.error('BullMQ requisition-reverted add failed:', e?.message)
    }
  }
  if (!queued) {
    try {
      const { handleRequisitionReverted } = await import('../../workers/requisition-reminder-worker.js')
      await handleRequisitionReverted({ requisitionId, fromStage, revertComment })
    } catch (e2) {
      console.error('Fallback reverted email failed:', e2?.message)
    }
  }
}

async function notifyRequisitionResubmitted(requisitionId, targetStage) {
  if (!requisitionId || !targetStage) return
  let queued = false
  if (isBullMQEnabled()) {
    try {
      const q = getQueue()
      await q.add('requisition-resubmitted', { requisitionId, targetStage })
      queued = true
    } catch (e) {
      console.error('BullMQ requisition-resubmitted add failed:', e?.message)
    }
  }
  if (!queued) {
    try {
      const { handleRequisitionResubmitted } = await import('../../workers/requisition-reminder-worker.js')
      await handleRequisitionResubmitted({ requisitionId, targetStage })
    } catch (e2) {
      console.error('Fallback resubmitted email failed:', e2?.message)
    }
  }
}

async function notifyRequisitionRejected(requisitionId, rejectedByStage, rejectionReason) {
  if (!requisitionId) return
  let queued = false
  if (isBullMQEnabled()) {
    try {
      const q = getQueue()
      await q.add('requisition-rejected', { requisitionId, rejectedByStage, rejectionReason })
      queued = true
    } catch (e) {
      console.error('BullMQ requisition-rejected add failed:', e?.message)
    }
  }
  if (!queued) {
    try {
      const { handleRequisitionRejected } = await import('../../workers/requisition-reminder-worker.js')
      await handleRequisitionRejected({ requisitionId, rejectedByStage, rejectionReason })
    } catch (e2) {
      console.error('Fallback rejected email failed:', e2?.message)
    }
  }
}

/** IT department id for the department-wide requisition view; null disables the feature. */
function getItDepartmentId() {
  const raw = String(process.env.IT_DEPARTMENT_ID ?? '8').trim()
  const n = parseInt(raw, 10)
  return Number.isNaN(n) ? null : n
}

/** True if the employee belongs to the IT department (by dept) or is its HOD. */
async function isItDepartmentMember(eid) {
  const itId = getItDepartmentId()
  if (itId == null) return false
  const deptId = await reqRepo.getCreatorDepartment(eid)
  if (deptId != null && parseInt(deptId, 10) === itId) return true
  return await reqRepo.isHodOfDepartment(eid, itId)
}

/**
 * Stage a requisition moves to after HOD approval, honoring the IT Equipments rule:
 * if the CREATOR is an IT-department member they add the items themselves, so the IT review
 * stage is skipped (go to the stage after IT — i.e. committee). A non-IT creator goes to IT.
 * All other categories just use the DB-defined next stage after HOD.
 */
async function nextStageAfterHod(categoryName, creatorEmployeeId) {
  const fromHod = (await reqRepo.getNextStageKey(categoryName, 'hod').catch(() => null)) || 'committee'
  if (!isItEquipmentCategory(categoryName)) return fromHod
  const creatorIsIt = await isItDepartmentMember(parseInt(creatorEmployeeId, 10)).catch(() => false)
  if (!creatorIsIt) return fromHod // non-IT creator → IT stage fills the items
  return (await reqRepo.getNextStageKey(categoryName, 'it').catch(() => null)) || 'committee' // IT creator → skip IT
}

export async function getHistory(employeeId, query = {}) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return { error: 'Valid employee ID is required', status: 400 }
  const page = Math.max(1, parseInt(query.page, 10) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20))
  const offset = (page - 1) * limit
  const search = query.search != null ? String(query.search).trim() : ''
  const from = query.from != null ? String(query.from).trim() : ''
  const to = query.to != null ? String(query.to).trim() : ''
  const statusFilter = query.status != null ? String(query.status).trim() : ''

  // Department-wide (IT only) view: list all IT members' requisitions, read-only.
  const scope = String(query.scope || 'my').trim().toLowerCase()
  const canViewDepartment = await isItDepartmentMember(eid)
  if (scope === 'department') {
    if (!canViewDepartment) return { error: 'Not authorized for department view', status: 403 }
    return getDepartmentHistory(eid, { page, limit, offset, search, from, to, statusFilter })
  }

  // Search + date range are filtered in SQL. Status is a COMPUTED value (getRequisitionStatus),
  // so when it's filtered we fetch all SQL-matching rows, compute status, filter, then paginate
  // in JS (per-employee history is small, so this is safe and keeps the count accurate).
  let rows, total
  if (statusFilter) {
    const allRows = await reqRepo.getTrackRecordsByEmployee(eid, null, 0, search || undefined, false, from || undefined, to || undefined)
    const matched = allRows.filter((r) => getRequisitionStatus(r) === statusFilter)
    total = matched.length
    rows = matched.slice(offset, offset + limit)
  } else {
    total = await reqRepo.getTrackRecordsCountByEmployee(eid, search || undefined, false, from || undefined, to || undefined)
    rows = await reqRepo.getTrackRecordsByEmployee(eid, limit, offset, search || undefined, false, from || undefined, to || undefined)
  }
  const totalPages = Math.max(1, Math.ceil(total / limit))
  const reqIds = rows.map(r => r.req_id)
  const items = reqIds.length ? await reqRepo.getRequisitionItemsByReqIds(reqIds) : []
  const procSet = await reqRepo.getProcurementInvolvedCategoryNames().catch(() => new Set())
  const today = new Date().toISOString().slice(0, 10)
  const data = rows.map(req => ({
    id: req.req_id,
    referenceNo: req.req_reference_no,
    employeeId: req.req_emp_id,
    location: req.req_location,
    material: req.req_material,
    requiredByDate: req.req_required_by_date || null,
    isUrgent: req.req_is_urgent === 1,
    urgentDate: req.req_urgent_date || null,
    business: req.req_business,
    category: req.req_category || null,
    status: getRequisitionStatus(req),
    canRevise: canReviseRequisition({
      isRejected: req.req_is_rejected === 1,
      isClosed: getRequisitionStatus(req) === 'Closed',
      requiredByDate: toYmd(req.req_required_by_date),
      procurementInvolved: procSet.has(String(req.req_category || '').trim().toLowerCase()),
      today
    }),
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
  return { data, pagination: { page, limit, total, totalPages }, canViewDepartment, scope: 'my' }
}

/** Department-wide (IT) read-only history: all IT members' requisitions with creator name. */
async function getDepartmentHistory(eid, { page, limit, offset, search, from, to, statusFilter }) {
  const itId = getItDepartmentId()
  const memberIds = await reqRepo.getDepartmentMemberIds(itId)
  // Search + date range in SQL; computed status filtered in JS over all matching rows (then paginate).
  let rows, total
  if (statusFilter) {
    const allRows = await reqRepo.getTrackRecordsByMembers(memberIds, null, 0, search || undefined, from || undefined, to || undefined)
    const matched = allRows.filter((r) => getRequisitionStatus(r) === statusFilter)
    total = matched.length
    rows = matched.slice(offset, offset + limit)
  } else {
    total = await reqRepo.getTrackRecordsCountByMembers(memberIds, search || undefined, from || undefined, to || undefined)
    rows = await reqRepo.getTrackRecordsByMembers(memberIds, limit, offset, search || undefined, from || undefined, to || undefined)
  }
  const totalPages = Math.max(1, Math.ceil(total / limit))
  const reqIds = rows.map(r => r.req_id)
  const items = reqIds.length ? await reqRepo.getRequisitionItemsByReqIds(reqIds) : []
  const data = rows.map(req => ({
    id: req.req_id,
    referenceNo: req.req_reference_no,
    employeeId: req.req_emp_id,
    employeeName: req.creator_name || null,
    employeeCode: req.creator_code || null,
    isOwn: parseInt(req.req_emp_id, 10) === eid,
    location: req.req_location,
    material: req.req_material,
    requiredByDate: req.req_required_by_date || null,
    isUrgent: req.req_is_urgent === 1,
    urgentDate: req.req_urgent_date || null,
    business: req.req_business,
    category: req.req_category || null,
    status: getRequisitionStatus(req),
    // Department view is strictly read-only — never expose revise/acknowledge affordances.
    canRevise: false,
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
  return { data, pagination: { page, limit, total, totalPages }, canViewDepartment: true, scope: 'department' }
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
      isUrgent: req.req_is_urgent === 1,
      urgentDate: req.req_urgent_date || null,
      status,
      pendingAt: getPendingAt(status),
      isRejected: req.req_is_rejected === 1,
      itemCount: countByReq[req.req_id] ?? 0
    }
  })
  return { data, pagination: { page, limit, total, totalPages } }
}

/** Normalize item cost: digits only (optional decimal) before DB insert. */
// Column length limits (requisition_items). Validated up front so an over-length value returns
// a clear 400 instead of a Postgres 22001 error mid-insert (which used to orphan the row).
const ITEM_FIELD_LIMITS = [
  { keys: ['itemProductDescription', 'itemDesc', 'item_desc'], max: 255, label: 'product description' },
  { keys: ['itemSize', 'item_size'], max: 100, label: 'size' },
  { keys: ['itemBrand', 'item_brand'], max: 100, label: 'brand' },
  { keys: ['itemRemarks', 'item_remarks'], max: 500, label: 'remarks' }
]

function normalizeRequisitionItemForCreate(item) {
  // Length validation first — a value that exceeds its column would otherwise throw mid-insert.
  for (const { keys, max, label } of ITEM_FIELD_LIMITS) {
    const val = keys.map((k) => item[k]).find((v) => v != null && v !== '')
    if (val != null && String(val).trim().length > max) {
      const e = new Error(`Item ${label} is too long (max ${max} characters). Please shorten it and try again.`)
      e.status = 400
      throw e
    }
  }
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

/**
 * Recompute and persist item_tax_amount for every item of a requisition.
 * IT Equipments category: tax = computeItemTaxAmountPkr(item) per item.
 * Any other category: explicitly clear tax to NULL (never carry stale tax).
 * Safe to call after any item mutation; tolerant of a missing column (pre-migration).
 */
async function refreshRequisitionItemTaxes(reqId) {
  const id = parseInt(reqId, 10)
  if (Number.isNaN(id)) return
  try {
    const rows = await reqRepo.getRequisitionById(id)
    const category = rows?.[0]?.req_category ?? null
    const items = await reqRepo.getRequisitionItems(id)
    const isIt = isItEquipmentCategory(category)
    const rateRow = isIt ? await reqRepo.getCurrentSalesTaxRateRow() : null
    const ratePercent = rateRow ? Number(rateRow.rate_percent) : null
    const rate = ratePercent != null ? ratePercent / 100 : null
    for (const it of items) {
      // Excluded items (flagged unavailable / dropped) carry no tax — they are not purchased.
      const tax = (isIt && !isItemExcluded(it)) ? computeItemTaxAmountPkr(it, rate) : null
      await reqRepo.updateItemTaxAmount(it.item_id, tax)
    }
    // Stamp which rate was applied (going-forward only); clear for non-IT.
    await reqRepo.updateRequisitionTaxRate(id, isIt ? (rateRow?.id ?? null) : null, isIt ? ratePercent : null)
  } catch (_) {
    /* column may not exist yet (pre-migration); ignore */
  }
}

/** Resolve an employee code (or numeric id) to an employee_id. */
async function resolveEmployeeIdFromCode(code) {
  if (code == null || String(code).trim() === '') return null
  const byCode = await getEmployeeIdByCode(String(code).trim()).catch(() => null)
  if (byCode != null) return byCode
  return parseEmployeeId(String(code))
}

/** SuperAdmin check that works on this deployment (users.user_type), matching the frontend. */
async function isSuperAdminEmployee(eid) {
  const t = await getUserTypeByEmployeeId(eid).catch(() => null)
  return String(t || '').trim().toLowerCase() === 'superadmin'
}

/** SuperAdmin: read current sales tax rate (percent) + history. */
export async function getSalesTaxSettings(employeeCode) {
  const eid = await resolveEmployeeIdFromCode(employeeCode)
  if (eid == null) return { error: 'Valid employee is required', status: 400 }
  if (!(await isSuperAdminEmployee(eid))) return { error: 'Only SuperAdmin can view tax settings', status: 403 }
  const history = await reqRepo.getSalesTaxRateHistory()
  const currentPercent = history.length ? Number(history[0].rate_percent) : 18
  return { ratePercent: currentPercent, history }
}

/** SuperAdmin: add a new sales tax rate (percent). Append-only; takes effect immediately for new saves. */
export async function addSalesTaxRateSetting(employeeCode, ratePercent) {
  const eid = await resolveEmployeeIdFromCode(employeeCode)
  if (eid == null) return { error: 'Valid employee is required', status: 400 }
  if (!(await isSuperAdminEmployee(eid))) return { error: 'Only SuperAdmin can change the tax rate', status: 403 }
  const raw = String(ratePercent ?? '').trim()
  const pct = Number(raw)
  if (raw === '' || Number.isNaN(pct) || pct < 0 || pct > 100) {
    return { error: 'Rate must be a percent between 0 and 100', status: 400 }
  }
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
    return { error: 'Rate may have at most 2 decimals', status: 400 }
  }
  await reqRepo.addSalesTaxRate(pct, eid)
  const history = await reqRepo.getSalesTaxRateHistory()
  return { ratePercent: pct, history }
}

export async function createRequisition(body) {
  const { employeeId, location, material, requiredByDate, business, items, category, loanAdvanceType, loanAdvanceAmount, loanAdvanceReason, loanInstallmentMonths, isUrgent } = body
  const categoryTrimmed = category?.trim() || ''
  const noDateCategory = isCategoryNoDate(categoryTrimmed)
  const urgent = isUrgent === true || isUrgent === 1 || isUrgent === 'true'

  if (!employeeId) {
    return { error: 'employeeId is required', status: 400 }
  }
  if (!location || typeof location !== 'string' || !String(location).trim()) {
    return { error: 'Location is required', status: 400 }
  }
  if (!material || typeof material !== 'string' || !String(material).trim()) {
    return { error: 'Material / Summary is required', status: 400 }
  }
  // Required by date is optional for no-date categories and urgent requests
  if (!noDateCategory && !urgent && (!requiredByDate || typeof requiredByDate !== 'string' || !String(requiredByDate).trim())) {
    return { error: 'Required by date is required', status: 400 }
  }
  const itemsList = Array.isArray(items) ? items : []
  let validItems = itemsList.filter(it => {
    const qty = it.itemQty ?? it.item_qty ?? 0
    const hasData = (it.itemDesc && it.itemDesc.trim()) || (it.item_desc && String(it.item_desc).trim()) ||
      (it.itemSize && it.itemSize.trim()) || (it.item_size && String(it.item_size).trim()) ||
      (it.itemBrand && it.itemBrand.trim()) || (it.item_brand && String(it.item_brand).trim()) ||
      (Number(qty) > 0)
    return hasData
  })

  // Compute creator HOD/Committee/CEO status once for reuse
  const deptId = await reqRepo.getCreatorDepartment(employeeId)
  const hodId = await reqRepo.getHodByDepartment(deptId)
  const creatorIsHodByDept = hodId != null && hodId === parseInt(employeeId, 10)
  const creatorIsHodByRole = deptId != null && await reqRepo.isHodOfDepartment(parseInt(employeeId, 10), deptId)
  const creatorIsHod = creatorIsHodByDept || creatorIsHodByRole
  const creatorIsCommittee = await reqRepo.isCommitteeMember(employeeId)
  const creatorIsCeo = await reqRepo.isCeoMember(employeeId)

  // IT Equipments: items are filled by the IT stage (after HOD). A non-IT creator only gives
  // date + description, so ignore any items they submit. IT-department creators may add items.
  const isItEquip = isItEquipmentCategory(categoryTrimmed)
  const creatorIsItMember = isItEquip ? await isItDepartmentMember(parseInt(employeeId, 10)) : false
  if (isItEquip && !creatorIsItMember) {
    validItems = []
  }

  if (validItems.length > 0) {
    const { employeeHasPermission } = await import('./auth.service.js')
    // IT members are allowed to add items for IT Equipments even without the generic permission.
    const canAddItems = creatorIsHod || (isItEquip && creatorIsItMember) || await employeeHasPermission(employeeId, 'requisition_can_add_items')
    if (!canAddItems) {
      return { error: 'You do not have permission to add items to requisitions. Contact Administration for "Can add items" access.', status: 403 }
    }
  }
  if (!category || typeof category !== 'string' || !category.trim()) {
    return { error: 'Category is required', status: 400 }
  }
  // Technicians may only raise the Loan & Advance Salary category (enforced server-side).
  {
    const { isTechnicianEmployee } = await import('./auth.service.js')
    if (await isTechnicianEmployee(employeeId) && categoryTrimmed.toLowerCase() !== 'loan & advance salary') {
      return { error: 'Technicians can only create a Loan & Advance Salary requisition.', status: 403 }
    }
  }
  let allowedCategories = REQUISITION_CATEGORIES
  try {
    const { categories } = await getCategories()
    if (Array.isArray(categories) && categories.length > 0) allowedCategories = categories
  } catch (_) {}
  if (!allowedCategories.includes(categoryTrimmed)) {
    return { error: `Category must be one of: ${allowedCategories.join(', ')}`, status: 400 }
  }

  // Required by date must be at least 4 days from today — skip for urgent and no-date categories
  if (!noDateCategory && !urgent && requiredByDate && typeof requiredByDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(requiredByDate.trim())) {
    const minDate = new Date()
    minDate.setDate(minDate.getDate() + 4)
    const minStr = `${minDate.getFullYear()}-${String(minDate.getMonth() + 1).padStart(2, '0')}-${String(minDate.getDate()).padStart(2, '0')}`
    if (requiredByDate.trim() < minStr) {
      return { error: 'Required by date must be at least 4 days from today. You cannot select today or the next 3 days.', status: 400 }
    }
  }

  // Determine creator role for acknowledgment routing
  let creatorRole = null
  if (creatorIsCeo) {
    creatorRole = 'CEO'
  } else if (creatorIsCommittee) {
    creatorRole = 'Committee'
  } else if (creatorIsHod) {
    creatorRole = 'HOD'
  }

  const urgentDate = urgent ? new Date().toISOString().slice(0, 10) : null

  // Normalize + validate items BEFORE any insert, so bad item data returns 400 without
  // creating a requisition row. (Previously the row was inserted first, then item failures
  // left an orphan row and a misleading "Failed to create" — users retried → duplicates.)
  let normalizedItems = []
  if (validItems.length > 0) {
    try {
      normalizedItems = validItems.map((it) => normalizeRequisitionItemForCreate(it))
    } catch (normErr) {
      return { error: normErr.message || 'Invalid item amount', status: normErr.status || 400 }
    }
  }

  // Insert the requisition row and its items atomically: if the item insert fails, the row is
  // rolled back too — no orphan, and it is safe to retry without creating duplicates.
  const created = await reqRepo.createRequisitionWithItems({
    employeeId, location, material, requiredByDate, business, creatorRole, category: categoryTrimmed,
    loanAdvanceType, loanAdvanceAmount, loanAdvanceReason, loanInstallmentMonths, isUrgent: urgent, urgentDate
  }, normalizedItems)
  const reqId = created.req_id
  const refNo = created.req_reference_no

  if (normalizedItems.length > 0) {
    await refreshRequisitionItemTaxes(reqId)
  }

  // From here the requisition + items are committed. Stage routing and notifications are
  // best-effort: a failure must NOT report the create as failed (that caused retry duplicates).
  try {

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
        // Mark as approved by their role, then route to the HR bucket. The stage key MUST be set
        // to 'hr' and HR notified — otherwise the requisition only shows in HR via the NULL-stage
        // fallback and HR gets no email/in-app alert.
        if (creatorIsCeo) await reqRepo.autoAdvanceCeoRequisition(reqId)
        else if (creatorIsCommittee) await reqRepo.autoAdvanceCommitteeRequisition(reqId)
        else if (creatorIsHod) await reqRepo.autoAdvanceHodRequisition(reqId, parseInt(employeeId, 10))
        await setCurrentStage(reqId, 'hr')
        await notifyBucketChanged(reqId, 'hr')
        notifSvc.notifySafe(inAppNotifyRequisitionBucket(reqId, 'hr', deptId))
      } else {
        // Normal employee: HOD pe jaao pehle
        await setCurrentStage(reqId, 'hod')
        await notifyBucketChanged(reqId, 'hod')
        notifSvc.notifySafe(inAppNotifyRequisitionBucket(reqId, 'hod', deptId))
      }
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
      } else {
        // Normal employee: Loan & Advance Salary always requires HOD approval first,
        // regardless of flow stage config or hod_for_info DB setting.
        await setCurrentStage(reqId, 'hod')
        await notifyBucketChanged(reqId, 'hod')
        notifSvc.notifySafe(inAppNotifyRequisitionBucket(reqId, 'hod', deptId))
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
    // Next stage after HOD per category; IT Equipments skips IT only when the creator is IT.
    const nextAfterHod = await nextStageAfterHod(categoryTrimmed, employeeId)
    await setCurrentStage(reqId, nextAfterHod)
    await notifyBucketChanged(reqId, nextAfterHod)
    notifSvc.notifySafe(inAppNotifyRequisitionBucket(reqId, nextAfterHod, deptId))
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

  } catch (advanceErr) {
    // Requisition + items are already committed; routing/notification failed. Log loudly but
    // still report success so the user is not misled into retrying and creating duplicates.
    console.error(`Requisition ${reqId} created but stage routing/notification failed:`, advanceErr?.message)
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
  const [isCommittee, isCeo, isSuperAdmin, isFinance, hasReportPerm] = await Promise.all([
    reqRepo.isCommitteeMember(eid),
    reqRepo.isCeoMember(eid),
    reqRepo.isSuperAdmin(eid),
    reqRepo.isFinanceHod(eid),
    // Explicit "requisition_reports" permission (e.g. CEO's Personal Assistant) → full report access,
    // same as CEO/Committee. Granted via per-employee override on the Administration page.
    reqRepo.employeeHasPermission(eid, 'requisition_reports')
  ])
  const canView = youAreHod || isCommittee || isCeo || isSuperAdmin || isFinance || hasReportPerm
  if (!canView) return []

  const hodOnlyFilter = youAreHod && !isCommittee && !isCeo && !isSuperAdmin && !isFinance && !hasReportPerm
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
      // Only show requisitions actually in the HOD bucket — ack list is served separately by getPendingHodAcknowledge.
      // Exclude the viewing HOD's own requisitions (separation of duties); other HODs still see them.
      rows = await reqRepo.getPendingRequisitionsByCurrentStage('hod', { departmentId: deptId, departmentName: deptName, excludeEmployeeId: eid }) || []
    } catch (err) {
      if (err.code === '42703') rows = []
      else throw err
    }

    try {
      const extRows = await reqRepo.getRequisitionsNeedingDeadlineExtensionByDept(deptId, deptName, eid)
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


export async function getPendingHodReverted(employeeId) {
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
      rows = await reqRepo.getPendingHodRevertedRequisitions(deptId, deptName, eid)
    } catch (err) {
      if (err.code !== '42703') throw err
    }

    for (const r of rows || []) {
      if (r.req_id != null && !seenReqIds.has(r.req_id)) {
        seenReqIds.add(r.req_id)
        allRows.push(r)
      }
    }
  }

  allRows.sort((a, b) => new Date(b.req_created_at) - new Date(a.req_created_at))

  const reqIds = allRows.map(r => r.req_id)
  const items = reqIds.length ? await reqRepo.getItemsByReqIds(reqIds) : []
  return allRows.map(req => ({ ...req, status: getRequisitionStatus(req), items: items.filter(i => i.req_id === req.req_id) }))
}

export async function getApprovedByHod(employeeId) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return { error: 'Valid employee ID is required', status: 400 }

  const hodDepartments = await reqRepo.getHodDepartmentsForEmployee(eid)
  if (!hodDepartments || hodDepartments.length === 0) return []

  const deptIds = hodDepartments.map(d => d.department_id)
  const rows = await reqRepo.getApprovedByHodRequisitionsForDepts(eid, deptIds)

  if (!rows || rows.length === 0) return []

  const reqIds = rows.map(r => r.req_id)
  const items = reqIds.length ? await reqRepo.getItemsByReqIds(reqIds) : []

  return rows.map(req => ({
    ...req,
    status: getRequisitionStatus(req),
    items: items.filter(i => i.req_id === req.req_id)
  }))
}

export async function getApprovedByIt(employeeId) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return { error: 'Valid employee ID is required', status: 400 }
  // Only IT-stage members see the "As IT" list (same role gate as the IT pending/approve flow).
  const isIt = await reqRepo.isEmployeeTypeForStage(eid, 'it')
  if (!isIt) return []
  const rows = await reqRepo.getApprovedByItRequisitions(eid)
  const reqIds = rows.map(r => r.req_id)
  const items = reqIds.length ? await reqRepo.getItemsByReqIds(reqIds) : []
  return rows.map(req => ({ ...req, status: getRequisitionStatus(req), items: items.filter(i => i.req_id === req.req_id) }))
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

export async function getApprovedByProcurement(employeeId) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return { error: 'Valid employee ID is required', status: 400 }
  const ok = await reqRepo.isProcurementMember(eid)
  if (!ok) return []
  const rows = await reqRepo.getApprovedByProcurementRequisitions()
  const reqIds = rows.map(r => r.req_id)
  const items = reqIds.length ? await reqRepo.getItemsByReqIds(reqIds) : []
  return rows.map(req => ({ ...req, status: getRequisitionStatus(req), items: items.filter(i => i.req_id === req.req_id) }))
}

export async function getApprovedByFinance(employeeId) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return { error: 'Valid employee ID is required', status: 400 }
  const ok = await reqRepo.isFinanceHod(eid)
  if (!ok) return []
  const rows = await reqRepo.getApprovedByFinanceRequisitions()
  const reqIds = rows.map(r => r.req_id)
  const items = reqIds.length ? await reqRepo.getItemsByReqIds(reqIds) : []
  return rows.map(req => ({ ...req, status: getRequisitionStatus(req), items: items.filter(i => i.req_id === req.req_id) }))
}

export async function getApprovedByAdmin(employeeId) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return { error: 'Valid employee ID is required', status: 400 }
  const ok = await reqRepo.isAdminMember(eid)
  if (!ok) return []
  const rows = await reqRepo.getApprovedByAdminRequisitions()
  const reqIds = rows.map(r => r.req_id)
  const items = reqIds.length ? await reqRepo.getItemsByReqIds(reqIds) : []
  return rows.map(req => ({ ...req, status: getRequisitionStatus(req), items: items.filter(i => i.req_id === req.req_id) }))
}

export async function getApprovedByHr(employeeId) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return { error: 'Valid employee ID is required', status: 400 }
  const isHr = await reqRepo.isHrMember(employeeId)
  if (!isHr ) return []

  // Get ALL requisitions where HR has approved (req_hr_approval = 1)
  // All departments - HR oversees all HODs
  // Exclude requisitions created by the current user
  const rows = await reqRepo.getApprovedByHrRequisitions(eid)
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
  // IT Equipments: HOD only approves; items + BOQ are filled later by the IT stage. So HOD
  // approves without items/BOQ and the requisition advances by flow (HOD → IT).
  const noBoqCategory = isCategoryNoBoq(categoryName) || isItEquipmentCategory(categoryName)

  // For no-BOQ categories (Loan, Event, Vehicle Maintenance, etc.): approve without BOQ, advance by flow only
  if (noBoqCategory) {
    await reqRepo.approveHod(requisitionId, approverEid)
    const stages = await reqRepo.getFlowStages()
    const hasHrStage = stages.some((s) => (s.stage_key || '').toLowerCase() === 'hr')
    let nextKey = categoryName ? await reqRepo.getNextStageKey(categoryName, 'hod') : null
    // IT Equipments: skip the IT stage when the requisition's CREATOR is from IT (they added the
    // items themselves); a non-IT creator's req goes to IT so IT can fill items + pricing.
    if (isItEquipmentCategory(categoryName)) {
      const creatorId = await notifRepo.getRequisitionCreatorId(requisitionId).catch(() => null)
      nextKey = await nextStageAfterHod(categoryName, creatorId)
    }
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
    await refreshRequisitionItemTaxes(requisitionId)
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
  const resolvedNext = nextKey || 'committee'
  await setCurrentStage(requisitionId, resolvedNext)
  if (VALID_BUCKETS.includes(resolvedNext)) {
    await notifyBucketChanged(requisitionId, resolvedNext)
    notifSvc.notifySafe(inAppNotifyRequisitionBucket(requisitionId, resolvedNext, deptIdForReq))
  }
  const statusLabel = resolvedNext === 'hr' ? 'Pending HR'
    : resolvedNext === 'it' ? 'Pending IT'
    : resolvedNext === 'committee' ? 'Pending Committee'
    : resolvedNext === 'ceo' ? 'Pending CEO'
    : resolvedNext === 'procurement' ? 'Forwarded to Procurement'
    : resolvedNext === 'finance' ? 'Pending Finance'
    : `Pending ${resolvedNext}`
  return { message: 'HOD approval recorded', status: statusLabel }
}

// ---------- IT stage ----------

export async function getPendingIt(employeeId) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return { error: 'Valid employee ID is required', status: 400 }
  const useFlow = (await reqRepo.getFlowStages()).length > 0
  const ok = useFlow ? await reqRepo.isEmployeeTypeForStage(eid, 'it') : false
  if (!ok) return []
  const rows = await reqRepo.getPendingRequisitionsByCurrentStage('it')
  const reqIds = rows.map((r) => r.req_id)
  const items = reqIds.length ? await reqRepo.getItemsByReqIds(reqIds) : []
  return rows.map((req) => ({
    ...req,
    status: 'Pending IT',
    items: items.filter((i) => i.req_id === req.req_id)
  }))
}

/**
 * IT user forwards the requisition (after editing items + pricing) OR rejects it.
 * Body:
 *  - requisitionId (required)
 *  - approved: true to forward, false to reject
 *  - approvedByEmployeeId / approvedByEmployeeCode (required)
 *  - items: [{ itemDesc, itemSize, itemBrand, itemQty, itemEstCost, itemRemarks }] (required when approved=true)
 *  - rejectionReason: string (required when approved=false)
 */
export async function approveIt(body) {
  const { requisitionId, approved, items } = body
  const reqId = requisitionId != null ? parseInt(requisitionId, 10) : null
  const eid = await resolveApproverEmployeeId(body)
  if (reqId == null || Number.isNaN(reqId) || eid == null) {
    return { error: 'Valid requisitionId and approvedByEmployeeId or approvedByEmployeeCode are required', status: 400 }
  }
  const ok = await reqRepo.isEmployeeTypeForStage(eid, 'it')
  if (!ok) return { error: 'Only IT employees can perform this action', status: 403 }

  const reqRow = await reqRepo.getRequisitionAndDepartment(reqId)
  if (!reqRow.length) return { error: 'Requisition not found', status: 404 }
  if (reqRow[0].req_current_stage_key !== 'it') {
    return { error: `Requisition is not at IT stage (current: ${reqRow[0].req_current_stage_key || 'none'})`, status: 400 }
  }

  if (approved === false) {
    const reason = body.rejectionReason != null ? String(body.rejectionReason).trim() : ''
    if (!reason) return { error: 'Rejection reason is required. Please state why this requisition is being rejected.', status: 400 }
    const creatorId = await notifRepo.getRequisitionCreatorId(reqId)
    await rejectWithReason(reqId, reason, eid, 'it')
    if (creatorId) {
      notifSvc.notifySafe(notifSvc.notify({
        recipientEmployeeId: creatorId,
        type: 'requisition_rejected',
        title: 'Requisition rejected by IT',
        body: `Your requisition was rejected by IT. Reason: ${reason}`,
        url: '/requisition/history',
        relatedEntityType: 'requisition',
        relatedEntityId: reqId
      }))
    }
    return { message: 'Requisition rejected', status: 'Rejected' }
  }

  // Approving: items array must be non-empty and every row must have desc + qty + price.
  const safeItems = Array.isArray(items) ? items : []
  if (!safeItems.length) {
    return { error: 'At least one item is required. Please add items with description, quantity, and unit price.', status: 400 }
  }
  for (const it of safeItems) {
    const desc = String(it.itemDesc ?? it.item_desc ?? '').trim()
    const qty = parseInt(it.itemQty ?? it.item_qty ?? 0, 10)
    const costStr = String(it.itemEstCost ?? it.item_est_cost ?? '').trim()
    const cost = parseNumericCostPkr(costStr)
    if (!desc) return { error: 'Every item must have a description', status: 400 }
    if (!Number.isFinite(qty) || qty <= 0) return { error: 'Every item must have a positive quantity', status: 400 }
    if (cost == null || cost < 0) return { error: 'Every item must have a valid unit price (PKR)', status: 400 }
  }

  await reqRepo.replaceRequisitionItems(reqId, safeItems)
  await refreshRequisitionItemTaxes(reqId)
  await reqRepo.approveIt(reqId, eid)

  // Advance to next configured stage (typically Committee for IT Equipments).
  const categoryName = reqRow[0]?.req_category
  const nextKey = categoryName ? await reqRepo.getNextStageKey(categoryName, 'it') : null
  const resolvedNext = nextKey || 'committee'
  await setCurrentStage(reqId, resolvedNext)
  if (VALID_BUCKETS.includes(resolvedNext)) {
    await notifyBucketChanged(reqId, resolvedNext)
    notifSvc.notifySafe(inAppNotifyRequisitionBucket(reqId, resolvedNext, reqRow[0]?.department_id))
  }
  const statusLabel = resolvedNext === 'committee' ? 'Pending Committee'
    : resolvedNext === 'ceo' ? 'Pending CEO'
    : resolvedNext === 'procurement' ? 'Forwarded to Procurement'
    : resolvedNext === 'finance' ? 'Pending Finance'
    : `Pending ${resolvedNext}`
  return { message: 'IT review recorded; items saved and forwarded.', status: statusLabel }
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

export async function getPendingHRCheck(employeeId) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return []
  const useFlow = (await reqRepo.getFlowStages()).length > 0
  const ok = useFlow ? await reqRepo.isEmployeeTypeForStage(eid, 'hr') : await reqRepo.isHrMember(eid)
  if (!ok) return []
  const rows = await reqRepo.getPendingRequisitionsByCurrentStage('hr_check')
  const reqIds = rows.map(r => r.req_id)
  const items = reqIds.length ? await reqRepo.getItemsByReqIds(reqIds) : []
  return rows.map(req => ({ ...req, status: 'Pending HR Check', items: items.filter(i => i.req_id === req.req_id) }))
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
  const { requisitionId, approved, hrApprovedAmount, hrEmploymentStatus, hrApprovedInstallments } = body
  const reqId = requisitionId != null ? parseInt(requisitionId, 10) : null
  const eid = await resolveApproverEmployeeId(body)
  if (reqId == null || Number.isNaN(reqId) || eid == null) {
    return { error: 'Valid requisitionId and approvedByEmployeeId or approvedByEmployeeCode are required', status: 400 }
  }
  const useFlow = (await reqRepo.getFlowStages()).length > 0
  const ok = useFlow ? await reqRepo.isEmployeeTypeForStage(eid, 'hr') : await reqRepo.isHrMember(eid)
  if (!ok) {
    return { error: 'Only HR can approve this stage. Check your Employee Type or Designation.', status: 403 }
  }
  // Stage guard: don't act on a requisition parked at another stage. NULL is allowed — legacy
  // Loan & Advance rows sit in the HR bucket via the approval-flag fallback (getPendingHR).
  const hrStageRow = await reqRepo.getRequisitionAndDepartment(reqId)
  if (!hrStageRow.length) return { error: 'Requisition not found', status: 404 }
  if (hrStageRow[0].req_current_stage_key != null && hrStageRow[0].req_current_stage_key !== 'hr') {
    return { error: `Requisition is not at the HR stage (current: ${hrStageRow[0].req_current_stage_key})`, status: 400 }
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

  if (hrApprovedAmount != null) {
    const amt = parseFloat(String(hrApprovedAmount).replace(/,/g, ''))
    if (!isNaN(amt) && amt > 0) await reqRepo.saveHrApprovedAmount(reqId, amt)
  }
  if (hrEmploymentStatus && ['Permanent', 'Not Confirmed'].includes(String(hrEmploymentStatus).trim())) {
    await reqRepo.saveHrEmploymentStatus(reqId, String(hrEmploymentStatus).trim())
  }
  if (hrApprovedInstallments != null) {
    const inst = parseInt(String(hrApprovedInstallments), 10)
    if (!isNaN(inst) && inst > 0) await reqRepo.saveHrApprovedInstallments(reqId, inst)
  }
  const reqRow = await reqRepo.getRequisitionAndDepartment(reqId)
  const categoryName = reqRow[0]?.req_category
  let nextKey = categoryName ? await reqRepo.getNextStageKey(categoryName, 'hr') : 'committee'
  // Loan & Advance Salary: every request goes through CEO after HR, regardless of amount.
  if (isCategoryHrAfterHod(categoryName)) {
    nextKey = 'ceo'
  }
  await setCurrentStage(reqId, nextKey || 'committee')
  await notifyBucketChanged(reqId, nextKey || 'committee')
  const bucketAfterHr = nextKey || 'committee'
  const deptIdHr = reqRow[0]?.department_id
  notifSvc.notifySafe(inAppNotifyRequisitionBucket(reqId, bucketAfterHr, deptIdHr))
  return { 
    message: 'HR approval recorded', 
    status: nextKey === 'ceo' ? 'Pending CEO' 
          : nextKey === 'finance' ? 'Pending Finance' 
          : nextKey === 'hr_check' ? 'Pending HR Check'
          : nextKey === 'committee' ? 'Pending Committee' 
          : `Pending ${nextKey}` 
  }
}

/**
 * Save HR "Section 3" fields without advancing the approval stage (Loan & Advance Salary).
 * Lets HR edit + Save Section 3 and have it persist on close/reopen, before approving.
 */
export async function saveHrSection3(body) {
  const { requisitionId } = body
  const reqId = requisitionId != null ? parseInt(requisitionId, 10) : null
  const eid = await resolveApproverEmployeeId(body)
  if (reqId == null || Number.isNaN(reqId) || eid == null) {
    return { error: 'Valid requisitionId and approvedByEmployeeId or approvedByEmployeeCode are required', status: 400 }
  }
  const useFlow = (await reqRepo.getFlowStages()).length > 0
  const ok = useFlow ? await reqRepo.isEmployeeTypeForStage(eid, 'hr') : await reqRepo.isHrMember(eid)
  if (!ok) {
    return { error: 'Only HR can edit this section. Check your Employee Type or Designation.', status: 403 }
  }

  const fields = {}
  // Approved amount + outstanding loan: keep digits only, store as number (null clears).
  if (body.approvedAmount !== undefined) {
    const amt = parseFloat(String(body.approvedAmount).replace(/[^0-9.]/g, ''))
    fields.approvedAmount = Number.isFinite(amt) && amt > 0 ? amt : null
  }
  if (body.outstandingLoan !== undefined) {
    const out = parseFloat(String(body.outstandingLoan).replace(/[^0-9.]/g, ''))
    fields.outstandingLoan = Number.isFinite(out) && out > 0 ? out : null
  }
  if (body.approvedInstallments !== undefined) {
    const inst = parseInt(String(body.approvedInstallments), 10)
    fields.approvedInstallments = Number.isFinite(inst) && inst > 0 ? inst : null
  }
  if (body.employmentStatus !== undefined) {
    const s = String(body.employmentStatus).trim()
    fields.employmentStatus = ['Permanent', 'Not Confirmed'].includes(s) ? s : null
  }
  if (body.loanStatus !== undefined) {
    const s = String(body.loanStatus).trim()
    fields.loanStatus = ['approved', 'not_approved'].includes(s) ? s : null
  }
  if (body.installmentStartDate !== undefined) {
    const d = String(body.installmentStartDate).trim()
    fields.installmentStartDate = d || null
  }

  await reqRepo.saveHrSection3(reqId, fields)
  return { message: 'HR section saved', status: 200 }
}

export async function approveHRCheck(body) {
  const { requisitionId, approved } = body
  const reqId = requisitionId != null ? parseInt(requisitionId, 10) : null
  const eid = await resolveApproverEmployeeId(body)
  if (reqId == null || Number.isNaN(reqId) || eid == null) {
    return { error: 'Valid requisitionId and approvedByEmployeeId or approvedByEmployeeCode are required', status: 400 }
  }

  const useFlow = (await reqRepo.getFlowStages()).length > 0
  const ok = useFlow ? await reqRepo.isEmployeeTypeForStage(eid, 'hr') : await reqRepo.isHrMember(eid)
  if (!ok) {
    return { error: 'Only HR can approve this stage.', status: 403 }
  }

  if (approved === false) {
    const reason = body.rejectionReason != null ? String(body.rejectionReason).trim() : ''
    if (!reason) return { error: 'Rejection reason is required.', status: 400 }
    const creatorId = await notifRepo.getRequisitionCreatorId(reqId)
    await rejectWithReason(reqId, reason, eid, 'hr_check')
    if (creatorId) {
      notifSvc.notifySafe(notifSvc.notify({
        recipientEmployeeId: creatorId,
        type: 'requisition_rejected',
        title: 'Requisition rejected by HR (Check)',
        body: `Your requisition was rejected by HR at check stage. Reason: ${reason}`,
        url: '/requisition/history',
        relatedEntityType: 'requisition',
        relatedEntityId: reqId
      }))
    }
    return { message: 'Requisition rejected', status: 'Rejected' }
  }

  // Approved: HR check done, go to creator acknowledgment
  await reqRepo.approveHrCheck(reqId, eid)

  try {
    const stages = await reqRepo.getFlowStages()
    if (stages && stages.length > 0) await reqRepo.setRequisitionCurrentStage(reqId, null)
  } catch (_) {}

  notifyCreatorAckRequired(reqId).catch((e) => console.error('notifyCreatorAckRequired after HR Check:', e?.message))

  const creatorId = await notifRepo.getRequisitionCreatorId(reqId)
  if (creatorId) {
    notifSvc.notifySafe(notifSvc.notify({
      recipientEmployeeId: creatorId,
      type: 'requisition_hr_check_approved',
      title: 'Check received by HR',
      body: 'HR has confirmed check received. Please acknowledge.',
      url: '/requisition/acknowledgment',
      relatedEntityType: 'requisition',
      relatedEntityId: reqId
    }))
  }

  return { message: 'HR check recorded. Forwarded to creator for acknowledgment.', status: 'Pending Acknowledgment' }
}

/** Fire-and-forget: email CEO employees that committee has approved a requisition (informational — no action required). */
function notifyCeoCommitteeApproved(reqId, forwardedTo) {
  ;(async () => {
    try {
      const toEmails = await getEmailsForBucket('ceo', null)
      if (!toEmails.length) return
      const rows = await executeQuery(
        `SELECT r.req_reference_no, r.req_material, e.first_name, e.last_name
         FROM requisition r JOIN employees e ON r.req_emp_id = e.employee_id
         WHERE r.req_id = $1`,
        [reqId]
      )
      const r = rows[0]
      if (!r) return
      const refNo = r.req_reference_no || `#${reqId}`
      const creatorName = `${r.first_name || ''} ${r.last_name || ''}`.trim() || 'Employee'
      const material = (r.req_material || '').trim() || '—'
      const nextLabel = forwardedTo === 'procurement' ? 'Procurement' : forwardedTo === 'finance' ? 'Finance' : forwardedTo
      const subject = `Requisition ${refNo} — Approved by Committee`
      const body = [
        `This is an informational notification.`,
        ``,
        `Requisition ${refNo} (${material}) submitted by ${creatorName} has been approved by the Committee.`,
        `It has been forwarded to ${nextLabel}.`,
        ``,
        `No action is required from you.`
      ].join('\n')
      await sendRequisitionReminder({ to: toEmails.join(','), subject, body, meta: { event: 'committee_approved_ceo_notify', ref: refNo } })
    } catch (err) {
      console.error('[CEO notify] committee approved email failed:', err.message)
    }
  })()
}

/** Fire-and-forget: email CEO that a requisition >= 100K is pending their approval (action required). */
function notifyCeoApprovalRequired(reqId, totalPkr) {
  ;(async () => {
    try {
      const toEmails = await getEmailsForBucket('ceo', null)
      if (!toEmails.length) return
      const rows = await executeQuery(
        `SELECT r.req_reference_no, r.req_material, e.first_name, e.last_name
         FROM requisition r JOIN employees e ON r.req_emp_id = e.employee_id
         WHERE r.req_id = $1`,
        [reqId]
      )
      const r = rows[0]
      if (!r) return
      const refNo = r.req_reference_no || `#${reqId}`
      const creatorName = `${r.first_name || ''} ${r.last_name || ''}`.trim() || 'Employee'
      const material = (r.req_material || '').trim() || '—'
      const amountStr = totalPkr != null ? `PKR ${Number(totalPkr).toLocaleString()}` : 'above threshold'
      const subject = `Action Required: Requisition ${refNo} Pending CEO Approval`
      const body = [
        `A requisition requiring your approval has been approved by the Committee.`,
        ``,
        `Reference : ${refNo}`,
        `Description: ${material}`,
        `Submitted By: ${creatorName}`,
        `Total Amount: ${amountStr}`,
        ``,
        `This requisition exceeds PKR ${REQUISITION_CEO_MIN_AMOUNT_PKR.toLocaleString()} and requires CEO approval before it can proceed to Procurement.`,
        ``,
        `Please log in to the Employee Portal to approve or reject this requisition.`
      ].join('\n')
      await sendRequisitionReminder({ to: toEmails.join(','), subject, body, meta: { event: 'committee_approved_ceo_action_required', ref: refNo } })
    } catch (err) {
      console.error('[CEO notify] action required email failed:', err.message)
    }
  })()
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
  // Stage guard: don't act on a requisition parked at another stage. NULL is allowed — legacy
  // rows sit in the Committee bucket via the approval-flag fallback (getPendingCommittee).
  const commStageRow = await reqRepo.getRequisitionAndDepartment(reqId)
  if (!commStageRow.length) return { error: 'Requisition not found', status: 404 }
  if (commStageRow[0].req_current_stage_key != null && commStageRow[0].req_current_stage_key !== 'committee') {
    return { error: `Requisition is not at the Committee stage (current: ${commStageRow[0].req_current_stage_key})`, status: 400 }
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
  await refreshRequisitionItemTaxes(reqId)
  await reqRepo.approveCommittee(reqId, eid)

  const reqRow = await reqRepo.getRequisitionAndDepartment(reqId)
  const categoryName = reqRow[0]?.req_category
  const stages = await reqRepo.getFlowStages()
  const nextKeyFromFlow = categoryName && stages.length > 0 ? await reqRepo.getNextStageKey(categoryName, 'committee') : null

  // Amount >= 100K ALWAYS requires CEO approval — this overrides any category flow routing.
  const itemsAfter = await reqRepo.getRequisitionItems(reqId)
  const totalAfterCommittee = computeCommitteeApprovedLineTotalPKR(itemsAfter)
  if (totalAfterCommittee >= REQUISITION_CEO_MIN_AMOUNT_PKR) {
    await setCurrentStage(reqId, 'ceo')
    await notifyBucketChanged(reqId, 'ceo')
    notifSvc.notifySafe(inAppNotifyRequisitionBucket(reqId, 'ceo', reqRow[0]?.department_id))
    notifyCeoApprovalRequired(reqId, totalAfterCommittee)
    return { message: 'Committee approval recorded', status: 'Pending CEO' }
  }

  // Amount < 100K: follow category flow if defined (e.g. Devices/Accessories → Finance).
  if (nextKeyFromFlow && nextKeyFromFlow !== 'ceo') {
    await setCurrentStage(reqId, nextKeyFromFlow)
    await notifyBucketChanged(reqId, nextKeyFromFlow)
    const deptRow = await reqRepo.getRequisitionAndDepartment(reqId)
    notifSvc.notifySafe(inAppNotifyRequisitionBucket(reqId, nextKeyFromFlow, deptRow[0]?.department_id))
    notifyCeoCommitteeApproved(reqId, nextKeyFromFlow)
    const statusLabel = nextKeyFromFlow === 'finance' ? 'Pending Finance Approval' : nextKeyFromFlow === 'procurement' ? 'Forwarded to Procurement' : `Pending ${nextKeyFromFlow}`
    return { message: 'Committee approval recorded', status: statusLabel }
  }

  // Amount < 100K and no category-specific routing: skip CEO → Procurement.
  await reqRepo.approveCeo(reqId, eid)
  await setCurrentStage(reqId, 'procurement')
  await notifyBucketChanged(reqId, 'procurement')
  notifSvc.notifySafe(inAppNotifyRequisitionBucket(reqId, 'procurement', reqRow[0]?.department_id))
  notifyCeoCommitteeApproved(reqId, 'procurement')
  return { message: `Committee approval recorded; forwarded to Procurement (line total under ${REQUISITION_CEO_MIN_AMOUNT_PKR.toLocaleString()} PKR — CEO stage skipped)`, status: 'Forwarded to Procurement' }
}

/** Auto-approve CEO and move to Procurement when line total is under threshold (same rule as Committee approve). */
async function applyCeoSkipToProcurementIfUnderThreshold(reqId, approverEid) {
  const lineItems = await reqRepo.getRequisitionItems(reqId)
  const lineTotal = computeCommitteeApprovedLineTotalPKR(lineItems)
  if (lineTotal >= REQUISITION_CEO_MIN_AMOUNT_PKR) return false
  await reqRepo.approveCeo(reqId, approverEid ?? null)
  await setCurrentStage(reqId, 'procurement')
  await notifyBucketChanged(reqId, 'procurement')
  const deptRow = await reqRepo.getRequisitionAndDepartment(reqId)
  notifSvc.notifySafe(inAppNotifyRequisitionBucket(reqId, 'procurement', deptRow[0]?.department_id))
  return true
}

/**
 * Loan & Advance Salary anomaly repair: detects loans stuck in the 'ceo' bucket whose
 * actual data shows they've already moved past CEO (either CEO is already approved, or
 * Finance is already approved which implies CEO must be past). Auto-fixes by marking
 * CEO approved if needed and forwarding the stage to whichever downstream bucket the
 * existing flags indicate (finance / hr_check / null).
 * Returns true if a repair was applied (caller should skip the row from the CEO list).
 */
async function repairLoanCeoIfStuck(row) {
  if (!row) return false
  if (!isCategoryHrAfterHod(row.req_category)) return false
  const ceoApproved = Number(row.req_ceo_approval) === 1
  const financeApproved = Number(row.req_finance_approval) === 1
  // Only repair when the row's actual flags say it's past the CEO stage.
  if (!ceoApproved && !financeApproved) return false
  const reqId = row.req_id
  if (!ceoApproved) {
    await reqRepo.approveCeo(reqId, null)
  }
  let nextStage
  if (Number(row.req_creator_acknowledged) === 1) nextStage = null
  else if (row.req_hr_check_approved_by != null) nextStage = null
  else if (financeApproved) nextStage = 'hr_check'
  else nextStage = 'finance'
  await reqRepo.setRequisitionCurrentStage(reqId, nextStage)
  if (nextStage) {
    await notifyBucketChanged(reqId, nextStage)
    const deptRow = await reqRepo.getRequisitionAndDepartment(reqId)
    notifSvc.notifySafe(inAppNotifyRequisitionBucket(reqId, nextStage, deptRow[0]?.department_id))
  }
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
    // Loan & Advance Salary: if CEO/Finance already approved but stage still 'ceo', repair and skip.
    if (await repairLoanCeoIfStuck(r)) continue
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
  // Match the role gate used by getPendingCeo: prefer the flow-stage employee type, fall back to
  // the legacy CEO-member check. (Local name avoids colliding with the `useFlow` declared below.)
  const ceoUseFlow = (await reqRepo.getFlowStages()).length > 0
  const ok = ceoUseFlow ? await reqRepo.isEmployeeTypeForStage(eid, 'ceo') : await reqRepo.isCeoMember(eid)
  if (!ok) {
    return { error: 'Only CEO can approve. Check your Employee Type or Designation in Administration.', status: 403 }
  }
  // Stage guard: don't act on a requisition explicitly parked at another stage (prevents
  // stage-skipping). NULL stage is allowed — legacy rows sit in the CEO bucket via the
  // approval-flag fallback that getPendingCeo also honors.
  const ceoStageRow = await reqRepo.getRequisitionAndDepartment(reqId)
  if (!ceoStageRow.length) return { error: 'Requisition not found', status: 404 }
  if (ceoStageRow[0].req_current_stage_key != null && ceoStageRow[0].req_current_stage_key !== 'ceo') {
    return { error: `Requisition is not at the CEO stage (current: ${ceoStageRow[0].req_current_stage_key})`, status: 400 }
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
  await reqRepo.approveCeo(reqId, eid)
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
  // Stage guard (strict): the Admin bucket has no NULL fallback — getPendingAdmin only returns
  // rows whose stage is exactly 'admin', so anything else (incl. NULL) must not be acted on here.
  const admStageRow = await reqRepo.getRequisitionAndDepartment(reqId)
  if (!admStageRow.length) return { error: 'Requisition not found', status: 404 }
  if (admStageRow[0].req_current_stage_key !== 'admin') {
    return { error: `Requisition is not at the Admin stage (current: ${admStageRow[0].req_current_stage_key || 'none'})`, status: 400 }
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
  const reqRowForCat = await reqRepo.getRequisitionAndDepartment(reqId)
  const adminCategoryName = reqRowForCat[0]?.req_category
  const adminCat = adminCategoryName ? await reqRepo.getRequisitionCategoryByName(adminCategoryName) : null
  await reqRepo.approveAdmin(reqId)
  if (adminCat && adminCat.execution_admin === 1) {
    // execution_admin categories (e.g. Stationary): Admin must acknowledge and hand over before creator can ack
    await setCurrentStage(reqId, 'admin_acknowledge')
    await notifyBucketChanged(reqId, 'admin_acknowledge')
    notifSvc.notifySafe(inAppNotifyRequisitionBucket(reqId, 'admin_acknowledge', reqRowForCat[0]?.department_id))
    return { message: 'Admin approval recorded. Proceed to acknowledge and hand over.', status: 'Pending Admin Acknowledge' }
  }
  // Non-execution_admin: stage is already NULL from approveAdmin; notify creator directly.
  notifyCreatorAckRequired(reqId).catch((e) => console.error('notifyCreatorAckRequired after Admin:', e?.message))
  const creatorAdm = await notifRepo.getRequisitionCreatorId(reqId)
  if (creatorAdm) {
    notifSvc.notifySafe(notifSvc.notify({
      recipientEmployeeId: creatorAdm,
      type: 'requisition_ready_for_receipt',
      title: 'Admin approved your requisition',
      body: 'Your requisition has been approved by Admin. Please acknowledge in the portal.',
      url: '/requisition/acknowledgment',
      relatedEntityType: 'requisition',
      relatedEntityId: reqId
    }))
  }
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

export async function uploadSupportDocs(reqId, files, updatedByEmployeeId, updatedByEmployeeCode) {
  const reqIdNum = parseInt(reqId, 10)
  if (Number.isNaN(reqIdNum)) return { error: 'Valid requisition ID required', status: 400 }
  const eid = await resolveApproverEmployeeId({ approvedByEmployeeId: updatedByEmployeeId, approvedByEmployeeCode: updatedByEmployeeCode })
  if (eid == null) return { error: 'Valid updatedByEmployeeId or updatedByEmployeeCode required', status: 400 }
  const ok = await reqRepo.isProcurementMember(eid)
  if (!ok) return { error: 'Only Procurement can add supporting documents', status: 403 }
  const rows = await reqRepo.getRequisitionForSupportDocs(reqIdNum)
  if (!rows.length) return { error: 'Requisition not found or not acknowledged', status: 404 }
  const { fileToDataUrl } = await import('../utils/file.utils.js')
  const d1 = files.supportDoc1?.[0]
  const d2 = files.supportDoc2?.[0]
  const d3 = files.supportDoc3?.[0]
  if (!d1 || !d2 || !d3) {
    return { error: 'Upload all 3 supporting documents (supportDoc1, supportDoc2, supportDoc3)', status: 400 }
  }
  const dataUrl1 = fileToDataUrl(d1)
  const dataUrl2 = fileToDataUrl(d2)
  const dataUrl3 = fileToDataUrl(d3)
  if (!dataUrl1 || !dataUrl2 || !dataUrl3) {
    return { error: 'Could not read uploaded document data', status: 400 }
  }
  await reqRepo.updateSupportDocsUpload(reqIdNum, dataUrl1, dataUrl2, dataUrl3)
  return {
    message: 'Supporting documents uploaded',
    supportDoc1Url: dataUrl1,
    supportDoc2Url: dataUrl2,
    supportDoc3Url: dataUrl3
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
  // Allow editing if: (1) not yet approved by HOD, OR (2) was reverted back to HOD
  const canEdit = row.req_hod_approval !== 1 || row.has_been_reverted === 1
  if (!canEdit) {
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
  await refreshRequisitionItemTaxes(reqIdNum)
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
  const canDelete = row.req_hod_approval !== 1 || row.has_been_reverted === 1
  if (!canDelete) {
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
  const canAdd = row.req_hod_approval !== 1 || row.has_been_reverted === 1
  if (!canAdd) {
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
  await refreshRequisitionItemTaxes(reqIdNum)
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

/** Admin: list requisitions pending admin acknowledgment (admin_acknowledge stage). */
export async function getPendingAdminAcknowledge(employeeId) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return { error: 'Valid employee ID is required', status: 400 }
  const ok = await reqRepo.isAdminMember(eid)
  if (!ok) return []
  const rows = await reqRepo.getPendingRequisitionsByCurrentStage('admin_acknowledge')
  const reqIds = rows.map(r => r.req_id)
  const items = reqIds.length ? await reqRepo.getItemsByReqIds(reqIds) : []
  return rows.map(req => ({ ...req, status: 'Pending Admin Acknowledge', items: items.filter(i => i.req_id === req.req_id) }))
}

/** Admin acknowledges items are ready — advances stage from admin_acknowledge → admin_handover. */
export async function acknowledgeAdminStage(body) {
  const { requisitionId } = body
  const reqId = requisitionId != null ? parseInt(requisitionId, 10) : null
  const eid = await resolveApproverEmployeeId({ approvedByEmployeeId: body.acknowledgedByEmployeeId, approvedByEmployeeCode: body.acknowledgedByEmployeeCode })
  if (reqId == null || Number.isNaN(reqId) || eid == null) {
    return { error: 'Valid requisitionId and acknowledgedByEmployeeId or acknowledgedByEmployeeCode are required', status: 400 }
  }
  const ok = await reqRepo.isAdminMember(eid)
  if (!ok) return { error: 'Only Admin can acknowledge at this stage', status: 403 }
  const rows = await reqRepo.getRequisitionForAdminAcknowledge(reqId)
  if (!rows.length) return { error: 'Requisition not found or not in Admin Acknowledge stage', status: 404 }
  await reqRepo.updateAdminAcknowledged(reqId)
  const reqRow = await reqRepo.getRequisitionAndDepartment(reqId)
  await notifyBucketChanged(reqId, 'admin_handover')
  notifSvc.notifySafe(inAppNotifyRequisitionBucket(reqId, 'admin_handover', reqRow[0]?.department_id))
  return { message: 'Admin acknowledged. Ready for handover.', status: 'Pending Admin Handover' }
}

/** Admin: list requisitions pending handover to creator (admin_handover stage). */
export async function getPendingAdminHandover(employeeId) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return { error: 'Valid employee ID is required', status: 400 }
  const ok = await reqRepo.isAdminMember(eid)
  if (!ok) return []
  const rows = await reqRepo.getPendingRequisitionsByCurrentStage('admin_handover')
  const reqIds = rows.map(r => r.req_id)
  const items = reqIds.length ? await reqRepo.getItemsByReqIds(reqIds) : []
  return rows.map(req => ({ ...req, status: 'Pending Admin Handover', items: items.filter(i => i.req_id === req.req_id) }))
}

/** Admin hands items over to creator — advances stage from admin_handover → NULL. Creator can now acknowledge. */
export async function handoverByAdmin(body) {
  const { requisitionId } = body
  const reqId = requisitionId != null ? parseInt(requisitionId, 10) : null
  const eid = await resolveApproverEmployeeId({ approvedByEmployeeId: body.handedByEmployeeId, approvedByEmployeeCode: body.handedByEmployeeCode })
  if (reqId == null || Number.isNaN(reqId) || eid == null) {
    return { error: 'Valid requisitionId and handedByEmployeeId or handedByEmployeeCode are required', status: 400 }
  }
  const ok = await reqRepo.isAdminMember(eid)
  if (!ok) return { error: 'Only Admin can perform handover', status: 403 }
  const rows = await reqRepo.getRequisitionForAdminHandover(reqId)
  if (!rows.length) return { error: 'Requisition not found or not in Admin Handover stage', status: 404 }
  await reqRepo.updateAdminHandover(reqId)
  notifyCreatorAckRequired(reqId).catch((e) => console.error('notifyCreatorAckRequired after Admin Handover:', e?.message))
  const creatorId = await notifRepo.getRequisitionCreatorId(reqId)
  if (creatorId) {
    notifSvc.notifySafe(notifSvc.notify({
      recipientEmployeeId: creatorId,
      type: 'requisition_ready_for_receipt',
      title: 'Items handed over by Admin',
      body: 'Admin has handed over your items. Please acknowledge receipt in the portal.',
      url: '/requisition/acknowledgment',
      relatedEntityType: 'requisition',
      relatedEntityId: reqId
    }))
  }
  return { message: 'Admin handover complete. Creator can now acknowledge.', status: 'Pending Creator Acknowledgment' }
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
    if (!rows[0].req_forwarded_to_payable_at) {
      return { error: 'Forward invoice to payable team before marking complete', status: 400 }
    }
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
      const rows = await reqRepo.getPendingHodAcknowledgeList(deptId, deptName, eid)
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
  const [hod, hr, admin, committee, ceo, procurement, finance, hodAck, adminExec, adminAck, adminHo, creatorAck, it] = await Promise.all([
    getPendingHod(employeeId),
    getPendingHR(employeeId),
    getPendingHRCheck(employeeId),
    getPendingAdmin(employeeId),
    getPendingCommittee(employeeId),
    getPendingCeo(employeeId),
    getPendingProcurement(employeeId),
    getPendingFinance(employeeId),
    getPendingHodAcknowledge(employeeId),
    getPendingAdminExecution(employeeId),
    getPendingAdminAcknowledge(employeeId),
    getPendingAdminHandover(employeeId),
    getPendingCreatorAcknowledge(employeeId),
    getPendingIt(employeeId)
  ])
  const count = f(hod) + f(hr) + f(admin) + f(committee) + f(ceo) + f(procurement) + f(finance) + f(hodAck) + f(adminExec) + f(adminAck) + f(adminHo) + f(creatorAck) + f(it)
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
    status: 'Awaiting Acceptance',
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
    if (!ok) ok = await reqRepo.isFinanceHod(eid)
  } else {
    ok = await reqRepo.isFinanceHod(eid)
  }
  if (!ok) return []

  // Finance-stage pending
  const financeRows = await reqRepo.getPendingRequisitionsByCurrentStage('finance')

  // Also include HOD-stage pending for Finance person's own department(s)
  const hodDepartments = await reqRepo.getHodDepartmentsForEmployee(eid)
  let hodRows = []
  for (const dept of hodDepartments) {
    const deptId = dept.department_id
    const deptName = (dept.department_name || '').trim().toLowerCase()
    try {
      // Exclude the viewing HOD's own requisitions (separation of duties); other HODs still see them.
      const rows = await reqRepo.getPendingRequisitionsByCurrentStage('hod', { departmentId: deptId, departmentName: deptName, excludeEmployeeId: eid }) || []
      hodRows = hodRows.concat(rows)
    } catch (_) {}
  }

  // Merge and deduplicate by req_id
  const seen = new Set()
  const merged = []
  for (const r of financeRows) {
    if (!seen.has(r.req_id)) { seen.add(r.req_id); merged.push({ ...r, status: 'Pending Finance Approval' }) }
  }
  for (const r of hodRows) {
    if (!seen.has(r.req_id)) { seen.add(r.req_id); merged.push(r) }
  }

  const reqIds = merged.map(r => r.req_id)
  const items = reqIds.length ? await reqRepo.getItemsByReqIds(reqIds) : []
  return merged.map(req => ({
    ...req,
    status: req.status || getRequisitionStatus(req),
    items: items.filter(i => i.req_id === req.req_id)
  }))
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
  const deptFin = await reqRepo.getRequisitionAndDepartment(reqId)
  if (isLoan) {
    // Loan & Advance Salary: after Finance approval, route straight to HR Cheque Receiving.
    // (Manager of Finance stage removed.) Employee acknowledgment follows HR Cheque Receiving.
    await setCurrentStage(reqId, 'hr_check')
    await notifyBucketChanged(reqId, 'hr_check')
    notifSvc.notifySafe(inAppNotifyRequisitionBucket(reqId, 'hr_check', deptFin[0]?.department_id))

    // Fire-and-forget email to Payable + Receivable, CC HR. PDF is generated server-side
    // from the requisition data, so this works regardless of which approval path was used.
    sendLoanFinanceApprovedEmail(reqId).catch((e) =>
      console.error('📧 [Loan Finance Approved] email failed:', e?.message)
    )
  } else {
    // Normal category: set stage to procurement so it appears in their bucket
    await setCurrentStage(reqId, 'procurement')
    await notifyBucketChanged(reqId, 'procurement')
    notifSvc.notifySafe(inAppNotifyRequisitionBucket(reqId, 'procurement', deptFin[0]?.department_id))
  }
  return {
    message: isLoan
      ? 'Finance approved (Loan). Forwarded to HR for Cheque Receiving.'
      : 'Finance approved; quotation selected. Forwarded to Procurement for purchase.',
    status: isLoan ? 'Pending HR Cheque Receiving' : 'Finance Approved - Ready for Purchase'
  }
}

/**
 * Send the Loan/Advance approval email to Payable + Receivable (CC HR).
 * The Loan / Advance Salary form PDF is generated server-side from the requisition
 * data (see loanFormPdf.service.js) and attached.
 */
export async function sendLoanFinanceApprovedEmail(reqId) {
  // SELECT r.* so optional columns (req_hr_approved_installments, req_employment_status, …)
  // come back as undefined when the corresponding migration has not been applied,
  // instead of throwing 42703 and killing the email.
  const reqRow = await executeQuery(
    `SELECT r.*,
            e.first_name, e.last_name, e.employee_code,
            d.department_name
       FROM requisition r
       JOIN employees e ON r.req_emp_id = e.employee_id
       LEFT JOIN departments d ON e.department_id = d.department_id
      WHERE r.req_id = $1`,
    [reqId]
  )
  if (!reqRow.length) return
  const row = reqRow[0]

  const isLoanType = String(row.loan_advance_type || '').toLowerCase() === 'loan'
  const amount = Number(row.req_hr_approved_amount || row.loan_advance_amount || 0)
  const installments = row.req_hr_approved_installments || row.loan_installment_months || 1
  const monthly = amount ? Math.ceil(amount / installments) : 0
  const refNo = row.req_reference_no || `REQ-${row.req_id}`
  const empName = `${row.first_name || ''} ${row.last_name || ''}`.trim() || row.employee_code

  // Build the PDF server-side from the requisition data — no dependence on the
  // frontend capture, so this works for every approval path (modal button, inline
  // approve button, or programmatic).
  const attachments = []
  try {
    const { buildLoanFormPdfBuffer } = await import('./loanFormPdf.service.js')
    const pdfBuffer = await buildLoanFormPdfBuffer(reqId)
    if (pdfBuffer) {
      attachments.push({
        filename: `LoanForm-${row.employee_code || 'emp'}-${refNo}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf'
      })
      console.log(`📄 [Loan Finance Email] PDF generated (${pdfBuffer.length} bytes)`)
    } else {
      console.warn('📄 [Loan Finance Email] buildLoanFormPdfBuffer returned null — sending without PDF.')
    }
  } catch (err) {
    console.error('📄 [Loan Finance Email] PDF generation failed:', err?.message)
  }

  const subject = `[Action Required] ${isLoanType ? 'Loan' : 'Advance Salary'} ${refNo} — Finance Approved`
  const html = `<p>Dear Payable / Receivable Team,</p>
<p>Finance has approved the following ${isLoanType ? 'Loan' : 'Advance Salary'} request. It now sits with <strong>HR for Cheque Receiving</strong>.</p>
<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px">
  <tr><td style="padding:4px 12px 4px 0"><strong>Reference</strong></td><td>${refNo}</td></tr>
  <tr><td style="padding:4px 12px 4px 0"><strong>Type</strong></td><td>${isLoanType ? 'Loan' : 'Advance Salary'}</td></tr>
  <tr><td style="padding:4px 12px 4px 0"><strong>Employee</strong></td><td>${empName} (${row.employee_code || '—'})</td></tr>
  <tr><td style="padding:4px 12px 4px 0"><strong>Department</strong></td><td>${row.department_name || '—'}</td></tr>
  <tr><td style="padding:4px 12px 4px 0"><strong>Employment Status</strong></td><td>${row.req_employment_status || '—'}</td></tr>
  <tr><td style="padding:4px 12px 4px 0"><strong>Approved Amount</strong></td><td>PKR ${amount.toLocaleString()}</td></tr>
  ${isLoanType ? `<tr><td style="padding:4px 12px 4px 0"><strong>Installments</strong></td><td>${installments}</td></tr>
  <tr><td style="padding:4px 12px 4px 0"><strong>Monthly Deduction</strong></td><td>PKR ${monthly.toLocaleString()}</td></tr>` : ''}
</table>
<p>${attachments.length ? 'The signed loan form (PDF) is attached.' : 'PDF attachment not available for this requisition.'}</p>
<p style="color:#6b7280;font-size:12px">Automated notification — Requisition Management System.</p>`

  try {
    const { getEmailTransport, EMAIL_FROM, PAYABLE_EMAIL, RECEIVABLE_EMAIL, HR_EMAIL } = await import('../../config/email.js')
    const trans = getEmailTransport()
    if (!trans) {
      console.warn('📧 [Loan Finance Approved] SMTP not configured; email skipped.')
      return
    }
    const to = `${PAYABLE_EMAIL}, ${RECEIVABLE_EMAIL}`
    const cc = HR_EMAIL
    console.log(`📧 [Loan Finance Approved] Sending: to=${to} | cc=${cc} | attachments=${attachments.length}`)
    const info = await trans.sendMail({
      from: EMAIL_FROM,
      to,
      cc,
      subject,
      html,
      attachments
    })
    console.log(`📧 [Loan Finance Approved] SMTP response for ${refNo}:`, JSON.stringify({
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
      response: info.response
    }))
  } catch (err) {
    console.error('📧 [Loan Finance Approved] send failed:', err.message)
  }
}

function formatDatePKT(date) {
  if (!date) return '—'
  try {
    return new Date(date).toLocaleString('en-PK', {
      timeZone: 'Asia/Karachi',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).replace(',', '')
  } catch (_) { return String(date) }
}

function buildAuditReportHtml(row, items, forwardedByName, creatorCrmEmail) {
  const approvedIdx = row.req_approved_quotation_index
  const quotationStatus = (i) => i === approvedIdx
    ? '<span style="color:#16a34a;font-weight:bold">APPROVED</span>'
    : '<span style="color:#dc2626;font-weight:bold">REJECTED</span>'

  const nameOrDash = (first, last, code) => {
    const full = `${first || ''} ${last || ''}`.trim()
    if (!full) return '—'
    return code ? `${full} (${code})` : full
  }

  const timelineRows = [
    ['1', 'Requisition Created', row.req_created_at, nameOrDash(row.first_name, row.last_name, row.employee_code)],
    ['2', 'HOD Approved', row.req_hod_approval_date, nameOrDash(row.hod_first_name, row.hod_last_name, row.hod_employee_code)],
    ['3', 'Committee Approved', row.req_committee_approval_date, nameOrDash(row.com_first_name, row.com_last_name, row.com_employee_code)],
    ...(row.req_ceo_approval === 1 ? [['4', 'CEO Approved', row.req_ceo_approval_date, nameOrDash(row.ceo_first_name, row.ceo_last_name, row.ceo_employee_code)]] : []),
    ['5', 'Procurement Acknowledged', row.req_procurement_ack_date, nameOrDash(row.proc_first_name, row.proc_last_name, row.proc_employee_code)],
    ['6', 'Quotations Uploaded', row.req_procurement_ack_date, nameOrDash(row.proc_first_name, row.proc_last_name, row.proc_employee_code)],
    ['7', 'Handed to Finance', row.req_handed_to_finance_date, nameOrDash(row.proc_first_name, row.proc_last_name, row.proc_employee_code)],
    ['8', `Finance Approved (Quotation #${approvedIdx} selected)`, row.req_finance_approval_date, nameOrDash(row.fin_first_name, row.fin_last_name, row.fin_employee_code)],
    ['9', 'Invoice Uploaded by Procurement', row.req_invoice_uploaded_at, nameOrDash(row.proc_first_name, row.proc_last_name, row.proc_employee_code)],
    ['10', 'Forwarded to Payable', new Date().toISOString(), forwardedByName || '—'],
  ].map(([n, event, date, by]) => `
    <tr style="background:${parseInt(n, 10) % 2 === 0 ? '#f8fafc' : '#fff'}">
      <td style="padding:6px 10px;border:1px solid #e2e8f0;color:#64748b">${n}</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0">${event}</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;white-space:nowrap">${formatDatePKT(date)}</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0">${by}</td>
    </tr>`).join('')

  const itemRows = (items || []).map((item, i) => `
    <tr style="background:${i % 2 === 0 ? '#fff' : '#f8fafc'}">
      <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:center">${i + 1}</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0">${item.item_desc || '—'}</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0">${item.item_size || '—'}</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0">${item.item_brand || '—'}</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:center">${item.item_qty || '—'}</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:center;font-weight:bold;color:#16a34a">${item.committee_approved_qty != null ? item.committee_approved_qty : '—'}</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right">${item.item_est_cost != null ? Number(item.item_est_cost).toLocaleString() : '—'}</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0">${item.item_remarks || '—'}</td>
    </tr>`).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Audit Report — ${row.req_reference_no}</title></head>
<body style="margin:0;padding:20px;font-family:Arial,sans-serif;font-size:13px;color:#1e293b;background:#f1f5f9">
  <div style="max-width:900px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.12)">
    <div style="background:#1a3a5c;color:#fff;padding:20px 24px">
      <h1 style="margin:0;font-size:18px;letter-spacing:.5px">REQUISITION AUDIT TRAIL REPORT</h1>
      <p style="margin:4px 0 0;font-size:12px;opacity:.8">Reference: ${row.req_reference_no} &nbsp;|&nbsp; Generated: ${formatDatePKT(new Date().toISOString())} (PKT)</p>
    </div>

    <div style="padding:20px 24px">
      <h2 style="color:#1a3a5c;font-size:14px;border-bottom:2px solid #1a3a5c;padding-bottom:4px;margin-top:0">REQUISITION DETAILS</h2>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:4px 8px;width:200px;color:#64748b">Reference No</td><td style="padding:4px 8px;font-weight:bold">${row.req_reference_no || '—'}</td></tr>
        <tr style="background:#f8fafc"><td style="padding:4px 8px;color:#64748b">Category</td><td style="padding:4px 8px">${row.req_category || '—'}</td></tr>
        <tr><td style="padding:4px 8px;color:#64748b">Business Unit</td><td style="padding:4px 8px">${row.req_business || '—'}</td></tr>
        <tr style="background:#f8fafc"><td style="padding:4px 8px;color:#64748b">Location</td><td style="padding:4px 8px">${row.req_location || '—'}</td></tr>
        <tr><td style="padding:4px 8px;color:#64748b">Material / Purpose</td><td style="padding:4px 8px">${row.req_material || '—'}</td></tr>
        <tr style="background:#f8fafc"><td style="padding:4px 8px;color:#64748b">Status</td><td style="padding:4px 8px;color:#16a34a;font-weight:bold">Forwarded to Finance (Payable)</td></tr>
      </table>
    </div>

    <div style="padding:0 24px 20px">
      <h2 style="color:#1a3a5c;font-size:14px;border-bottom:2px solid #1a3a5c;padding-bottom:4px">CREATOR INFORMATION</h2>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:4px 8px;width:200px;color:#64748b">Name</td><td style="padding:4px 8px">${row.first_name || ''} ${row.last_name || ''}</td></tr>
        <tr style="background:#f8fafc"><td style="padding:4px 8px;color:#64748b">Employee Code</td><td style="padding:4px 8px">${row.employee_code || '—'}</td></tr>
        <tr><td style="padding:4px 8px;color:#64748b">Department</td><td style="padding:4px 8px">${row.department_name || '—'}</td></tr>
        <tr style="background:#f8fafc"><td style="padding:4px 8px;color:#64748b">Official Email (CRM)</td><td style="padding:4px 8px">${creatorCrmEmail || '—'}</td></tr>
      </table>
    </div>

    <div style="padding:0 24px 20px">
      <h2 style="color:#1a3a5c;font-size:14px;border-bottom:2px solid #1a3a5c;padding-bottom:4px">ITEMS REQUESTED &amp; COMMITTEE APPROVED QUANTITIES</h2>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:#1a3a5c;color:#fff">
          <th style="padding:8px 10px;border:1px solid #2d5a8e;text-align:center">#</th>
          <th style="padding:8px 10px;border:1px solid #2d5a8e">Description</th>
          <th style="padding:8px 10px;border:1px solid #2d5a8e">Size</th>
          <th style="padding:8px 10px;border:1px solid #2d5a8e">Brand</th>
          <th style="padding:8px 10px;border:1px solid #2d5a8e;text-align:center">Requested Qty</th>
          <th style="padding:8px 10px;border:1px solid #2d5a8e;text-align:center">Committee Approved Qty</th>
          <th style="padding:8px 10px;border:1px solid #2d5a8e;text-align:right">Unit Cost</th>
          <th style="padding:8px 10px;border:1px solid #2d5a8e">Remarks</th>
        </tr></thead>
        <tbody>${itemRows || '<tr><td colspan="8" style="padding:8px;text-align:center;color:#64748b">No items found</td></tr>'}</tbody>
      </table>
    </div>

    <div style="padding:0 24px 20px">
      <h2 style="color:#1a3a5c;font-size:14px;border-bottom:2px solid #1a3a5c;padding-bottom:4px">APPROVAL TIMELINE</h2>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:#1a3a5c;color:#fff">
          <th style="padding:8px 10px;border:1px solid #2d5a8e;width:30px">#</th>
          <th style="padding:8px 10px;border:1px solid #2d5a8e">Event</th>
          <th style="padding:8px 10px;border:1px solid #2d5a8e">Date &amp; Time (PKT)</th>
          <th style="padding:8px 10px;border:1px solid #2d5a8e">By</th>
        </tr></thead>
        <tbody>${timelineRows}</tbody>
      </table>
    </div>

    <div style="padding:0 24px 20px">
      <h2 style="color:#1a3a5c;font-size:14px;border-bottom:2px solid #1a3a5c;padding-bottom:4px">QUOTATION SUMMARY</h2>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:#1a3a5c;color:#fff">
          <th style="padding:8px 10px;border:1px solid #2d5a8e">Quotation</th>
          <th style="padding:8px 10px;border:1px solid #2d5a8e">Status</th>
        </tr></thead>
        <tbody>
          <tr><td style="padding:8px 10px;border:1px solid #e2e8f0">Quotation 1</td><td style="padding:8px 10px;border:1px solid #e2e8f0">${quotationStatus(1)}</td></tr>
          <tr style="background:#f8fafc"><td style="padding:8px 10px;border:1px solid #e2e8f0">Quotation 2</td><td style="padding:8px 10px;border:1px solid #e2e8f0">${quotationStatus(2)}</td></tr>
          <tr><td style="padding:8px 10px;border:1px solid #e2e8f0">Quotation 3</td><td style="padding:8px 10px;border:1px solid #e2e8f0">${quotationStatus(3)}</td></tr>
        </tbody>
      </table>
    </div>

    <div style="background:#1a3a5c;color:#fff;padding:12px 24px;font-size:11px;text-align:center;opacity:.85">
      End of Report &nbsp;|&nbsp; Generated by Requisition Management System &nbsp;|&nbsp; ${formatDatePKT(new Date().toISOString())} (PKT)
    </div>
  </div>
</body>
</html>`
}

function dataUrlToAttachment(dataUrl, filename) {
  if (!dataUrl) return null
  // Accept optional parameters between the MIME type and `;base64,` — jsPDF v4's
  // output('datauristring') produces `data:application/pdf;filename=generated.pdf;base64,…`,
  // which the older strict regex rejected. We capture the MIME type and the base64 body
  // separately and ignore anything in between.
  const s = String(dataUrl)
  const baseIdx = s.indexOf(';base64,')
  if (!s.startsWith('data:') || baseIdx < 0) return null
  const mimeEnd = s.indexOf(';', 5)
  const contentType = (mimeEnd > 0 && mimeEnd < baseIdx ? s.substring(5, mimeEnd) : s.substring(5, baseIdx)) || 'application/octet-stream'
  const base64 = s.substring(baseIdx + ';base64,'.length)
  if (!base64) return null
  return {
    filename,
    content: Buffer.from(base64, 'base64'),
    contentType
  }
}

export async function uploadInvoice(reqId, invoiceFile, body) {
  const reqIdNum = parseInt(reqId, 10)
  if (Number.isNaN(reqIdNum)) return { error: 'Valid requisition ID required', status: 400 }
  const eid = await resolveApproverEmployeeId({
    approvedByEmployeeId: body?.handedByEmployeeId,
    approvedByEmployeeCode: body?.handedByEmployeeCode
  })
  if (eid == null) return { error: 'Valid handedByEmployeeId or handedByEmployeeCode is required', status: 400 }
  const ok = await reqRepo.isProcurementMember(eid)
  if (!ok) return { error: 'Only Procurement can upload the invoice', status: 403 }
  const rows = await reqRepo.getRequisitionForInvoiceUpload(reqIdNum)
  if (!rows.length) return { error: 'Requisition is not in the correct stage for invoice upload', status: 400 }
  if (!invoiceFile || !invoiceFile.buffer) return { error: 'Invoice file is required', status: 400 }
  const { fileToDataUrl } = await import('../utils/file.utils.js')
  const invoiceDataUrl = fileToDataUrl(invoiceFile)
  if (!invoiceDataUrl) return { error: 'Could not read invoice file data', status: 400 }
  await reqRepo.saveInvoiceUrl(reqIdNum, invoiceDataUrl, eid)
  return { message: 'Invoice uploaded successfully', invoiceUrl: invoiceDataUrl }
}

export async function forwardToPayable(body) {
  const reqId = body?.requisitionId != null ? parseInt(body.requisitionId, 10) : null
  if (reqId == null || Number.isNaN(reqId)) return { error: 'Valid requisitionId is required', status: 400 }
  const eid = await resolveApproverEmployeeId({
    approvedByEmployeeId: body?.handedByEmployeeId,
    approvedByEmployeeCode: body?.handedByEmployeeCode
  })
  if (eid == null) return { error: 'Valid handedByEmployeeId or handedByEmployeeCode is required', status: 400 }
  const ok = await reqRepo.isProcurementMember(eid)
  if (!ok) return { error: 'Only Procurement can forward to payable', status: 403 }
  const rows = await reqRepo.getRequisitionForPayableForward(reqId)
  if (!rows.length) return { error: 'Requisition not found, invoice not uploaded, or already forwarded to payable', status: 400 }
  const row = rows[0]
  if (!row.req_quotation_1_url || !row.req_quotation_2_url || !row.req_quotation_3_url) {
    return { error: 'All 3 quotations must be uploaded before forwarding', status: 400 }
  }
  const items = await reqRepo.getItemsByReqId(reqId)
  const approvedIdx = row.req_approved_quotation_index
  const rejectedIdxs = [1, 2, 3].filter(i => i !== approvedIdx)
  const approvedQuotationUrl = row[`req_quotation_${approvedIdx}_url`]
  const rejectedUrls = rejectedIdxs.map(i => row[`req_quotation_${i}_url`])

  let forwardedByName = `Procurement (ID: ${eid})`
  let creatorCrmEmail = null
  try {
    const { getOfficialEmailFromCrm } = await import('../../config/crmDatabase.js')
    if (row.employee_code) {
      creatorCrmEmail = await getOfficialEmailFromCrm(row.employee_code)
    }
    const forwarderRow = await executeQuery(
      'SELECT first_name, last_name, employee_code FROM employees WHERE employee_id = $1',
      [eid]
    )
    if (forwarderRow[0]) {
      const f = forwarderRow[0]
      const fullName = `${f.first_name || ''} ${f.last_name || ''}`.trim()
      if (fullName) forwardedByName = f.employee_code ? `${fullName} (${f.employee_code})` : fullName
    }
  } catch (e) {
    console.warn('Audit enrich (CRM email / forwarder name) failed:', e?.message)
  }

  const auditHtml = buildAuditReportHtml(row, items, forwardedByName, creatorCrmEmail)

  const ext = (url) => {
    if (!url) return 'file'
    const m = String(url).match(/^data:([^;]+);/)
    if (m) {
      const mime = m[1]
      if (mime.includes('pdf')) return 'pdf'
      if (mime.includes('png')) return 'png'
      if (mime.includes('webp')) return 'webp'
      if (mime.includes('gif')) return 'gif'
      return 'jpg'
    }
    return String(url).split('.').pop() || 'file'
  }

  const attachments = [
    dataUrlToAttachment(approvedQuotationUrl, `approved_quotation_${approvedIdx}_${row.req_reference_no}.${ext(approvedQuotationUrl)}`),
    dataUrlToAttachment(rejectedUrls[0], `rejected_quotation_${rejectedIdxs[0]}_${row.req_reference_no}.${ext(rejectedUrls[0])}`),
    dataUrlToAttachment(rejectedUrls[1], `rejected_quotation_${rejectedIdxs[1]}_${row.req_reference_no}.${ext(rejectedUrls[1])}`),
    dataUrlToAttachment(row.req_invoice_url, `invoice_${row.req_reference_no}.${ext(row.req_invoice_url)}`),
    { filename: `audit_report_${row.req_reference_no}.html`, content: auditHtml, contentType: 'text/html' }
  ].filter(Boolean)

  await reqRepo.markForwardedToPayable(reqId, eid)

  const { PAYABLE_EMAIL } = await import('../../config/email.js')
  const payableRecipient = PAYABLE_EMAIL
  let emailWarning = null
  let emailInfo = null
  try {
    const { getEmailTransport, EMAIL_FROM } = await import('../../config/email.js')
    const trans = getEmailTransport()
    if (!trans) throw new Error('SMTP not configured (set SMTP_HOST, SMTP_USER, SMTP_PASSWORD in .env)')
    console.log(`📧 [Payable] Attempting send: from=${EMAIL_FROM} → to=${payableRecipient} | attachments=${attachments.length} | totalBytes=${attachments.reduce((s, a) => s + (a?.content?.length || 0), 0)}`)
    const info = await trans.sendMail({
      from: EMAIL_FROM,
      to: payableRecipient,
      subject: `[Payable Action Required] Requisition ${row.req_reference_no} — Invoice Submitted`,
      html: `<p>Dear Payable Team,</p>
<p>Procurement has submitted the invoice for Requisition <strong>${row.req_reference_no}</strong> (${row.req_category}). Finance has selected <strong>Quotation #${approvedIdx}</strong>.</p>
<p>Please find attached:</p>
<ul>
  <li>✅ Approved Quotation (Quotation #${approvedIdx})</li>
  <li>❌ Rejected Quotation (Quotation #${rejectedIdxs[0]})</li>
  <li>❌ Rejected Quotation (Quotation #${rejectedIdxs[1]})</li>
  <li>📄 Invoice / Bill</li>
  <li>📊 Full Audit Trail Report (HTML)</li>
</ul>
<p>Requested By: ${row.first_name} ${row.last_name} (${row.department_name || '—'})</p>
<p>This is an automated notification from the Requisition Management System.</p>`,
      attachments
    })
    console.log(`📧 [Payable] SMTP response for ${row.req_reference_no}:`, JSON.stringify({
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
      response: info.response
    }))
    emailInfo = {
      to: payableRecipient,
      accepted: info.accepted || [],
      rejected: info.rejected || [],
      response: info.response || null
    }
    if (emailInfo.rejected.length > 0 || emailInfo.accepted.length === 0) {
      emailWarning = `SMTP accepted the request but did not deliver to: ${payableRecipient}. Rejected: ${JSON.stringify(emailInfo.rejected)}. Response: ${emailInfo.response}`
    }
  } catch (err) {
    console.error('📧 [Payable] Email send failed:', err.message)
    emailWarning = err.message
  }

  const result = {
    message: emailWarning
      ? `Forwarded to payable but email issue: ${emailWarning}`
      : `Invoice and quotations forwarded. Email delivered to ${payableRecipient}.`,
    status: 'Pending Payment',
    emailInfo
  }
  if (emailWarning) result.emailError = emailWarning
  return result
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

  // For rejected requisitions missing req_rejection_stage (pre-migration rows), extract from comments
  const rejectedIds = rows.filter((r) => r.req_is_rejected === 1 && !r.req_rejection_stage).map((r) => r.req_id)
  const commentsMap = rejectedIds.length ? await reqRepo.getRequisitionCommentsByReqIds(rejectedIds) : new Map()

  const data = rows.map((row) => {
    // Backfill rejection stage from comments when column is absent (legacy rows)
    if (row.req_is_rejected === 1 && !row.req_rejection_stage) {
      const comments = commentsMap.get(row.req_id) || []
      const rc = comments.find((c) => c.comment_text && c.comment_text.startsWith('[Rejection reason]'))
      row.req_rejection_stage = rc?.stage_key || null
    }

    // Attach items to row for CEO skip calculation
    row.items = itemsByReqId.get(row.req_id) || []
    const bm = row.req_category ? behaviorByCategory.get(String(row.req_category).trim().toLowerCase()) : null
    const { buckets, totalHours } =
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
      createdAt: row.req_created_at,
      rejection_stage: row.req_is_rejected === 1 ? (row.req_rejection_stage || null) : undefined,
      buckets: buckets || []
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
      item_product_description: i.item_product_description ?? null,
      item_size: i.item_size,
      item_brand: i.item_brand,
      item_qty: i.item_qty,
      hod_item_qty: i.hod_item_qty ?? null,
      item_est_cost: i.item_est_cost,
      hod_item_est_cost: i.hod_item_est_cost ?? null,
      committee_approved_qty: i.committee_approved_qty ?? null,
      item_tax_amount: i.item_tax_amount ?? null,
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

  const [total, rows] = await Promise.all([
    reqRepo.getTrackRecordsCount(includeHidden),
    reqRepo.getTrackRecordsAll(limit, offset, includeHidden)
  ])
  const data = await attachItemsToRequisitions(rows || [])

  return {
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 }
  }
}

/** ================= REVERT & REVIEW FEATURE ================= */

/** Legacy (non-flow) stage permission check for revert. */
async function _checkStagePermissionLegacy(eid, stage) {
  switch (stage) {
    case 'hod': return false // HOD cannot revert from the HOD stage
    case 'hr': return reqRepo.isHrMember(eid)
    case 'committee': return reqRepo.isCommitteeMember(eid)
    case 'ceo': return reqRepo.isCeoMember(eid)
    case 'procurement': return reqRepo.isProcurementMember(eid)
    case 'finance': return reqRepo.isFinanceHod(eid)
    case 'admin': return reqRepo.isAdminMember(eid)
    default: return false
  }
}

/**
 * Revert a requisition back to HOD for review/corrections.
 * This allows approvers at any stage to send the requisition back to HOD
 * with comments for corrections. HOD can then resubmit, skipping intermediate stages.
 *
 * @param {Object} body - Request body
 * @param {number} body.requisitionId - Requisition ID
 * @param {string} body.fromStage - Stage triggering the revert (e.g., 'procurement', 'finance')
 * @param {number} body.revertedByEmployeeId - Employee ID of the person reverting
 * @param {string} body.comment - Explanation for why it's being reverted
 */
export async function revertForReview(body) {
  const { requisitionId, fromStage, comment } = body
  const reqId = requisitionId != null ? parseInt(requisitionId, 10) : null
  const eid = await resolveApproverEmployeeId(body)

  if (reqId == null || Number.isNaN(reqId)) {
    return { error: 'Valid requisitionId is required', status: 400 }
  }

  if (!fromStage || !VALID_BUCKETS.includes(fromStage)) {
    return { error: `Valid fromStage is required. Must be one of: ${VALID_BUCKETS.join(', ')}`, status: 400 }
  }

  if (eid == null) {
    return { error: 'Valid revertedByEmployeeId or revertedByEmployeeCode is required', status: 400 }
  }

  // Verify the employee has permission for this stage
  const useFlow = (await reqRepo.getFlowStages()).length > 0
  const canRevert = useFlow
    ? await reqRepo.isEmployeeTypeForStage(eid, fromStage)
    : await _checkStagePermissionLegacy(eid, fromStage)

  if (!canRevert) {
    return { error: `You do not have permission to revert from ${fromStage} stage`, status: 403 }
  }

  // Stage + state guard: only revert a requisition that is actually AT fromStage and still in
  // flight. Otherwise clear_approvals_after_stage could clear more than intended and resubmit
  // would return it to the wrong stage. NULL stage is allowed — legacy rows sit in a bucket via
  // the approval-flag fallback used by the pending lists.
  const requisition = await reqRepo.getRequisitionById(reqId)
  if (!requisition.length) return { error: 'Requisition not found', status: 404 }
  const curReq = requisition[0]
  if (Number(curReq.req_is_rejected) === 1) {
    return { error: 'Cannot revert a rejected requisition', status: 400 }
  }
  if (Number(curReq.req_purchase_completed) === 1) {
    return { error: 'Cannot revert a requisition whose purchase is already completed', status: 400 }
  }
  if (curReq.req_current_stage_key != null && curReq.req_current_stage_key !== fromStage) {
    return { error: `Requisition is not at the ${fromStage} stage (current: ${curReq.req_current_stage_key})`, status: 400 }
  }

  // Check if THIS STAGE has already reverted (one revert per stage allowed)
  const stageAlreadyReverted = await reqRepo.hasStageReverted(reqId, fromStage)
  if (stageAlreadyReverted) {
    return { error: `This requisition has already been reverted from ${fromStage}. Each stage can only revert once.`, status: 409 }
  }

  // Get creator info for notification
  const creatorId = await notifRepo.getRequisitionCreatorId(reqId)
  const refNo = curReq.req_reference_no || `#${reqId}`

  // Perform the revert
  const result = await reqRepo.revertRequisitionToHod(reqId, fromStage, eid, comment)
  if (!result) {
    return { error: 'Failed to revert requisition', status: 500 }
  }

  // Add comment record with special prefix for revert
  if (comment && String(comment).trim()) {
    await reqRepo.insertRequisitionComment(reqId, fromStage, `[Revert for Review] ${String(comment).trim()}`, eid)
  }

  // Send notifications
  // 1. Notify the HOD of the creator's department (revert-specific email)
  const reqRow = await reqRepo.getRequisitionAndDepartment(reqId)
  if (reqRow?.[0]?.department_id) {
    notifSvc.notifySafe(inAppNotifyRequisitionBucket(reqId, 'hod', reqRow[0].department_id))
    await notifyRequisitionReverted(reqId, fromStage, comment)
  }

  // 2. Notify the creator via in-app
  if (creatorId) {
    notifSvc.notifySafe(notifSvc.notify({
      recipientEmployeeId: creatorId,
      type: 'requisition_reverted_for_review',
      title: `Requisition ${refNo} - Needs Correction`,
      body: `Your requisition has been sent back to HOD for review/corrections from ${fromStage}. Reason: ${comment}`,
      url: '/requisition/history',
      relatedEntityType: 'requisition',
      relatedEntityId: reqId
    }))
  }

  return {
    message: 'Requisition reverted to HOD for review',
    status: 'Reverted to HOD for Review',
    revertedFrom: fromStage,
    revertedTo: 'hod',
    referenceNo: result.req_reference_no,
    note: 'HOD can now make corrections and resubmit. The requisition will skip intermediate stages and return directly to ' + fromStage
  }
}

/**
 * Resubmit a requisition after HOD has made corrections.
 * Clears the revert state, restores HOD approval, and moves the requisition
 * directly back to the stage that triggered the revert (skipping intermediates).
 */
export async function resubmitAfterRevert(body) {
  const { requisitionId } = body
  const reqId = requisitionId != null ? parseInt(requisitionId, 10) : null
  const eid = await resolveApproverEmployeeId(body)

  if (reqId == null || Number.isNaN(reqId)) {
    return { error: 'Valid requisitionId is required', status: 400 }
  }
  if (eid == null) {
    return { error: 'Valid approvedByEmployeeId or approvedByEmployeeCode is required', status: 400 }
  }

  // Fetch the requisition to confirm it is in a reverted state
  const rows = await reqRepo.getRequisitionById(reqId)
  if (!rows.length) return { error: 'Requisition not found', status: 404 }
  const row = rows[0]

  if (!row.has_been_reverted || row.revert_resolved_at) {
    return { error: 'Requisition is not in a reverted state or has already been resubmitted', status: 409 }
  }
  if (row.req_is_rejected === 1) {
    return { error: 'Cannot resubmit a rejected requisition', status: 400 }
  }

  // Verify that the actor is HOD of the requisition's department
  const reqDept = await reqRepo.getRequisitionAndDepartment(reqId)
  const deptId = reqDept[0]?.department_id
  const isHod = deptId != null && (await reqRepo.isHodOfDepartment(eid, deptId))
  if (!isHod) {
    return { error: 'Only the HOD of the requestor department can resubmit after a revert', status: 403 }
  }

  // Target stage: the stage that originally triggered the revert
  const targetStage = row.reverted_from_stage || 'committee'

  const result = await reqRepo.resubmitRequisitionAfterRevert(reqId, targetStage)
  if (!result || !result.length) {
    return { error: 'Failed to resubmit requisition', status: 500 }
  }

  // Log the resubmit as a comment
  await reqRepo.insertRequisitionComment(reqId, 'hod', '[Resubmitted after Revert] HOD resubmitted after corrections', eid)

  // Notify the target stage bucket (resubmit-specific email)
  await notifyRequisitionResubmitted(reqId, targetStage)
  notifSvc.notifySafe(inAppNotifyRequisitionBucket(reqId, targetStage, deptId))

  return {
    message: `Requisition resubmitted successfully and returned to ${targetStage}`,
    status: `Pending ${targetStage.charAt(0).toUpperCase() + targetStage.slice(1)}`,
    targetStage,
    referenceNo: result[0].req_reference_no
  }
}

/**
 * Get reverted requisitions for a specific employee (creator view).
 * Shows the creator their own requisitions that have been sent back to HOD.
 */
export async function getMyRevertedRequisitions(employeeId) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return { error: 'Valid employee ID is required', status: 400 }

  const rows = await reqRepo.getMyRevertedRequisitionsList(eid)
  const reqIds = (rows || []).map(r => r.req_id)
  const items = reqIds.length ? await reqRepo.getItemsByReqIds(reqIds) : []

  return (rows || []).map(req => ({
    ...req,
    status: 'Reverted to HOD for Correction',
    items: items.filter(i => i.req_id === req.req_id)
  }))
}

/** ============ Procurement "item unavailable" + Committee review ============ */

/** Normalize a DB date/timestamp value to 'YYYY-MM-DD' (or null). */
function toYmd(value) {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10)
  return d.toISOString().slice(0, 10)
}

/**
 * Revise a requisition: create a fresh copy (creator-edited items) with a revised reference,
 * routed through the full normal flow from HOD. The original is left unchanged.
 * Allowed for the creator on ANY requisition they own (no stage/date/status restriction is
 * enforced here). The History page's revise button uses canReviseRequisition() to decide when
 * to OFFER a revise, but that is a UI affordance only — it is not a server-side precondition.
 */
export async function reviseRequisition(body) {
  const reqId = parseInt(body?.reqId, 10)
  const eid = await resolveApproverEmployeeId(body)
  if (Number.isNaN(reqId)) return { error: 'Valid reqId is required', status: 400 }
  if (eid == null) return { error: 'Valid creator (approvedByEmployeeId/Code) is required', status: 400 }

  const orig = await reqRepo.getRequisitionForReviseById(reqId)
  if (!orig) return { error: 'Requisition not found', status: 404 }
  if (parseInt(orig.req_emp_id, 10) !== eid) return { error: 'Only the creator can revise this requisition', status: 403 }

  // Revise is available on any requisition the creator owns.
  const today = new Date().toISOString().slice(0, 10)

  // Reuse the standard creation flow so the revision behaves exactly like a normal requisition.
  const created = await createRequisition({
    employeeId: eid,
    location: orig.req_location,
    material: orig.req_material,
    requiredByDate: body.requiredByDate || null,
    business: orig.req_business,
    items: Array.isArray(body.items) ? body.items : [],
    category: orig.req_category,
    isUrgent: false
  })
  if (created.error) return created

  // Stamp the revised reference (based on the ORIGINAL reference) and link back.
  const revNum = (await reqRepo.countRevisionsOf(reqId)) + 1
  const ref = buildRevisionReference(orig.req_reference_no, today.replace(/-/g, ''), revNum)
  await reqRepo.setRevisionReferenceAndLink(created.requisitionId, ref, reqId)

  return { message: 'Requisition revised successfully', requisitionId: created.requisitionId, referenceNo: ref, revisedFrom: reqId }
}

/** Audit trail of item-review actions for a requisition (newest first). */
export async function getRequisitionItemEvents(reqId) {
  const id = parseInt(reqId, 10)
  if (Number.isNaN(id)) return []
  const map = await reqRepo.getItemEventsByReqIds([id])
  return map.get(id) || []
}

/** Committee-approved line total for a requisition over its CURRENT (non-excluded) items. */
async function approvedTotalForReq(reqId) {
  const items = await reqRepo.getItemsByReqIds([reqId])
  return computeCommitteeApprovedLineTotalPKR(items)
}

/**
 * Procurement flags a requisition item as unavailable at the vendor (mandatory reason).
 * The item is set aside (pending_review), excluded from totals, and sent to the Committee.
 */
export async function flagItemUnavailable(body) {
  const itemId = parseInt(body?.itemId, 10)
  const reason = body?.reason != null ? String(body.reason).trim() : ''
  const eid = await resolveApproverEmployeeId(body)
  if (Number.isNaN(itemId) || eid == null) return { error: 'Valid itemId and approver are required', status: 400 }
  if (!reason) return { error: 'A reason is required to mark an item unavailable.', status: 400 }
  if (!(await reqRepo.isProcurementMember(eid))) return { error: 'Only Procurement can mark items unavailable.', status: 403 }

  const item = await reqRepo.getRequisitionItemWithReq(itemId)
  if (!item) return { error: 'Item not found', status: 404 }
  if (Number(item.req_is_rejected) === 1) return { error: 'Requisition is rejected', status: 400 }
  if (Number(item.req_purchase_completed) === 1) return { error: 'Requisition purchase already completed', status: 400 }
  if (item.req_current_stage_key !== 'procurement') return { error: 'Items can only be set aside while the requisition is at the Procurement stage', status: 400 }
  if (item.item_review_status !== 'active') return { error: 'Item is not in an active state', status: 400 }

  const before = await approvedTotalForReq(item.req_id)
  const res = await reqRepo.flagItemUnavailable(itemId, item.req_id, reason, eid)
  if (!res || res.length === 0) return { error: 'Could not flag item', status: 400 }
  await refreshRequisitionItemTaxes(item.req_id)
  const after = await approvedTotalForReq(item.req_id)
  await reqRepo.insertRequisitionItemEvent({ reqId: item.req_id, itemId, eventType: 'flagged_unavailable', reason, amountBefore: before, amountAfter: after, ceoRequired: false, actorEmployeeId: eid })

  try {
    const committeeIds = await notifRepo.getEmployeeIdsByRoleType('Committee')
    notifSvc.notifySafe(notifSvc.notifyMany(committeeIds, {
      type: 'requisition_item_review',
      title: 'Item flagged unavailable — review needed',
      body: `Procurement marked an item on ${item.req_reference_no} as unavailable: "${reason}". Please review if it is required.`,
      url: '/requisition', relatedEntityType: 'requisition', relatedEntityId: item.req_id
    }))
  } catch (_) {}

  return { message: 'Item marked unavailable and sent to Committee for review', itemId, status: 'pending_review' }
}

/** Procurement restores a flagged item back to active (undo). */
export async function restoreFlaggedItem(body) {
  const itemId = parseInt(body?.itemId, 10)
  const eid = await resolveApproverEmployeeId(body)
  if (Number.isNaN(itemId) || eid == null) return { error: 'Valid itemId and approver are required', status: 400 }
  if (!(await reqRepo.isProcurementMember(eid))) return { error: 'Only Procurement can restore items.', status: 403 }

  const item = await reqRepo.getRequisitionItemWithReq(itemId)
  if (!item) return { error: 'Item not found', status: 404 }
  if (item.item_review_status !== 'pending_review') return { error: 'Only a pending item can be restored', status: 400 }

  const before = await approvedTotalForReq(item.req_id)
  const res = await reqRepo.restoreFlaggedItem(itemId, item.req_id)
  if (!res || res.length === 0) return { error: 'Could not restore item', status: 400 }
  await refreshRequisitionItemTaxes(item.req_id)
  const after = await approvedTotalForReq(item.req_id)
  await reqRepo.insertRequisitionItemEvent({ reqId: item.req_id, itemId, eventType: 'restored', reason: null, amountBefore: before, amountAfter: after, ceoRequired: false, actorEmployeeId: eid })
  return { message: 'Item restored', itemId, status: 'active' }
}

/** Committee queue: items flagged by Procurement awaiting a required/not-required decision. */
export async function getItemReviewQueue(employeeId) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return { error: 'Valid employee ID is required', status: 400 }
  if (!(await reqRepo.isCommitteeMember(eid))) return { error: 'Only Committee can view this list', status: 403 }
  return reqRepo.getItemsPendingReview()
}

/**
 * Committee decision on a flagged item.
 *  - required     → item re-included (active). If the approved total rises, the requisition is
 *                   re-routed to the CEO for re-approval; otherwise it continues at Procurement.
 *  - not_required → item dropped (excluded permanently).
 */
export async function reviewFlaggedItem(body) {
  const itemId = parseInt(body?.itemId, 10)
  const decision = String(body?.decision || '').trim().toLowerCase()
  const eid = await resolveApproverEmployeeId(body)
  if (Number.isNaN(itemId) || eid == null) return { error: 'Valid itemId and approver are required', status: 400 }
  if (!['required', 'not_required'].includes(decision)) return { error: "decision must be 'required' or 'not_required'", status: 400 }
  if (!(await reqRepo.isCommitteeMember(eid))) return { error: 'Only Committee can review flagged items.', status: 403 }

  const item = await reqRepo.getRequisitionItemWithReq(itemId)
  if (!item) return { error: 'Item not found', status: 404 }
  if (item.item_review_status !== 'pending_review') return { error: 'Item is not awaiting review', status: 400 }

  const before = await approvedTotalForReq(item.req_id)
  const res = await reqRepo.reviewFlaggedItem(itemId, item.req_id, decision, eid)
  if (!res || res.length === 0) return { error: 'Could not record decision', status: 400 }
  await refreshRequisitionItemTaxes(item.req_id)
  const after = await approvedTotalForReq(item.req_id)

  // CEO re-check: re-including an item raises the total → require CEO again.
  let ceoRequired = false
  if (decision === 'required' && after > before) {
    ceoRequired = true
    await reqRepo.setRequisitionCurrentStage(item.req_id, 'ceo')
    await executeQuery('UPDATE requisition SET req_ceo_approval = 0 WHERE req_id = $1', [item.req_id]).catch(() => {})
    // Bucket change → notify CEO by email + in-app (consistent with every other stage transition).
    await notifyBucketChanged(item.req_id, 'ceo')
    try { notifSvc.notifySafe(inAppNotifyRequisitionBucket(item.req_id, 'ceo', null)) } catch (_) {}
  }

  await reqRepo.insertRequisitionItemEvent({
    reqId: item.req_id, itemId,
    eventType: decision === 'required' ? 'committee_required' : 'committee_not_required',
    reason: null, amountBefore: before, amountAfter: after, ceoRequired, actorEmployeeId: eid
  })

  try {
    const procIds = await notifRepo.getEmployeeIdsByRoleType('Procurement')
    const decisionLabel = decision === 'required' ? 'required (kept in the order)' : 'not required (removed)'
    notifSvc.notifySafe(notifSvc.notifyMany(procIds, {
      type: 'requisition_item_reviewed',
      title: 'Committee reviewed a flagged item',
      body: `Committee marked an item on ${item.req_reference_no} as ${decisionLabel}.${ceoRequired ? ' Requisition sent to CEO for re-approval.' : ''}`,
      url: '/requisition', relatedEntityType: 'requisition', relatedEntityId: item.req_id
    }))
    const creatorId = await notifRepo.getRequisitionCreatorId(item.req_id)
    if (creatorId) notifSvc.notifySafe(notifSvc.notify({
      recipientEmployeeId: creatorId, type: 'requisition_item_reviewed',
      title: 'An item on your requisition was reviewed',
      body: `Committee marked an item on ${item.req_reference_no} as ${decisionLabel}.`,
      url: '/requisition', relatedEntityType: 'requisition', relatedEntityId: item.req_id
    }))
  } catch (_) {}

  return { message: `Item marked ${decision === 'required' ? 'required' : 'not required'}`, itemId, status: decision === 'required' ? 'active' : 'dropped', ceoRequired }
}
