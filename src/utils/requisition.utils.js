import { getEffectiveUnitPricePkrFromItem } from './requisitionAmountParse.js'

/**
 * CEO stage applies when committee-approved line total (qty × unit price) is >= this (PKR).
 * Below this, workflow skips CEO to Procurement. Default 100000.
 */
export const REQUISITION_CEO_MIN_AMOUNT_PKR = parseInt(process.env.REQUISITION_CEO_MIN_AMOUNT_PKR || '100000', 10)

/**
 * Sum of (committee_approved_qty × unit price) for all items — same formula as Committee approve → CEO skip rule.
 * Unit price from stored numeric `item_est_cost` / `hod_item_est_cost` (digits only).
 */
export function computeCommitteeApprovedLineTotalPKR(items) {
  if (!items || !items.length) return 0
  let total = 0
  for (const it of items) {
    const qtyRaw = it.committee_approved_qty ?? it.committeeApprovedQty
    const qty = (qtyRaw != null && !Number.isNaN(Number(qtyRaw))) ? Number(qtyRaw) : 0
    const pricePerPiece = getEffectiveUnitPricePkrFromItem(it)
    if (pricePerPiece == null || Number.isNaN(pricePerPiece) || pricePerPiece < 0) continue
    total += qty * pricePerPiece
  }
  return Math.round(total)
}

function isExecutionDone(row) {
  return row.req_admin_approval === 1 ||
    row.req_purchase_completed === 1 ||
    (row.req_finance_approval === 1 && row.req_category && /loan/i.test(String(row.req_category)) && row.req_hr_check_approved_by != null)
}

export function getRequisitionStatus(row, itemsLineTotalPkrOptional = null) {
  if (row.req_is_rejected === 1) return 'Rejected'
  if (row.req_creator_acknowledged === 1) return 'Closed'
  if (row.req_current_stage_key === 'hr_check') return 'Pending HR Check'
  if (row.req_current_stage_key === 'manager_finance') {
    if (row.req_manager_finance_status === 'in_progress') return 'Manager of Finance: In Progress'
    if (row.req_manager_finance_status === 'completed') return 'Manager of Finance: Progress Completed'
    return 'Pending Manager of Finance'
  }
  if (isExecutionDone(row) && row.req_creator_acknowledged !== 1) return 'Pending your acknowledgment'
  if (row.req_admin_approval === 1) return 'Completed'
  if (row.req_hod_acknowledged === 1) return 'Completed'
  if (row.req_purchase_completed === 1) {
    // Customize status based on who created the requisition
    const creatorRole = row.req_creator_role
    if (creatorRole === 'CEO') {
      return 'Completed - Pending CEO Acknowledgment'
    } else if (creatorRole === 'Committee') {
      return 'Completed - Pending Committee Acknowledgment'
    } else {
      return 'Completed - Pending HOD Acknowledgment'
    }
  }
  if (row.req_finance_approval === 1) return 'Finance Approved - Ready for Purchase'
  if (row.req_handed_to_finance === 1) return 'Pending Finance Approval'
  if (row.req_procurement_ack === 1) {
    const hasQuotations = row.req_quotation_1_url && row.req_quotation_2_url && row.req_quotation_3_url
    if (hasQuotations) return 'Quotations Added - Hand over to Finance'
    return 'Acknowledged by Procurement - Add 3 Quotations'
  }
  // Flow-driven stage: show current bucket so e.g. Devices/Accessories shows Finance/CEO, not Procurement
  if (row.req_current_stage_key === 'finance') return 'Pending Finance Approval'
  if (row.req_current_stage_key === 'ceo') return 'Pending CEO'
  if (row.req_current_stage_key === 'procurement') return 'Forwarded to Procurement'
  if (row.req_current_stage_key === 'hr') return 'Pending HR'
  if (row.req_current_stage_key === 'admin') return 'Pending Admin'
  if (row.req_ceo_approval === 1) return 'Forwarded to Procurement'
  if (row.req_committee_approval === 1) {
    const line = itemsLineTotalPkrOptional != null ? Number(itemsLineTotalPkrOptional) : null
    if (line != null && !Number.isNaN(line) && line < REQUISITION_CEO_MIN_AMOUNT_PKR) {
      return 'Forwarded to Procurement'
    }
    return 'Pending CEO'
  }
  if (row.req_hod_approval === 1) return 'Pending Committee'
  return 'Pending HOD'
}

