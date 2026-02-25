import { executeQuery } from '../config/database.js'
import { getConnection, getQueue, getReminderRedisKey } from '../config/bullmq.js'
import { sendRequisitionReminder, REQUISITION_PORTAL_URL } from '../config/email.js'

/** Dashboard URL for requisition emails (replace localhost with actual frontend). */
function getRequisitionDashboardUrl() {
  const base = process.env.BASE_URL || 'http://192.168.21.31:5173'
  return base.replace(/\/$/, '') + '/dashboard'
}

/** Portal link for all requisition emails – opens RFM portal. */
function getPortalUrl() {
  return REQUISITION_PORTAL_URL.replace(/\/$/, '') + '/'
}

/**
 * Build bold/crazy HTML email for requisition: striking typography, neon accent, summary card, items table, portal CTA.
 * @param {Object} opts - { title, refNo, creatorName, requiredBy, departmentName, bucketLabel, items }
 * @param {Array} opts.items - [{ item_desc, item_size, item_brand, item_qty, item_est_cost }]
 */
function buildRequisitionEmailHtml(opts) {
  const portalUrl = getPortalUrl()
  const title = opts.title || 'Requisition'
  const refNo = opts.refNo || '—'
  const creatorName = opts.creatorName || '—'
  const requiredBy = opts.requiredBy || 'Not set'
  const departmentName = opts.departmentName || ''
  const bucketLabel = opts.bucketLabel || ''
  const items = Array.isArray(opts.items) ? opts.items : []

  const summaryRows = [
    { label: 'Reference', value: refNo },
    { label: 'Created by', value: creatorName },
    { label: 'Required by', value: requiredBy }
  ]
  if (departmentName) summaryRows.push({ label: 'Department', value: departmentName })
  if (bucketLabel) summaryRows.push({ label: 'Status', value: bucketLabel })

  const summaryHtml = summaryRows.map((r) => `<tr><td style="padding:10px 16px 10px 0;font-size:15px;color:#a1a1aa;font-family:'Segoe UI',system-ui,sans-serif;">${escapeHtml(r.label)}</td><td style="padding:10px 0;font-size:15px;font-weight:700;color:#18181b;font-family:'Segoe UI',system-ui,sans-serif;">${escapeHtml(String(r.value))}</td></tr>`).join('')

  let itemsHtml = ''
  if (items.length > 0) {
    const rows = items.map((it, i) => {
      const desc = (it.item_desc || '').trim() || '—'
      const size = it.item_size || '—'
      const brand = it.item_brand || '—'
      const qty = it.item_qty != null ? it.item_qty : '—'
      const cost = it.item_est_cost != null ? it.item_est_cost : '—'
      const bg = i % 2 === 0 ? '#fafafa' : '#ffffff'
      return `<tr style="background:${bg};"><td style="padding:14px 16px;font-size:14px;color:#18181b;font-family:'Segoe UI',system-ui,sans-serif;border-bottom:1px solid #e4e4e7;">${i + 1}</td><td style="padding:14px 16px;font-size:14px;color:#18181b;font-family:'Segoe UI',system-ui,sans-serif;border-bottom:1px solid #e4e4e7;">${escapeHtml(desc)}</td><td style="padding:14px 16px;font-size:14px;color:#52525b;font-family:'Segoe UI',system-ui,sans-serif;border-bottom:1px solid #e4e4e7;">${escapeHtml(String(size))}</td><td style="padding:14px 16px;font-size:14px;color:#52525b;font-family:'Segoe UI',system-ui,sans-serif;border-bottom:1px solid #e4e4e7;">${escapeHtml(String(brand))}</td><td style="padding:14px 16px;font-size:14px;color:#18181b;font-family:'Segoe UI',system-ui,sans-serif;border-bottom:1px solid #e4e4e7;text-align:right;font-weight:700;">${escapeHtml(String(qty))}</td><td style="padding:14px 16px;font-size:14px;color:#18181b;font-family:'Segoe UI',system-ui,sans-serif;border-bottom:1px solid #e4e4e7;text-align:right;font-weight:700;">${escapeHtml(String(cost))}</td></tr>`
    })
    itemsHtml = `
    <div style="margin-top:32px;">
      <p style="margin:0 0 14px 0;font-size:11px;font-weight:800;color:#a1a1aa;letter-spacing:0.2em;text-transform:uppercase;font-family:'Segoe UI',system-ui,sans-serif;">Items</p>
      <table style="width:100%;border-collapse:collapse;border:2px solid #18181b;">
        <thead><tr style="background:#18181b;">
          <th style="padding:14px 16px;text-align:left;font-size:11px;font-weight:800;color:#a4f295;letter-spacing:0.12em;text-transform:uppercase;font-family:'Segoe UI',system-ui,sans-serif;">#</th>
          <th style="padding:14px 16px;text-align:left;font-size:11px;font-weight:800;color:#a4f295;letter-spacing:0.12em;text-transform:uppercase;font-family:'Segoe UI',system-ui,sans-serif;">Description</th>
          <th style="padding:14px 16px;text-align:left;font-size:11px;font-weight:800;color:#a4f295;letter-spacing:0.12em;text-transform:uppercase;font-family:'Segoe UI',system-ui,sans-serif;">Size</th>
          <th style="padding:14px 16px;text-align:left;font-size:11px;font-weight:800;color:#a4f295;letter-spacing:0.12em;text-transform:uppercase;font-family:'Segoe UI',system-ui,sans-serif;">Brand</th>
          <th style="padding:14px 16px;text-align:right;font-size:11px;font-weight:800;color:#a4f295;letter-spacing:0.12em;text-transform:uppercase;font-family:'Segoe UI',system-ui,sans-serif;">Qty</th>
          <th style="padding:14px 16px;text-align:right;font-size:11px;font-weight:800;color:#a4f295;letter-spacing:0.12em;text-transform:uppercase;font-family:'Segoe UI',system-ui,sans-serif;">Est. Cost (PKR)</th>
        </tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>`
  } else {
    itemsHtml = `<p style="margin:24px 0 0 0;font-size:15px;color:#71717a;font-family:'Segoe UI',system-ui,sans-serif;">No items listed – view in portal for details.</p>`
  }

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&display=swap" rel="stylesheet">
</head>
<body style="margin:0;background:#09090b;font-family:'Syne','Segoe UI',system-ui,sans-serif;padding:28px;">
  <div style="max-width:580px;margin:0 auto;">
    <div style="height:6px;background:linear-gradient(90deg,#a4f295 0%,#22c55e 50%,#16a34a 100%);"></div>
    <div style="background:#18181b;padding:0 0 28px 0;">
      <div style="padding:36px 32px 28px 32px;">
        <p style="margin:0 0 8px 0;font-size:11px;font-weight:800;color:#a4f295;letter-spacing:0.25em;text-transform:uppercase;">Requisition</p>
        <h1 style="margin:0;font-size:32px;font-weight:800;color:#ffffff;letter-spacing:-0.02em;line-height:1.15;font-family:'Syne',sans-serif;">${escapeHtml(title)}</h1>
      </div>
      <div style="margin:0 32px 28px 32px;padding:24px 28px;background:#27272a;border-left:4px solid #a4f295;">
        <p style="margin:0 0 18px 0;font-size:11px;font-weight:800;color:#a4f295;letter-spacing:0.2em;text-transform:uppercase;font-family:'Syne',sans-serif;">Summary</p>
        <table style="width:100%;border-collapse:collapse;">${summaryHtml}</table>
      </div>
      <div style="margin:0 32px 0 32px;padding:0 0 28px 0;">
        ${itemsHtml}
      </div>
    </div>
    <div style="background:#27272a;padding:32px;text-align:center;border:2px solid #3f3f46;">
      <a href="${escapeAttr(portalUrl)}" style="display:inline-block;padding:18px 40px;background:linear-gradient(135deg,#a4f295 0%,#22c55e 100%);color:#09090b;text-decoration:none;font-size:16px;font-weight:800;letter-spacing:0.05em;text-transform:uppercase;font-family:'Syne',sans-serif;">Open in Portal</a>
      <p style="margin:20px 0 0 0;font-size:13px;color:#71717a;font-family:'Segoe UI',system-ui,sans-serif;">${escapeHtml(portalUrl)}</p>
    </div>
    <div style="height:6px;background:linear-gradient(90deg,#16a34a 0%,#22c55e 50%,#a4f295 100%);"></div>
  </div>
</body>
</html>`
}

function escapeHtml(s) {
  if (s == null) return ''
  const str = String(s)
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function escapeAttr(s) {
  if (s == null) return ''
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const SIX_HOURS_MS = 6 * 60 * 60 * 1000   // 3 days left → email every 6 hr
const THREE_HOURS_MS = 3 * 60 * 60 * 1000 // 2 days left → email every 3 hr
const ONE_HOUR_MS = 60 * 60 * 1000        // last day → email every 1 hr

function getRequisitionBucket(row) {
  if (row.req_is_rejected === 1) return null
  
  // If purchase completed, route to appropriate bucket based on creator role
  if (row.req_purchase_completed === 1 && row.req_hod_acknowledged !== 1) {
    const creatorRole = row.req_creator_role
    if (creatorRole === 'CEO') return 'ceo'
    if (creatorRole === 'Committee') return 'committee'
    return 'hod' // Default to HOD for regular employees or HOD-created requisitions
  }
  
  if (row.req_finance_approval === 1) return null
  if (row.req_handed_to_finance === 1) return 'finance'
  if (row.req_procurement_ack === 1) return 'procurement'
  if (row.req_ceo_approval === 1) return 'procurement'
  if (row.req_committee_approval === 1) return 'ceo'
  if (row.req_hod_approval === 1) return 'committee'
  return 'hod'
}

async function getHodEmailForDepartment(departmentId) {
  if (departmentId == null) return []
  try {
    const q = `
      SELECT e.email FROM employees e
      LEFT JOIN employee_type et ON e.employee_type_id = et.emp_type_id AND et.emp_type_name = 'HOD'
      LEFT JOIN designation desg ON e.designation_id = desg.desg_id AND desg.desg_name = 'HOD'
      WHERE e.department_id = $1 AND e.is_active = true
        AND (et.emp_type_id IS NOT NULL OR desg.desg_id IS NOT NULL)
      LIMIT 1
    `
    const rows = await executeQuery(q, [departmentId])
    if (rows[0]?.email) return [rows[0].email]
  } catch (err) {
    if (err.code === '42P01') return []
    throw err
  }
  try {
    const rows = await executeQuery(
      `SELECT e.email FROM employees e INNER JOIN employee_type et ON e.employee_type_id = et.emp_type_id AND et.emp_type_name = 'HOD'
       WHERE e.department_id = $1 AND e.is_active = true LIMIT 1`,
      [departmentId]
    )
    return rows[0]?.email ? [rows[0].email] : []
  } catch (err) {
    if (err.code === '42P01') return []
    throw err
  }
  return []
}

async function getEmailsByRole(roleName) {
  try {
    const q = `
      SELECT DISTINCT e.email FROM employees e
      LEFT JOIN employee_type et ON e.employee_type_id = et.emp_type_id AND et.emp_type_name = $1
      LEFT JOIN designation desg ON e.designation_id = desg.desg_id AND desg.desg_name = $1
      WHERE e.is_active = true AND e.email IS NOT NULL AND e.email != ''
        AND (et.emp_type_id IS NOT NULL OR desg.desg_id IS NOT NULL)
    `
    const rows = await executeQuery(q, [roleName])
    return rows.map((r) => r.email).filter(Boolean)
  } catch (err) {
    if (err.code === '42P01') return []
    throw err
  }
}

async function getEmailsForBucket(bucket, departmentId) {
  if (bucket === 'hod') return getHodEmailForDepartment(departmentId)
  if (bucket === 'committee') return getEmailsByRole('Committee')
  if (bucket === 'ceo') return getEmailsByRole('CEO')
  if (bucket === 'procurement') return getEmailsByRole('Procurement')
  if (bucket === 'finance') return getEmailsByRole('Finance')
  return []
}

/**
 * Job processor: find pending requisitions by required_by_date, apply 3/2/1 day rule, send emails, store last sent in Redis.
 */
export async function processRequisitionReminders() {
  const redis = getConnection()
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const query = `
    SELECT r.req_id, r.req_reference_no, r.req_required_by_date, r.req_emp_id,
           e.first_name, e.last_name, e.department_id
    FROM requisition r
    JOIN employees e ON r.req_emp_id = e.employee_id
    WHERE r.req_required_by_date IS NOT NULL
      AND r.req_required_by_date >= $1
      AND COALESCE(r.req_is_rejected, 0) = 0
      AND COALESCE(r.req_finance_approval, 0) = 0
  `
  let rows
  try {
    rows = await executeQuery(query, [today])
  } catch (err) {
    console.error('Requisition reminder query failed:', err.message)
    return
  }

  for (const row of rows) {
    const reqId = row.req_id
    const requiredBy = new Date(row.req_required_by_date)
    requiredBy.setHours(0, 0, 0, 0)
    const daysLeft = Math.floor((requiredBy - today) / (24 * 60 * 60 * 1000))
    const refNo = row.req_reference_no || '#' + reqId
    const creatorName = `${row.first_name || ''} ${row.last_name || ''}`.trim()

    const key = getReminderRedisKey(reqId)
    let lastSent = null
    try {
      const v = await redis.get(key)
      if (v) lastSent = parseInt(v, 10)
    } catch (_) {}

    const now = Date.now()
    let shouldSend = false
    let subject = ''
    let body = ''

    const portalUrl = getPortalUrl()
    if (daysLeft === 3) {
      if (lastSent === null || (now - lastSent) >= SIX_HOURS_MS) {
        shouldSend = true
        subject = `Requisition ${refNo} – 3 days until required by date`
        body = `Requisition ${refNo} (required by ${row.req_required_by_date}) has 3 days remaining.\nCreator: ${creatorName}\n\nOpen in portal: ${portalUrl}`
      }
    } else if (daysLeft === 2) {
      if (lastSent === null || (now - lastSent) >= THREE_HOURS_MS) {
        shouldSend = true
        subject = `Requisition ${refNo} – 2 days until required by date`
        body = `Requisition ${refNo} (required by ${row.req_required_by_date}) has 2 days remaining.\nCreator: ${creatorName}\n\nOpen in portal: ${portalUrl}`
      }
    } else if (daysLeft <= 1) {
      if (lastSent === null || (now - lastSent) >= ONE_HOUR_MS) {
        shouldSend = true
        subject = daysLeft === 0
          ? `Requisition ${refNo} – due today`
          : `Requisition ${refNo} – 1 day until required by date`
        body = `Requisition ${refNo} (required by ${row.req_required_by_date}) ${daysLeft === 0 ? 'is due today.' : 'has 1 day remaining.'}\nCreator: ${creatorName}\n\nOpen in portal: ${portalUrl}`
      }
    }

    if (!shouldSend) continue

    const reqRow = await executeQuery(
      'SELECT req_hod_approval, req_committee_approval, req_ceo_approval, req_procurement_ack, req_handed_to_finance, req_finance_approval, req_is_rejected FROM requisition WHERE req_id = $1',
      [reqId]
    ).then((r) => r[0])
    const bucket = reqRow ? getRequisitionBucket(reqRow) : 'hod'
    const toEmails = bucket ? await getEmailsForBucket(bucket, row.department_id) : []
    if (!toEmails.length) {
      console.warn(`Requisition ${reqId}: no recipient for bucket ${bucket}. Skip.`)
      continue
    }
    await sendRequisitionReminder({ to: toEmails.join(','), subject, body, meta: { event: 'reminder_daily', ref: refNo } })
    try {
      await redis.set(key, String(now))
      const ttlDays = 3
      await redis.expire(key, ttlDays * 24 * 60 * 60)
    } catch (_) {}
  }
}

/**
 * Handle requisition-created job: e.g. notify HOD of new requisition.
 */
export async function handleRequisitionCreated(data) {
  const refNo = data.referenceNo || '#' + data.requisitionId
  const creatorName = data.creatorName || 'Employee'
  const requiredBy = data.requiredByDate || 'Not set'
  const toEmails = data.departmentId != null ? await getHodEmailForDepartment(data.departmentId) : []
  if (!toEmails.length) {
    console.log('[BullMQ] requisition-created:', refNo, '– no HOD email, skip notify')
    return
  }

  let departmentName = ''
  try {
    const dept = await executeQuery(
      'SELECT d.department_name FROM departments d WHERE d.department_id = $1',
      [data.departmentId]
    )
    departmentName = dept[0]?.department_name || ''
  } catch (_) {}

  let items = []
  try {
    const rows = await executeQuery(
      'SELECT item_desc, item_qty, item_size, item_brand, item_est_cost FROM requisition_items WHERE req_id = $1 ORDER BY item_id',
      [data.requisitionId]
    )
    items = rows || []
  } catch (_) {}

  const subject = `New requisition ${refNo} – pending your approval`
  const html = buildRequisitionEmailHtml({
    title: `New requisition ${refNo}`,
    refNo,
    creatorName,
    requiredBy,
    departmentName,
    bucketLabel: 'Pending HOD',
    items
  })
  const body = `A new requisition ${refNo} has been submitted by ${creatorName}. Required by: ${requiredBy}. Open in portal: ${getPortalUrl()}`
  await sendRequisitionReminder({ to: toEmails.join(','), subject, body, html, meta: { event: 'requisition_created', ref: refNo } })
}

const BUCKET_LABELS = {
  hod: 'Pending HOD',
  committee: 'Pending Committee',
  ceo: 'Pending CEO',
  procurement: 'Procurement',
  finance: 'Pending Finance'
}

/**
 * When a requisition moves to a new bucket (Committee / CEO / Procurement / Finance), notify that bucket's recipients.
 */
export async function handleRequisitionBucketChanged(data) {
  const { requisitionId, newBucket } = data
  if (!requisitionId || !newBucket) {
    console.warn('[BullMQ] requisition-bucket-changed: missing requisitionId or newBucket')
    return
  }
  const validBuckets = ['committee', 'ceo', 'procurement', 'finance']
  if (!validBuckets.includes(newBucket)) {
    console.warn('[BullMQ] requisition-bucket-changed: invalid newBucket', newBucket)
    return
  }
  let row
  try {
    const rows = await executeQuery(
      `SELECT r.req_id, r.req_reference_no, r.req_required_by_date,
              e.first_name, e.last_name, e.department_id, d.department_name
       FROM requisition r
       JOIN employees e ON r.req_emp_id = e.employee_id
       LEFT JOIN departments d ON e.department_id = d.department_id
       WHERE r.req_id = $1`,
      [requisitionId]
    )
    row = rows[0]
  } catch (err) {
    console.error('[BullMQ] requisition-bucket-changed: fetch failed', err.message)
    return
  }
  if (!row) {
    console.warn('[BullMQ] requisition-bucket-changed: requisition not found', requisitionId)
    return
  }
  const toEmails = await getEmailsForBucket(newBucket, row.department_id)
  if (!toEmails.length) {
    console.log('[BullMQ] requisition-bucket-changed:', row.req_reference_no || requisitionId, '– no recipient for bucket', newBucket)
    return
  }
  const refNo = row.req_reference_no || '#' + requisitionId
  const creatorName = `${row.first_name || ''} ${row.last_name || ''}`.trim() || 'Employee'
  const requiredBy = row.req_required_by_date ? new Date(row.req_required_by_date).toLocaleDateString() : 'Not set'
  const bucketLabel = BUCKET_LABELS[newBucket] || newBucket
  const departmentName = row.department_name || ''

  let items = []
  try {
    const itemRows = await executeQuery(
      'SELECT item_desc, item_qty, item_size, item_brand, item_est_cost FROM requisition_items WHERE req_id = $1 ORDER BY item_id',
      [requisitionId]
    )
    items = itemRows || []
  } catch (_) {}

  const subject = `Requisition ${refNo} – new case in your queue (${bucketLabel})`
  const html = buildRequisitionEmailHtml({
    title: `Requisition ${refNo} – ${bucketLabel}`,
    refNo,
    creatorName,
    requiredBy,
    departmentName,
    bucketLabel,
    items
  })
  const body = `Requisition ${refNo} has been moved to your queue: ${bucketLabel}. Creator: ${creatorName}. Required by: ${requiredBy}. Open in portal: ${getPortalUrl()}`
  await sendRequisitionReminder({ to: toEmails.join(','), subject, body, html, meta: { event: 'bucket_changed', ref: refNo, bucket: newBucket } })
}

/**
 * Testing: 3-day reminder – optional re-queue for testing. Production reminders use 3d=6hr, 2d=3hr, last day=1hr.
 */
export async function handleRequisitionReminder3DayTest(data) {
  const reqId = data.requisitionId
  let row
  try {
    const rows = await executeQuery(
      `SELECT req_id, req_hod_approval, req_committee_approval, req_ceo_approval, req_procurement_ack, req_handed_to_finance, req_finance_approval, req_is_rejected
       FROM requisition WHERE req_id = $1`,
      [reqId]
    )
    row = rows[0]
  } catch (_) {}

  if (!row || row.req_is_rejected === 1 || row.req_finance_approval === 1) {
    return
  }

  const bucket = getRequisitionBucket(row)
  if (!bucket) return

  const toEmails = await getEmailsForBucket(bucket, data.departmentId)
  if (!toEmails.length) {
    console.log('[BullMQ] requisition-reminder-3day-test:', data.referenceNo, '– no recipient for bucket', bucket)
    return
  }

  const portalUrl = getPortalUrl()
  const refNo = data.referenceNo || '#' + reqId
  const creatorName = data.creatorName || 'Employee'
  const requiredBy = data.requiredByDate || 'Not set'
  const bucketLabel = BUCKET_LABELS[bucket] || bucket
  const subject = `Requisition ${refNo} – ${bucketLabel} (test reminder)`
  const body = `Requisition ${refNo} (required by ${requiredBy}) is pending at: ${bucketLabel}.\nCreator: ${creatorName}\n\nOpen in portal: ${portalUrl}`
  await sendRequisitionReminder({ to: toEmails.join(','), subject, body, meta: { event: 'reminder_3day_test', ref: refNo, bucket } })

  // Re-queue only if explicitly set (default 0 = no repeat; was 2 min for testing)
  const delayMinutes = parseInt(process.env.TEST_REMINDER_AFTER_MINUTES || '0', 10)
  if (delayMinutes > 0) {
    const q = getQueue()
    await q.add('requisition-reminder-3day-test', data, { delay: delayMinutes * 60 * 1000 })
  }
}

/**
 * Single processor for the queue: routes by job name.
 */
export async function processJob(job) {
  if (job.name === 'requisition-created') {
    await handleRequisitionCreated(job.data)
  } else if (job.name === 'requisition-bucket-changed') {
    await handleRequisitionBucketChanged(job.data)
  } else if (job.name === 'requisition-reminder-3day-test') {
    await handleRequisitionReminder3DayTest(job.data)
  } else {
    await processRequisitionReminders()
  }
}
