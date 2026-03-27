import { executeQuery } from '../config/database.js'
import { resolveEmailsPreferCrmForCodes } from '../src/utils/requisitionEmailRecipients.js'
import { getConnection, getQueue, getReminderRedisKey } from '../config/bullmq.js'
import { sendRequisitionReminder } from '../config/email.js'
import { buildRequisitionEmailHtml, buildRequisitionEmailPlainText, buildRequisitionReminderPlainText, buildRequisitionBucketChangedPlainText, getPortalUrl } from '../config/requisition-email-template.js'

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000  // 3 days left → email every 4 hr
const THREE_HOURS_MS = 3 * 60 * 60 * 1000 // 2 days left → email every 3 hr
const ONE_HOUR_MS = 60 * 60 * 1000        // 1 day / due today → email every 1 hr

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

async function getHodEmployeeCodesForDepartment(departmentId) {
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
  try {
    const rows = await executeQuery(
      `SELECT e.employee_code FROM employees e INNER JOIN employee_type et ON e.employee_type_id = et.emp_type_id AND et.emp_type_name = 'HOD'
       WHERE e.department_id = $1 AND e.is_active = true AND e.employee_code IS NOT NULL LIMIT 5`,
      [departmentId]
    )
    return (rows || []).map((r) => r.employee_code).filter(Boolean)
  } catch (err) {
    if (err.code === '42P01') return []
    return []
  }
}