export function getPendingAt(status) {
  if (!status) return null
  if (status === 'Rejected') return 'Rejected'
  if (status === 'Finance Approved - Ready for Purchase') return 'Completed'
  if (status === 'Pending Finance Approval') return 'Finance'
  if (status.includes('Quotations') && status.includes('Hand over')) return 'Procurement (hand over)'
  if (status.includes('Acknowledged by Procurement')) return 'Procurement (add quotations)'
  if (status === 'Forwarded to Procurement') return 'Procurement'
  if (status === 'Pending CEO') return 'CEO'
  if (status === 'Pending Committee') return 'Committee'
  if (status === 'Pending HR' || status === 'Pending HR Check') return 'HR'
  if (status === 'Pending Admin') return 'Admin'
  if (status === 'Pending HOD') return 'HOD'
  if (status === 'Pending Manager of Finance' || status.startsWith('Manager of Finance:')) return 'Manager of Finance'
  if (status === 'Pending your acknowledgment') return 'Creator'
  if (status === 'Closed') return 'Closed'
  return null
}

export function parseEmployeeId(employeeId) {
  if (employeeId == null || employeeId === '') return null
  const n = parseInt(employeeId, 10)
  return Number.isNaN(n) ? null : n
}

function hoursBetweenTat(start, end) {
  const now = new Date()
  const toTs = (d) => (d ? new Date(d) : null)
  if (!start) return null
  const s = toTs(start).getTime()
  const e = end ? toTs(end).getTime() : now.getTime()
  return (e - s) / (1000 * 60 * 60)
}

function mapBucketsToDuration(buckets) {
  const withDuration = buckets.map((b) => {
    const hours = hoursBetweenTat(b.start, b.end)
    return {
      name: b.name,
      start: b.start || null,
      end: b.end || null,
      assignee: b.assignee != null ? b.assignee : '—',
      hours: hours != null ? Math.round(hours * 100) / 100 : null,
      days: hours != null ? Math.round((hours / 24) * 100) / 100 : null
    }
  })
  const totalHours = withDuration.reduce((sum, b) => sum + (b.hours != null ? b.hours : 0), 0)
  return { buckets: withDuration, totalHours: Math.round(totalHours * 100) / 100 }
}

