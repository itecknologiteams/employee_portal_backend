import { executeQuery } from '../config/database.js'
import { getConnection, getQueue, getReminderRedisKey } from '../config/bullmq.js'
import { sendRequisitionReminder } from '../config/email.js'
import {
  buildRequisitionEmailHtml,
  buildRequisitionEmailPlainText,
  buildRequisitionReminderPlainText,
  buildRequisitionBucketChangedPlainText,
  buildRequisitionRevertedPlainText,
  buildRequisitionRevertedHtml,
  buildRequisitionResubmittedPlainText,
  buildRequisitionResubmittedHtml,
  buildRequisitionRejectedPlainText,
  buildRequisitionRejectedHtml,
  getPortalUrl
} from '../config/requisition-email-template.js'
import {
  getRequisitionBucket,
  getEmailsForBucket,
  getEmployeeDepartmentIdsForCreator,
  getDepartmentNamesForIds,
  BUCKET_LABELS,
  fetchLineTotalPkrForCeoRule
} from '../src/utils/requisitionEmailRouting.js'
import { resolveEmailsPreferCrmForCodes } from '../src/utils/requisitionEmailRecipients.js'

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000  // 3 days left → email every 4 hr
const THREE_HOURS_MS = 3 * 60 * 60 * 1000 // 2 days left → email every 3 hr
const ONE_HOUR_MS = 60 * 60 * 1000        // 1 day / due today → email every 1 hr