async function getEmployeeCodesByRole(roleName) {
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

async function getEmailsForBucket(bucket, departmentId) {
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

/** HOD recipients for legacy requisition-created job (same resolution as bucket HOD). */
async function getHodEmailForDepartment(departmentId) {
  return getEmailsForBucket('hod', departmentId)
}

/**
 * Job processor: find pending requisitions by required_by_date, send reminders by rule:
 * - 4+ days left: 1 email per day only
 * - 3 days left: every 4 hours
 * - 2 days left: every 3 hours
 * - 1 day / due today: every 1 hour
 */
/** Office hours: only send reminder emails between 9 AM and 5 PM. Uses REMINDER_TIMEZONE if set (e.g. Asia/Karachi), else server local time. */
function isWithinOfficeHours() {
  const tz = process.env.REMINDER_TIMEZONE || null
  let hour
  if (tz) {
    const parts = new Intl.DateTimeFormat('en-CA', { hour: '2-digit', hour12: false, timeZone: tz }).formatToParts(new Date())
    const h = parts.find((p) => p.type === 'hour')
    hour = h ? parseInt(h.value, 10) : new Date().getHours()
  } else {
    hour = new Date().getHours()
  }
  return hour >= 9 && hour < 17
}

export async function processRequisitionReminders() {
  if (!isWithinOfficeHours()) {
    return // 9 AM – 5 PM only; skip sending outside office hours
  }

  const redis = getConnection()
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayStr = today.toISOString().slice(0, 10) // yyyy-mm-dd for daily throttle

  const query = `
    SELECT r.req_id, r.req_reference_no, r.req_required_by_date, r.req_emp_id, r.req_material,
           e.first_name, e.last_name, e.department_id,
           d.department_name
    FROM requisition r
    JOIN employees e ON r.req_emp_id = e.employee_id
    LEFT JOIN departments d ON e.department_id = d.department_id
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

    // 4+ days left: only one reminder per calendar day
    let alreadySentToday = false
    if (daysLeft >= 4) {
      try {
        const dayKey = getReminderRedisKey(reqId) + ':day:' + todayStr
        if (await redis.get(dayKey)) alreadySentToday = true
      } catch (_) {}
    }

    const now = Date.now()
    let shouldSend = false
    let subject = ''
    let urgencyLabel = ''
    let daysMessage = ''

    const reqDateFormatted = row.req_required_by_date
      ? new Date(row.req_required_by_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      : '—'

    if (daysLeft >= 4) {
      if (!alreadySentToday) {
        shouldSend = true
        const d = daysLeft
        urgencyLabel = d === 4 ? '4 Days Remaining' : `${d} Days Remaining`
        daysMessage = d === 4 ? '4 days remaining' : `${d} days remaining`
        subject = `Requisition ${refNo} – ${urgencyLabel} Until Required Date`
      }
    } else if (daysLeft === 3) {
      if (lastSent === null || (now - lastSent) >= FOUR_HOURS_MS) {
        shouldSend = true
        urgencyLabel = '3 Days Remaining'
        daysMessage = '3 days remaining'
        subject = `Requisition ${refNo} – 3 Days Until Required Date`
      }
    } else if (daysLeft === 2) {
      if (lastSent === null || (now - lastSent) >= THREE_HOURS_MS) {
        shouldSend = true
        urgencyLabel = '2 Days Remaining'
        daysMessage = '2 days remaining'
        subject = `Requisition ${refNo} – 2 Days Until Required Date`
      }
    } else if (daysLeft <= 1) {
      if (lastSent === null || (now - lastSent) >= ONE_HOUR_MS) {
        shouldSend = true
        urgencyLabel = daysLeft === 0 ? 'Due Today' : '1 Day Remaining'
        daysMessage = daysLeft === 0 ? 'due today' : '1 day remaining'
        subject = daysLeft === 0
          ? `Requisition ${refNo} – Due Today`
          : `Requisition ${refNo} – 1 Day Until Required Date`
      }
    }

    if (!shouldSend) continue

    const reqRow = await executeQuery(
      'SELECT req_hod_approval, req_committee_approval, req_ceo_approval, req_procurement_ack, req_handed_to_finance, req_finance_approval, req_is_rejected FROM requisition WHERE req_id = $1',
      [reqId]
    ).then((r) => r[0])
    const bucket = reqRow ? getRequisitionBucket(reqRow) : 'hod'
    let toEmails = bucket ? await getEmailsForBucket(bucket, row.department_id) : []
    if (!toEmails.length) {
      const testEmail = (process.env.TEST_REMINDER_EMAIL || '').trim()
      if (testEmail) {
        toEmails = [testEmail]
        console.log(`Requisition ${reqId}: sending reminder to TEST_REMINDER_EMAIL (no recipient for bucket ${bucket})`)
      } else {
        console.warn(`Requisition ${reqId}: no recipient for bucket ${bucket}. Skip. Set TEST_REMINDER_EMAIL in .env to test.`)
        continue
      }
    }

    const creatorDescription = (row.req_material || '').trim()
    const departmentName = (row.department_name || '').trim()
    let items = []
    try {
      const itemRows = await executeQuery(
        'SELECT item_desc, item_qty, item_size, item_brand, item_est_cost FROM requisition_items WHERE req_id = $1 ORDER BY item_id',
        [reqId]
      )
      items = itemRows || []
    } catch (_) {}

    const body = buildRequisitionReminderPlainText({
      refNo,
      creatorName,
      requiredBy: reqDateFormatted,
      departmentName,
      bucketLabel: urgencyLabel,
      creatorDescription,
      daysMessage,
      items
    })
    const html = buildRequisitionEmailHtml({
      title: `Requisition Reminder – ${urgencyLabel}`,
      refNo,
      creatorName,
      requiredBy: reqDateFormatted,
      departmentName,
      bucketLabel: urgencyLabel,
      creatorDescription,
      items
    })
    await sendRequisitionReminder({ to: toEmails.join(','), subject, body, html })
    try {
      await redis.set(key, String(now))
      await redis.expire(key, 3 * 24 * 60 * 60)
      // 4+ days left: mark "sent today" so we send at most 1 email per day
      if (daysLeft >= 4) {
        const dayKey = getReminderRedisKey(reqId) + ':day:' + todayStr
        await redis.set(dayKey, '1')
        await redis.expire(dayKey, 2 * 24 * 60 * 60)
      }
    } catch (_) {}
  }
}

/**
 * Handle requisition-created job (legacy): not used on create anymore; create flow sends only one email via requisition-bucket-changed. Kept so existing queued jobs still run.
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

  let creatorDescription = (data.creatorDescription || '').trim()
  if (!creatorDescription) {
    try {
      const reqRow = await executeQuery(
        'SELECT req_material FROM requisition WHERE req_id = $1',
        [data.requisitionId]
      )
      creatorDescription = (reqRow[0]?.req_material || '').trim()
    } catch (_) {}
  }

  let items = []
  try {
    const rows = await executeQuery(
      'SELECT item_desc, item_qty, item_size, item_brand, item_est_cost FROM requisition_items WHERE req_id = $1 ORDER BY item_id',
      [data.requisitionId]
    )
    items = rows || []
  } catch (_) {}

  const subject = `New requisition ${refNo} – pending your approval`
  const body = buildRequisitionEmailPlainText({ refNo, creatorName, requiredBy, departmentName, bucketLabel: 'Pending HOD', creatorDescription, items })
  const html = buildRequisitionEmailHtml({
    title: 'New requisition',
    refNo,
    creatorName,
    requiredBy,
    departmentName,
    bucketLabel: 'Pending HOD',
    creatorDescription,
    items
  })
  await sendRequisitionReminder({ to: toEmails.join(','), subject, body, html, meta: { event: 'requisition_created', ref: refNo } })
}

const BUCKET_LABELS = {
  hod: 'Pending HOD',
  hr: 'Pending HR',
  committee: 'Pending Committee',
  ceo: 'Pending CEO',
  procurement: 'Procurement',
  finance: 'Pending Finance'
}

/**
 * When a requisition moves to a new bucket (HOD / HR / Committee / CEO / Procurement / Finance), notify that bucket's recipients.
 * Sends immediately when the workflow advances — no filter on required_by_date (unlike processRequisitionReminders, which is date-driven).
 */
export async function handleRequisitionBucketChanged(data) {
  const { requisitionId, newBucket } = data
  if (!requisitionId || !newBucket) {
    console.warn('[BullMQ] requisition-bucket-changed: missing requisitionId or newBucket')
    return
  }
  const validBuckets = ['hod', 'hr', 'committee', 'ceo', 'procurement', 'finance']
  if (!validBuckets.includes(newBucket)) {
    console.warn('[BullMQ] requisition-bucket-changed: invalid newBucket', newBucket)
    return
  }
  let row
  try {
    const rows = await executeQuery(
      `SELECT r.req_id, r.req_reference_no, r.req_required_by_date, r.req_material,
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
  let toEmails = await getEmailsForBucket(newBucket, row.department_id)
  if (!toEmails.length && process.env.TEST_REMINDER_EMAIL) {
    toEmails = [process.env.TEST_REMINDER_EMAIL.trim()]
    console.log('[BullMQ] requisition-bucket-changed: no recipient for bucket', newBucket, '– using TEST_REMINDER_EMAIL')
  }
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
  const creatorDescription = (row.req_material || '').trim()
  const body = buildRequisitionBucketChangedPlainText({ refNo, creatorName, requiredBy, departmentName, bucketLabel, creatorDescription, items })
  const html = buildRequisitionEmailHtml({
    title: `Requisition – ${bucketLabel}`,
    refNo,
    creatorName,
    requiredBy,
    departmentName,
    bucketLabel,
    creatorDescription,
    items
  })
  const subject = `Requisition ${refNo} – ${bucketLabel} (moved to your queue)`
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
      `SELECT r.req_id, r.req_reference_no, r.req_required_by_date, r.req_material,
              r.req_hod_approval, r.req_committee_approval, r.req_ceo_approval, r.req_procurement_ack, r.req_handed_to_finance, r.req_finance_approval, r.req_is_rejected,
              e.first_name, e.last_name, e.department_id, d.department_name
       FROM requisition r
       JOIN employees e ON r.req_emp_id = e.employee_id
       LEFT JOIN departments d ON e.department_id = d.department_id
       WHERE r.req_id = $1`,
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

  const refNo = row.req_reference_no || data.referenceNo || '#' + reqId
  const creatorName = `${row.first_name || ''} ${row.last_name || ''}`.trim() || data.creatorName || 'Employee'
  const requiredBy = row.req_required_by_date
    ? new Date(row.req_required_by_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : (data.requiredByDate || 'Not set')
  const departmentName = (row.department_name || '').trim()
  const creatorDescription = (row.req_material || '').trim()
  const bucketLabel = BUCKET_LABELS[bucket] || bucket
  let items = []
  try {
    items = await executeQuery(
      'SELECT item_desc, item_qty, item_size, item_brand, item_est_cost FROM requisition_items WHERE req_id = $1 ORDER BY item_id',
      [reqId]
    ) || []
  } catch (_) {}

  const subject = `Requisition ${refNo} – ${bucketLabel} (test reminder)`
  const body = buildRequisitionReminderPlainText({
    refNo,
    creatorName,
    requiredBy,
    departmentName,
    bucketLabel,
    creatorDescription,
    daysMessage: 'pending (test)',
    items
  })
  const html = buildRequisitionEmailHtml({
    title: `Requisition Reminder – Test`,
    refNo,
    creatorName,
    requiredBy,
    departmentName,
    bucketLabel,
    creatorDescription,
    items
  })
  await sendRequisitionReminder({ to: toEmails.join(','), subject, body, html, meta: { event: 'reminder_3day_test', ref: refNo, bucket } })

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