/** Legacy static pipeline (when DB flow stages unavailable). Determines path from actual data. */
export function getTATFromRequisition(row) {
  const skipCeo = shouldSkipCeo(row)
  const currentKey = String(row.req_current_stage_key || '').toLowerCase()

  const committeeExit =
    row.req_committee_approval_date ||
    (Number(row.req_committee_approval) === 1 ? row.req_ceo_approval_date || null : null)

  const buckets = []
  let lastEnd = row.req_created_at

  // HOD — always first stage
  buckets.push({ name: 'HOD', start: lastEnd, end: row.req_hod_approval_date || null, assignee: '—' })
  if (row.req_hod_approval_date) lastEnd = row.req_hod_approval_date
  else return mapBucketsToDuration(buckets)

  // HR — only if visited (also show if rejected at this stage)
  const hrRejected = row.req_is_rejected === 1 && String(row.req_rejection_stage || '') === 'hr'
  if (row.req_hr_approval_date || currentKey === 'hr' || hrRejected) {
    buckets.push({ name: 'HR', start: lastEnd, end: row.req_hr_approval_date || null, assignee: '—' })
    if (row.req_hr_approval_date) lastEnd = row.req_hr_approval_date
    else return mapBucketsToDuration(buckets)
  }

  // Committee — if HOD approved
  if (row.req_hod_approval === 1 || committeeExit || currentKey === 'committee') {
    buckets.push({ name: 'Committee', start: lastEnd, end: committeeExit || null, assignee: '—' })
    if (committeeExit) lastEnd = committeeExit
    else return mapBucketsToDuration(buckets)
  }

  // CEO — only if not skipped and actually visited (also show if rejected at this stage)
  const ceoRejected = row.req_is_rejected === 1 && String(row.req_rejection_stage || '') === 'ceo'
  if (!skipCeo && (row.req_ceo_approval_date || currentKey === 'ceo' || ceoRejected)) {
    buckets.push({ name: 'CEO', start: lastEnd, end: row.req_ceo_approval_date || null, assignee: '—' })
    if (row.req_ceo_approval_date) lastEnd = row.req_ceo_approval_date
    else return mapBucketsToDuration(buckets)
  }

  // Procurement — if committee or CEO forwarded to it
  const procReached = row.req_ceo_approval === 1 || (row.req_committee_approval === 1 && skipCeo) ||
    row.req_procurement_ack === 1 || currentKey === 'procurement'
  if (procReached) {
    buckets.push({ name: 'Procurement', start: lastEnd, end: row.req_handed_to_finance_date || null, assignee: '—' })
    if (row.req_handed_to_finance_date) lastEnd = row.req_handed_to_finance_date
    else return mapBucketsToDuration(buckets)
  }

  // Finance — only if handed to finance
  if (row.req_handed_to_finance === 1 || currentKey === 'finance') {
    buckets.push({ name: 'Finance', start: lastEnd, end: row.req_finance_approval_date || null, assignee: '—' })
    if (row.req_finance_approval_date) lastEnd = row.req_finance_approval_date
    else return mapBucketsToDuration(buckets)
  }

  // Post-flow tail (purchase completion, acknowledgments)
  buckets.push(...buildPostFlowTailBuckets(row))
  return mapBucketsToDuration(buckets)
}

/** Stages in category flow that are not skipped (same order as requisition_flow_stage). */
function getActiveFlowStages(flowStages, behaviorMap) {
  if (!Array.isArray(flowStages) || !flowStages.length || !behaviorMap || typeof behaviorMap !== 'object') {
    return []
  }
  return flowStages.filter((s) => {
    const b = behaviorMap[s.stage_key]
    return b && b !== 'skip'
  })
}

/** Human-readable label map for stage keys (fallback when DB label missing). */
const STAGE_KEY_LABELS = {
  hod: 'HOD', hr: 'HR', committee: 'Committee',
  ceo: 'CEO', procurement: 'Procurement', finance: 'Finance', admin: 'Admin'
}

/** When this stage finished (exit timestamp), or null if not yet. */
function getStageCompletionTimestamp(row, stageKey) {
  const k = String(stageKey || '').toLowerCase()
  switch (k) {
    case 'hod':
      return row.req_hod_approval_date || null
    case 'hr':
      return row.req_hr_approval_date || null
    case 'committee':
      return (
        row.req_committee_approval_date ||
        (Number(row.req_committee_approval) === 1 ? row.req_ceo_approval_date || null : null) ||
        null
      )
    case 'ceo':
      return row.req_ceo_approval_date || null
    case 'procurement':
      return row.req_handed_to_finance_date || null
    case 'finance':
      return row.req_finance_approval_date || null
    case 'admin':
      return row.req_admin_approval_date || null
    default:
      return null
  }
}

