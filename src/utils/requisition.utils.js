function isExecutionDone(row) {
  return row.req_admin_approval === 1 ||
    row.req_purchase_completed === 1 ||
    (row.req_finance_approval === 1 && row.req_category && /loan/i.test(String(row.req_category)))
}

export function getRequisitionStatus(row) {
  if (row.req_is_rejected === 1) return 'Rejected'
  if (row.req_creator_acknowledged === 1) return 'Closed'
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
  if (row.req_ceo_approval === 1) return 'Forwarded to Procurement'
  if (row.req_committee_approval === 1) return 'Pending CEO'
  if (row.req_current_stage_key === 'hr') return 'Pending HR'
  if (row.req_current_stage_key === 'admin') return 'Pending Admin'
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
  if (status === 'Pending HR') return 'HR'
  if (status === 'Pending Admin') return 'Admin'
  if (status === 'Pending HOD') return 'HOD'
  if (status === 'Pending your acknowledgment') return 'Creator'
  if (status === 'Closed') return 'Closed'
  return null
}

export function parseEmployeeId(employeeId) {
  if (employeeId == null || employeeId === '') return null
  const n = parseInt(employeeId, 10)
  return Number.isNaN(n) ? null : n
}

export function getTATFromRequisition(row) {
  const now = new Date()
  const toTs = (d) => (d ? new Date(d) : null)
  const hoursBetween = (start, end) => {
    if (!start) return null
    const s = toTs(start).getTime()
    const e = end ? toTs(end).getTime() : now.getTime()
    return (e - s) / (1000 * 60 * 60)
  }
  const buckets = [
    { name: 'HOD', start: row.req_created_at, end: row.req_hod_approval_date || null },
    ...(row.req_hr_approval_date != null ? [{ name: 'HR', start: row.req_hod_approval_date || null, end: row.req_hr_approval_date || null }] : []),
    { name: 'Committee', start: (row.req_hr_approval_date || row.req_hod_approval_date) || null, end: row.req_committee_approval_date || null },
    { name: 'CEO', start: row.req_committee_approval_date || null, end: row.req_ceo_approval_date || null },
    { name: 'Procurement', start: row.req_ceo_approval_date || null, end: row.req_handed_to_finance_date || null },
    { name: 'Finance', start: row.req_handed_to_finance_date || null, end: row.req_finance_approval_date || null },
    { name: 'Procurement (complete)', start: row.req_finance_approval_date || null, end: row.req_purchase_completed_date || null },
    { name: 'HOD Acknowledge', start: row.req_purchase_completed_date || null, end: row.req_hod_acknowledged_date || null },
    { name: 'Creator Acknowledge', start: (row.req_purchase_completed_date || row.req_admin_approval_date || row.req_finance_approval_date) || null, end: row.req_creator_acknowledged_date || null }
  ]
  const withDuration = buckets.map((b) => {
    const hours = hoursBetween(b.start, b.end)
    return {
      name: b.name,
      start: b.start || null,
      end: b.end || null,
      hours: hours != null ? Math.round(hours * 100) / 100 : null,
      days: hours != null ? Math.round((hours / 24) * 100) / 100 : null
    }
  })
  const totalHours = withDuration.reduce((sum, b) => sum + (b.hours != null ? b.hours : 0), 0)
  return { buckets: withDuration, totalHours: Math.round(totalHours * 100) / 100 }
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
