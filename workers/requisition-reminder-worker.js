import { executeQuery } from '../config/database.js'
import { getConnection, getQueue, getReminderRedisKey } from '../config/bullmq.js'
import { sendRequisitionReminder } from '../config/email.js'

const TWO_HOURS_MS = 2 * 60 * 60 * 1000
const ONE_HOUR_MS = 60 * 60 * 1000

function getRequisitionBucket(row) {
  if (row.req_is_rejected === 1) return null
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

  const baseUrl = process.env.BASE_URL || 'http://localhost:5173'

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

    if (daysLeft === 3) {
      if (lastSent === null) {
        shouldSend = true
        subject = `Requisition ${refNo} – 3 days until required by date`
        body = `Requisition ${refNo} (required by ${row.req_required_by_date}) has 3 days remaining.\nCreator: ${creatorName}\n\nView: ${baseUrl}`
      }
    } else if (daysLeft === 2) {
      if (lastSent === null || (now - lastSent) >= TWO_HOURS_MS) {
        shouldSend = true
        subject = `Requisition ${refNo} – 2 days until required by date`
        body = `Requisition ${refNo} (required by ${row.req_required_by_date}) has 2 days remaining.\nCreator: ${creatorName}\n\nView: ${baseUrl}`
      }
    } else if (daysLeft <= 1) {
      if (lastSent === null || (now - lastSent) >= ONE_HOUR_MS) {
        shouldSend = true
        subject = daysLeft === 0
          ? `Requisition ${refNo} – due today`
          : `Requisition ${refNo} – 1 day until required by date`
        body = `Requisition ${refNo} (required by ${row.req_required_by_date}) ${daysLeft === 0 ? 'is due today.' : 'has 1 day remaining.'}\nCreator: ${creatorName}\n\nView: ${baseUrl}`
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
    await sendRequisitionReminder({ to: toEmails.join(','), subject, body })
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
  const baseUrl = process.env.BASE_URL || 'http://localhost:5173'
  const refNo = data.referenceNo || '#' + data.requisitionId
  const creatorName = data.creatorName || 'Employee'
  const toEmails = data.departmentId != null ? await getHodEmailForDepartment(data.departmentId) : []
  if (!toEmails.length) {
    console.log('[BullMQ] requisition-created:', refNo, '– no HOD email, skip notify')
    return
  }
  const subject = `New requisition ${refNo} – pending your approval`
  const body = `A new requisition ${refNo} has been submitted by ${creatorName}.\nRequired by: ${data.requiredByDate || 'Not set'}\nItems: ${data.itemCount || 0}\n\nView: ${baseUrl}`
  await sendRequisitionReminder({ to: toEmails.join(','), subject, body })
}

/**
 * Testing: 3-day reminder – har 2 min, jis bucket me pending hai usi ko email (HOD / Committee / CEO / Procurement / Finance).
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

  const baseUrl = process.env.BASE_URL || 'http://localhost:5173'
  const refNo = data.referenceNo || '#' + reqId
  const creatorName = data.creatorName || 'Employee'
  const requiredBy = data.requiredByDate || 'Not set'
  const bucketLabel = { hod: 'Pending HOD', committee: 'Pending Committee', ceo: 'Pending CEO', procurement: 'Procurement', finance: 'Pending Finance' }[bucket] || bucket
  const subject = `Requisition ${refNo} – ${bucketLabel} (test reminder)`
  const body = `Requisition ${refNo} (required by ${requiredBy}) is pending at: ${bucketLabel}.\nCreator: ${creatorName}\n\nView: ${baseUrl}`
  await sendRequisitionReminder({ to: toEmails.join(','), subject, body })

  const delayMinutes = parseInt(process.env.TEST_REMINDER_AFTER_MINUTES || '2', 10)
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
  } else if (job.name === 'requisition-reminder-3day-test') {
    await handleRequisitionReminder3DayTest(job.data)
  } else {
    await processRequisitionReminders()
  }
}
