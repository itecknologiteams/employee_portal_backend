import { executeQuery } from '../config/database.js'
import { getConnection, getQueue, getReminderRedisKey } from '../config/bullmq.js'
import { sendRequisitionReminder } from '../config/email.js'
import { buildRequisitionEmailHtml, getPortalUrl } from '../config/requisition-email-template.js'

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

    const reqDateFormatted = row.req_required_by_date
      ? new Date(row.req_required_by_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      : '—'

    let urgencyColor = '#d97706'
    let urgencyLabel = ''
    let daysMessage = ''

    const portalUrl = getPortalUrl()
    if (daysLeft === 3) {
      if (lastSent === null || (now - lastSent) >= SIX_HOURS_MS) {
        shouldSend = true
        urgencyColor = '#2563eb'
        urgencyLabel = '3 Days Remaining'
        daysMessage = '3 days remaining'
        subject = `Requisition ${refNo} – 3 Days Until Required Date`
        body = `Requisition ${refNo} (required by ${reqDateFormatted}) has 3 days remaining.\nCreator: ${creatorName}\n\nOpen in portal: ${portalUrl}`
      }
    } else if (daysLeft === 2) {
      if (lastSent === null || (now - lastSent) >= THREE_HOURS_MS) {
        shouldSend = true
        urgencyColor = '#d97706'
        urgencyLabel = '2 Days Remaining'
        daysMessage = '2 days remaining'
        subject = `Requisition ${refNo} – 2 Days Until Required Date`
        body = `Requisition ${refNo} (required by ${reqDateFormatted}) has 2 days remaining.\nCreator: ${creatorName}\n\nOpen in portal: ${portalUrl}`
      }
    } else if (daysLeft <= 1) {
      if (lastSent === null || (now - lastSent) >= ONE_HOUR_MS) {
        shouldSend = true
        urgencyColor = '#dc2626'
        urgencyLabel = daysLeft === 0 ? 'Due Today' : '1 Day Remaining'
        daysMessage = daysLeft === 0 ? 'due today' : '1 day remaining'
        subject = daysLeft === 0
          ? `Requisition ${refNo} – Due Today`
          : `Requisition ${refNo} – 1 Day Until Required Date`
        body = `Requisition ${refNo} (required by ${reqDateFormatted}) ${daysLeft === 0 ? 'is due today.' : 'has 1 day remaining.'}\nCreator: ${creatorName}\n\nOpen in portal: ${portalUrl}`
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

    const reminderHtml = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:Arial,Helvetica,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:30px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1)">
        <tr>
          <td style="background:linear-gradient(135deg,${urgencyColor},${urgencyColor}cc);padding:28px 30px;text-align:center">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700">Requisition Reminder</h1>
            <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:14px">Ref: <strong>${refNo}</strong> &nbsp;·&nbsp; <strong>${urgencyLabel}</strong></p>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 30px 0">
            <p style="margin:0 0 16px;font-size:15px;color:#444">
              Requisition <strong>${refNo}</strong> is still pending and the required-by date is approaching — <strong style="color:${urgencyColor}">${daysMessage}</strong>.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9ff;border:1px solid #dde3f0;border-radius:6px">
              <tr>
                <td style="padding:10px 16px;border-bottom:1px solid #dde3f0;width:40%"><span style="color:#6b7280;font-size:13px">Requisition No.</span></td>
                <td style="padding:10px 16px;border-bottom:1px solid #dde3f0"><strong style="color:${urgencyColor}">${refNo}</strong></td>
              </tr>
              <tr>
                <td style="padding:10px 16px;border-bottom:1px solid #dde3f0"><span style="color:#6b7280;font-size:13px">Submitted By</span></td>
                <td style="padding:10px 16px;border-bottom:1px solid #dde3f0"><span style="color:#111">${creatorName}</span></td>
              </tr>
              <tr>
                <td style="padding:10px 16px"><span style="color:#6b7280;font-size:13px">Required By</span></td>
                <td style="padding:10px 16px"><span style="color:#111;font-weight:600">${reqDateFormatted}</span></td>
              </tr>
            </table>
            <p style="margin:16px 0 0;font-size:14px;color:#6b7280">Please take action so the requisition can be completed by the required date.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 30px;text-align:center">
            <a href="${portalUrl}" style="display:inline-block;background:${urgencyColor};color:#ffffff;text-decoration:none;padding:12px 30px;border-radius:6px;font-size:15px;font-weight:600">View in Portal</a>
          </td>
        </tr>
        <tr>
          <td style="background:#f8f9ff;padding:16px 30px;text-align:center;border-top:1px solid #e5e7eb">
            <p style="margin:0;font-size:12px;color:#9ca3af">This is an automated notification from the Employee Portal. Please do not reply to this email.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

    await sendRequisitionReminder({ to: toEmails.join(','), subject, body, html: reminderHtml, meta: { event: 'reminder_daily', ref: refNo } })
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
  const requiredBy = data.requiredByDate
    ? new Date(data.requiredByDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : 'Not set'
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

  const portalUrl = getPortalUrl()
  const subject = `New requisition ${refNo} – pending your approval`
  const body = `A new requisition ${refNo} has been submitted by ${creatorName}. Required by: ${requiredBy}. Open in portal: ${portalUrl}`
  const html = buildRequisitionEmailHtml({
    title: 'New requisition',
    refNo,
    creatorName,
    requiredBy,
    departmentName,
    bucketLabel: 'Pending HOD',
    items
  })
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
  const departmentName = row.department_name || ''
  const requiredBy = row.req_required_by_date
    ? new Date(row.req_required_by_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : 'Not set'
  const bucketLabel = BUCKET_LABELS[newBucket] || newBucket
  let items = []
  try {
    const itemRows = await executeQuery(
      'SELECT item_desc, item_qty, item_size, item_brand, item_est_cost FROM requisition_items WHERE req_id = $1 ORDER BY item_id',
      [requisitionId]
    )
    items = itemRows || []
  } catch (_) {}
  const portalUrl = getPortalUrl()
  const subject = `Requisition ${refNo} – new case in your queue (${bucketLabel})`
  const body = `A requisition ${refNo} has been moved to your queue: ${bucketLabel}.\nCreator: ${creatorName}\nRequired by: ${requiredBy}\n\nOpen in portal: ${portalUrl}`
  const html = buildRequisitionEmailHtml({
    title: `Requisition – ${bucketLabel}`,
    refNo,
    creatorName,
    requiredBy,
    departmentName,
    bucketLabel,
    items
  })
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