function buildPostFlowTailBuckets(row) {
  return [
    {
      name: 'Procurement (complete)',
      start: row.req_finance_approval_date || null,
      end: row.req_purchase_completed_date || null,
      assignee: '—'
    },
    {
      name: 'HOD Acknowledge',
      start: row.req_purchase_completed_date || null,
      end: row.req_hod_acknowledged_date || null,
      assignee: '—'
    },
    {
      name: 'Creator Acknowledge',
      start: (row.req_purchase_completed_date || row.req_admin_approval_date || row.req_finance_approval_date) || null,
      end: row.req_creator_acknowledged_date || null,
      assignee: '—'
    }
  ]
}

/**
 * Compute committee line total (same formula as CEO skip rule).
 */
function computeLineTotalForCeoSkip(row) {
  // If items are not available, we can't compute - assume >= threshold to be safe
  if (!row?.items?.length && !row?.req_items?.length) return null
  const items = row.items || row.req_items || []
  return computeCommitteeApprovedLineTotalPKR(items)
}

/**
 * Check if CEO stage should be skipped.
 * Priority: structural signals first (req_current_stage_key, req_procurement_ack, etc.),
 * then fall back to amount-based calculation from items.
 */
function shouldSkipCeo(row) {
  // If CEO already approved, definitely not skipped
  if (row.req_ceo_approval === 1) return false

  // If requisition has structurally moved past CEO without CEO approval → CEO was skipped
  const currentKey = String(row.req_current_stage_key || '').toLowerCase()
  if (['procurement', 'finance', 'admin'].includes(currentKey)) return true
  if (row.req_procurement_ack === 1) return true
  if (row.req_handed_to_finance === 1) return true
  if (row.req_finance_approval === 1) return true

  // Fall back to amount-based calculation (needs items to be loaded)
  const lineTotal = computeLineTotalForCeoSkip(row)
  if (lineTotal == null) return false
  return lineTotal < REQUISITION_CEO_MIN_AMOUNT_PKR
}

/**
 * Returns true only if this requisition has actually entered the given stage.
 * Used to avoid showing stages in the TAT that were skipped or not yet reached.
 */
function hasStageBeenEntered(row, stageKey, skipCeo) {
  const k = String(stageKey || '').toLowerCase()
  // If stage has a completion timestamp, it was definitely entered
  if (getStageCompletionTimestamp(row, k)) return true
  // If this is the current active stage key, it's entered
  if (row.req_current_stage_key === k) return true
  switch (k) {
    case 'hod': return true
    case 'hr': return row.req_hod_approval === 1
    case 'committee': return row.req_hod_approval === 1
    case 'ceo': return row.req_committee_approval === 1 && !skipCeo
    case 'procurement':
      return (
        row.req_ceo_approval === 1 ||
        row.req_procurement_ack === 1 ||
        (row.req_committee_approval === 1 && skipCeo)
      )
    // Finance: ONLY if procurement explicitly handed off to finance
    case 'finance': return row.req_handed_to_finance === 1
    case 'admin': return row.req_admin_approval === 1
    default: return false
  }
}

/**
 * TAT buckets using DB flow stage ORDERING but actual visit data for inclusion.
 *
 * KEY PRINCIPLE: A stage appears in the TAT if the requisition ACTUALLY went through it
 * (has a completion timestamp OR is the current active stage). Category behavior map
 * is for workflow routing — NOT for TAT display. We ignore 'skip' config here.
 *
 * - CEO is excluded only if amount < 100K PKR (shouldSkipCeo) AND CEO was never approved.
 * - Finance only if req_handed_to_finance = 1.
 * - Stages with no timestamp and not current are silently skipped.
 */