/** HOD recipients for legacy requisition-created job (same resolution as bucket HOD). */
async function getHodEmailsForCreatorDepartments(departmentIdOrIds) {
  return getEmailsForBucket('hod', departmentIdOrIds)
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
    const lineTotal = await fetchLineTotalPkrForCeoRule(reqId)
    const bucket = reqRow ? getRequisitionBucket(reqRow, lineTotal) : 'hod'
    const creatorDeptIds = await getEmployeeDepartmentIdsForCreator(row.req_emp_id)
    let toEmails = bucket ? await getEmailsForBucket(bucket, bucket === 'hod' ? creatorDeptIds : row.department_id) : []
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
    const departmentName = (
      (await getDepartmentNamesForIds(creatorDeptIds)) || row.department_name || ''
    ).trim()
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

  // Stationary has no required-by date — send one reminder per day until admin approves (closes) the requisition
  const stationaryQuery = `
    SELECT r.req_id, r.req_reference_no, r.req_emp_id, r.req_material,
           r.req_current_stage_key,
           e.first_name, e.last_name, e.department_id,
           d.department_name
    FROM requisition r
    JOIN employees e ON r.req_emp_id = e.employee_id
    LEFT JOIN departments d ON e.department_id = d.department_id
    WHERE r.req_required_by_date IS NULL
      AND LOWER(TRIM(r.req_category)) = 'stationary'
      AND COALESCE(r.req_is_rejected, 0) = 0
      AND COALESCE(r.req_admin_approval, 0) = 0
  `
  let stationaryRows = []
  try {
    stationaryRows = await executeQuery(stationaryQuery, [])
  } catch (err) {
    console.error('Stationary reminder query failed:', err.message)
  }

  for (const row of stationaryRows) {
    const reqId = row.req_id
    const refNo = row.req_reference_no || '#' + reqId
    const creatorName = `${row.first_name || ''} ${row.last_name || ''}`.trim()

    const dayKey = getReminderRedisKey(reqId) + ':day:' + todayStr
    try {
      if (await redis.get(dayKey)) continue
    } catch (_) {}

    const stageKey = row.req_current_stage_key || 'admin'
    const creatorDeptIds = await getEmployeeDepartmentIdsForCreator(row.req_emp_id)
    let toEmails = await getEmailsForBucket(stageKey, stageKey === 'hod' ? creatorDeptIds : row.department_id)
    if (!toEmails.length) {
      const testEmail = (process.env.TEST_REMINDER_EMAIL || '').trim()
      if (testEmail) {
        toEmails = [testEmail]
        console.log(`Requisition ${reqId} (Stationary): sending reminder to TEST_REMINDER_EMAIL (no recipient for bucket ${stageKey})`)
      } else {
        console.warn(`Requisition ${reqId} (Stationary): no recipient for bucket ${stageKey}. Skip. Set TEST_REMINDER_EMAIL in .env to test.`)
        continue
      }
    }

    const creatorDescription = (row.req_material || '').trim()
    const departmentName = (
      (await getDepartmentNamesForIds(creatorDeptIds)) || row.department_name || ''
    ).trim()
    let items = []
    try {
      const itemRows = await executeQuery(
        'SELECT item_desc, item_qty, item_size, item_brand, item_est_cost FROM requisition_items WHERE req_id = $1 ORDER BY item_id',
        [reqId]
      )
      items = itemRows || []
    } catch (_) {}

    const bucketLabel = BUCKET_LABELS[stageKey] || stageKey
    const subject = `Requisition ${refNo} – Pending ${bucketLabel} (Stationary)`
    const body = buildRequisitionReminderPlainText({
      refNo,
      creatorName,
      requiredBy: 'N/A',
      departmentName,
      bucketLabel,
      creatorDescription,
      daysMessage: 'pending',
      items
    })
    const html = buildRequisitionEmailHtml({
      title: `Requisition Reminder – ${bucketLabel}`,
      refNo,
      creatorName,
      requiredBy: 'N/A',
      departmentName,
      bucketLabel,
      creatorDescription,
      items
    })
    await sendRequisitionReminder({ to: toEmails.join(','), subject, body, html })
    try {
      await redis.set(dayKey, '1')
      await redis.expire(dayKey, 2 * 24 * 60 * 60)
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
  let hodDeptIds = []
  if (data.requisitionId) {
    try {
      const r = await executeQuery('SELECT req_emp_id FROM requisition WHERE req_id = $1', [data.requisitionId])
      if (r[0]?.req_emp_id != null) hodDeptIds = await getEmployeeDepartmentIdsForCreator(r[0].req_emp_id)
    } catch (_) {}
  }
  if (hodDeptIds.length === 0 && data.departmentId != null) hodDeptIds = [data.departmentId]
  const toEmails = hodDeptIds.length ? await getHodEmailsForCreatorDepartments(hodDeptIds) : []
  if (!toEmails.length) {
    console.log('[BullMQ] requisition-created:', refNo, '– no HOD email, skip notify')
    return
  }

  let departmentName = ''
  try {
    if (hodDeptIds.length) departmentName = await getDepartmentNamesForIds(hodDeptIds)
    else if (data.departmentId != null) {
      const dept = await executeQuery(
        'SELECT d.department_name FROM departments d WHERE d.department_id = $1',
        [data.departmentId]
      )
      departmentName = dept[0]?.department_name || ''
    }
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
  const validBuckets = ['hod', 'it', 'hr', 'committee', 'ceo', 'procurement', 'finance', 'admin', 'admin_acknowledge', 'admin_handover', 'hr_check']
  if (!validBuckets.includes(newBucket)) {
    console.warn('[BullMQ] requisition-bucket-changed: invalid newBucket', newBucket)
    return
  }
  let row
  try {
    const rows = await executeQuery(
      `SELECT r.req_id, r.req_emp_id, r.req_reference_no, r.req_required_by_date, r.req_material,
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
  const creatorDeptIds = await getEmployeeDepartmentIdsForCreator(row.req_emp_id)
  let toEmails = await getEmailsForBucket(
    newBucket,
    newBucket === 'hod' ? creatorDeptIds : row.department_id
  )
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
  let departmentName = (await getDepartmentNamesForIds(creatorDeptIds)) || row.department_name || ''
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
      `SELECT r.req_id, r.req_emp_id, r.req_reference_no, r.req_required_by_date, r.req_material,
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

  const lineTotal = await fetchLineTotalPkrForCeoRule(reqId)
  const bucket = getRequisitionBucket(row, lineTotal)
  if (!bucket) return

  const creatorDeptIds = await getEmployeeDepartmentIdsForCreator(row.req_emp_id)
  const toEmails = await getEmailsForBucket(
    bucket,
    bucket === 'hod' ? creatorDeptIds : data.departmentId ?? row.department_id
  )
  if (!toEmails.length) {
    console.log('[BullMQ] requisition-reminder-3day-test:', data.referenceNo, '– no recipient for bucket', bucket)
    return
  }

  const refNo = row.req_reference_no || data.referenceNo || '#' + reqId
  const creatorName = `${row.first_name || ''} ${row.last_name || ''}`.trim() || data.creatorName || 'Employee'
  const requiredBy = row.req_required_by_date
    ? new Date(row.req_required_by_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : (data.requiredByDate || 'Not set')
  const departmentName = (
    (await getDepartmentNamesForIds(creatorDeptIds)) || row.department_name || ''
  ).trim()
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
 * Send email when a requisition is reverted to HOD for correction.
 * Notifies HOD of the creator's department.
 * data: { requisitionId, fromStage, revertComment, hodDeptIds }
 */
export async function handleRequisitionReverted(data) {
  const { requisitionId, fromStage, revertComment } = data
  if (!requisitionId) {
    console.warn('[BullMQ] requisition-reverted: missing requisitionId')
    return
  }
  let row
  try {
    const rows = await executeQuery(
      `SELECT r.req_id, r.req_emp_id, r.req_reference_no, r.req_required_by_date, r.req_material,
              e.first_name, e.last_name, e.department_id, d.department_name
       FROM requisition r
       JOIN employees e ON r.req_emp_id = e.employee_id
       LEFT JOIN departments d ON e.department_id = d.department_id
       WHERE r.req_id = $1`,
      [requisitionId]
    )
    row = rows[0]
  } catch (err) {
    console.error('[BullMQ] requisition-reverted: fetch failed', err.message)
    return
  }
  if (!row) {
    console.warn('[BullMQ] requisition-reverted: requisition not found', requisitionId)
    return
  }
  const creatorDeptIds = await getEmployeeDepartmentIdsForCreator(row.req_emp_id)
  let toEmails = await getEmailsForBucket('hod', creatorDeptIds)
  if (!toEmails.length && process.env.TEST_REMINDER_EMAIL) {
    toEmails = [process.env.TEST_REMINDER_EMAIL.trim()]
  }
  if (!toEmails.length) {
    console.log('[BullMQ] requisition-reverted:', row.req_reference_no || requisitionId, '– no HOD email found')
    return
  }

  const refNo = row.req_reference_no || '#' + requisitionId
  const creatorName = `${row.first_name || ''} ${row.last_name || ''}`.trim() || 'Employee'
  const departmentName = (await getDepartmentNamesForIds(creatorDeptIds)) || row.department_name || ''
  const requiredBy = row.req_required_by_date
    ? new Date(row.req_required_by_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : 'Not set'
  let items = []
  try {
    items = await executeQuery(
      'SELECT item_desc, item_product_description, item_qty, item_size, item_brand, item_est_cost FROM requisition_items WHERE req_id = $1 ORDER BY item_id',
      [requisitionId]
    ) || []
  } catch (_) {}

  const stageLabel = fromStage ? fromStage.charAt(0).toUpperCase() + fromStage.slice(1) : 'Approver'
  const subject = `Requisition ${refNo} – Reverted for Correction (from ${stageLabel})`
  const body = buildRequisitionRevertedPlainText({ refNo, creatorName, requiredBy, departmentName, fromStage: stageLabel, revertComment, items })
  const html = buildRequisitionRevertedHtml({ title: `Requisition Reverted for Correction`, refNo, creatorName, requiredBy, departmentName, fromStage: stageLabel, revertComment, items })
  await sendRequisitionReminder({ to: toEmails.join(','), subject, body, html, meta: { event: 'requisition_reverted', ref: refNo, fromStage } })
  console.log('[BullMQ] requisition-reverted: email sent to', toEmails.join(','), 'for req', requisitionId)
}

/**
 * Send email when a reverted requisition is resubmitted by HOD after corrections.
 * Notifies the target stage bucket (e.g., Procurement, Finance, Committee).
 * data: { requisitionId, targetStage }
 */
export async function handleRequisitionResubmitted(data) {
  const { requisitionId, targetStage } = data
  if (!requisitionId || !targetStage) {
    console.warn('[BullMQ] requisition-resubmitted: missing requisitionId or targetStage')
    return
  }
  const validBuckets = ['hod', 'hr', 'committee', 'ceo', 'procurement', 'finance', 'admin']
  if (!validBuckets.includes(targetStage)) {
    console.warn('[BullMQ] requisition-resubmitted: invalid targetStage', targetStage)
    return
  }
  let row
  try {
    const rows = await executeQuery(
      `SELECT r.req_id, r.req_emp_id, r.req_reference_no, r.req_required_by_date, r.req_material,
              e.first_name, e.last_name, e.department_id, d.department_name
       FROM requisition r
       JOIN employees e ON r.req_emp_id = e.employee_id
       LEFT JOIN departments d ON e.department_id = d.department_id
       WHERE r.req_id = $1`,
      [requisitionId]
    )
    row = rows[0]
  } catch (err) {
    console.error('[BullMQ] requisition-resubmitted: fetch failed', err.message)
    return
  }
  if (!row) {
    console.warn('[BullMQ] requisition-resubmitted: requisition not found', requisitionId)
    return
  }
  const creatorDeptIds = await getEmployeeDepartmentIdsForCreator(row.req_emp_id)
  let toEmails = await getEmailsForBucket(targetStage, targetStage === 'hod' ? creatorDeptIds : row.department_id)
  if (!toEmails.length && process.env.TEST_REMINDER_EMAIL) {
    toEmails = [process.env.TEST_REMINDER_EMAIL.trim()]
  }
  if (!toEmails.length) {
    console.log('[BullMQ] requisition-resubmitted:', row.req_reference_no || requisitionId, '– no recipient for stage', targetStage)
    return
  }

  const refNo = row.req_reference_no || '#' + requisitionId
  const creatorName = `${row.first_name || ''} ${row.last_name || ''}`.trim() || 'Employee'
  const departmentName = (await getDepartmentNamesForIds(creatorDeptIds)) || row.department_name || ''
  const requiredBy = row.req_required_by_date
    ? new Date(row.req_required_by_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : 'Not set'
  let items = []
  try {
    items = await executeQuery(
      'SELECT item_desc, item_product_description, item_qty, item_size, item_brand, item_est_cost FROM requisition_items WHERE req_id = $1 ORDER BY item_id',
      [requisitionId]
    ) || []
  } catch (_) {}

  const stageLabel = targetStage.charAt(0).toUpperCase() + targetStage.slice(1)
  const subject = `Requisition ${refNo} – Corrected & Resubmitted (returning to ${stageLabel})`
  const body = buildRequisitionResubmittedPlainText({ refNo, creatorName, requiredBy, departmentName, targetStage: stageLabel, items })
  const html = buildRequisitionResubmittedHtml({ title: 'Requisition Resubmitted After Correction', refNo, creatorName, requiredBy, departmentName, targetStage: stageLabel, items })
  await sendRequisitionReminder({ to: toEmails.join(','), subject, body, html, meta: { event: 'requisition_resubmitted', ref: refNo, targetStage } })
  console.log('[BullMQ] requisition-resubmitted: email sent to', toEmails.join(','), 'for req', requisitionId)
}

/**
 * Send email to the requisition creator when their requisition is rejected.
 * data: { requisitionId, rejectedByStage, rejectionReason }
 */
export async function handleRequisitionRejected(data) {
  const { requisitionId, rejectedByStage, rejectionReason } = data
  if (!requisitionId) {
    console.warn('[BullMQ] requisition-rejected: missing requisitionId')
    return
  }
  let row
  try {
    const rows = await executeQuery(
      `SELECT r.req_id, r.req_emp_id, r.req_reference_no, r.req_required_by_date, r.req_material,
              e.first_name, e.last_name, e.employee_code, e.department_id, d.department_name
       FROM requisition r
       JOIN employees e ON r.req_emp_id = e.employee_id
       LEFT JOIN departments d ON e.department_id = d.department_id
       WHERE r.req_id = $1`,
      [requisitionId]
    )
    row = rows[0]
  } catch (err) {
    console.error('[BullMQ] requisition-rejected: fetch failed', err.message)
    return
  }
  if (!row) {
    console.warn('[BullMQ] requisition-rejected: requisition not found', requisitionId)
    return
  }
  const creatorCode = (row.employee_code || '').trim()
  if (!creatorCode) {
    console.log('[BullMQ] requisition-rejected: creator has no employee code, skip', requisitionId)
    return
  }
  const creatorEmails = await resolveEmailsPreferCrmForCodes([creatorCode])
  if (!creatorEmails.length) {
    console.log('[BullMQ] requisition-rejected: no CRM email found for creator', creatorCode)
    return
  }
  const creatorEmail = creatorEmails[0]

  const refNo = row.req_reference_no || '#' + requisitionId
  const creatorName = `${row.first_name || ''} ${row.last_name || ''}`.trim() || 'Employee'
  const departmentName = row.department_name || ''
  const requiredBy = row.req_required_by_date
    ? new Date(row.req_required_by_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : 'Not set'
  let items = []
  try {
    items = await executeQuery(
      'SELECT item_desc, item_product_description, item_qty, item_size, item_brand, item_est_cost FROM requisition_items WHERE req_id = $1 ORDER BY item_id',
      [requisitionId]
    ) || []
  } catch (_) {}

  const stageLabel = rejectedByStage ? rejectedByStage.charAt(0).toUpperCase() + rejectedByStage.slice(1) : 'Approver'
  const subject = `Requisition ${refNo} – Rejected at ${stageLabel} Stage`
  const body = buildRequisitionRejectedPlainText({ refNo, creatorName, requiredBy, departmentName, rejectedByStage: stageLabel, rejectionReason, items })
  const html = buildRequisitionRejectedHtml({ title: 'Requisition Rejected', refNo, creatorName, requiredBy, departmentName, rejectedByStage: stageLabel, rejectionReason, items })
  await sendRequisitionReminder({ to: creatorEmail, subject, body, html, meta: { event: 'requisition_rejected', ref: refNo, stage: rejectedByStage } })
  console.log('[BullMQ] requisition-rejected: email sent to', creatorEmail, 'for req', requisitionId)
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
  } else if (job.name === 'requisition-reverted') {
    await handleRequisitionReverted(job.data)
  } else if (job.name === 'requisition-resubmitted') {
    await handleRequisitionResubmitted(job.data)
  } else if (job.name === 'requisition-rejected') {
    await handleRequisitionRejected(job.data)
  } else {
    await processRequisitionReminders()
  }
}