export function buildTatFromRequisition(row, flowStages, behaviorMap) {
  if (!row) return { buckets: [], totalHours: 0 }
  if (!Array.isArray(flowStages) || !flowStages.length) return getTATFromRequisition(row)

  const skipCeo = shouldSkipCeo(row)
  const currentKey = String(row.req_current_stage_key || '').toLowerCase()

  const raw = []
  let lastEnd = row.req_created_at

  // Use flowStages for ORDER only — check actual data to decide inclusion
  for (const stage of flowStages) {
    const key = stage.stage_key

    // CEO: skip only if amount < threshold AND CEO was never approved
    if (key === 'ceo' && skipCeo) continue

    // A stage is included if it has a completion timestamp, is the current active stage,
    // or is the stage where rejection occurred (terminal open bucket)
    const completionTs = getStageCompletionTimestamp(row, key)
    const isCurrentStage = (currentKey === key)
    const isRejectionStage = row.req_is_rejected === 1 && String(row.req_rejection_stage || '').toLowerCase() === key
    if (!completionTs && !isCurrentStage && !isRejectionStage) continue

    // Can't add if the previous stage hasn't completed (chain broken)
    if (lastEnd == null) break

    const label = stage.stage_label || STAGE_KEY_LABELS[key] || key
    const assignee = stage.employee_type_name || stage.designation_name || '—'

    raw.push({ name: label, start: lastEnd, end: completionTs || null, assignee })

    if (completionTs) {
      lastEnd = completionTs    // Stage done — carry forward
    } else {
      lastEnd = null            // Stage active — stop here
    }
  }

  const buckets = row.req_is_rejected === 1 ? raw : [...raw, ...buildPostFlowTailBuckets(row)]
  return mapBucketsToDuration(buckets)
}

export function formatTotalTime(totalHours) {
  if (totalHours == null || totalHours < 0) return null
  const h = Math.floor(totalHours)
  const m = Math.round((totalHours - h) * 60)
  if (h >= 1) return `${h} hrs, ${m} mins`
  return `${m} mins`
}

export function tatReportStatusCondition(status) {
  const s = (status || '').trim().toLowerCase()
  if (!s) return null
  if (s === 'rejected') return ` AND r.req_is_rejected = 1`
  if (s === 'completed') return ` AND (COALESCE(r.req_is_rejected,0) = 0) AND (COALESCE(r.req_hod_acknowledged,0) = 1)`
  if (s === 'pending hod') return ` AND (COALESCE(r.req_is_rejected,0) = 0) AND (COALESCE(r.req_hod_approval,0) = 0)`
  if (s === 'pending committee') return ` AND (COALESCE(r.req_is_rejected,0) = 0) AND r.req_hod_approval = 1 AND (COALESCE(r.req_committee_approval,0) = 0)`
  if (s === 'pending ceo') return ` AND (COALESCE(r.req_is_rejected,0) = 0) AND r.req_committee_approval = 1 AND (COALESCE(r.req_ceo_approval,0) = 0)`
  if (s === 'forwarded to procurement') return ` AND (COALESCE(r.req_is_rejected,0) = 0) AND r.req_ceo_approval = 1 AND (COALESCE(r.req_procurement_ack,0) = 0)`
  if (s.includes('acknowledged') && s.includes('procurement')) return ` AND (COALESCE(r.req_is_rejected,0) = 0) AND r.req_procurement_ack = 1 AND (r.req_quotation_1_url IS NULL OR r.req_quotation_2_url IS NULL OR r.req_quotation_3_url IS NULL)`
  if (s.includes('quotations') && s.includes('hand over')) return ` AND (COALESCE(r.req_is_rejected,0) = 0) AND r.req_procurement_ack = 1 AND r.req_quotation_1_url IS NOT NULL AND r.req_quotation_2_url IS NOT NULL AND r.req_quotation_3_url IS NOT NULL AND (COALESCE(r.req_handed_to_finance,0) = 0)`
  if (s === 'pending finance approval') return ` AND (COALESCE(r.req_is_rejected,0) = 0) AND r.req_handed_to_finance = 1 AND (COALESCE(r.req_finance_approval,0) = 0)`
  if (s.includes('finance approved') || s.includes('ready for purchase')) return ` AND (COALESCE(r.req_is_rejected,0) = 0) AND r.req_finance_approval = 1`
  return null
}
