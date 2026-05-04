import { Queue, Worker } from 'bullmq'
import IORedis from 'ioredis'
import { executeQuery } from '../config/database.js'
import { resolveEmailsPreferCrmForCodes } from '../src/utils/requisitionEmailRecipients.js'
import { getEmailTransport, isSmtpConfigured, EMAIL_FROM, APP_NAME } from '../config/email.js'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null })

const QUEUE_NAME = 'requisition-reminders'

/** Delay before sending "please acknowledge" reminder (5 minutes). */
const CREATOR_ACK_REMINDER_DELAY_MS = 5 * 60 * 1000

export const requisitionReminderQueue = new Queue(QUEUE_NAME, {
  connection,
  defaultJobOptions: { removeOnComplete: 100, attempts: 2, backoff: { type: 'exponential', delay: 5000 } },
})

function getRequisitionStatus(row) {
  if (row.req_is_rejected === 1) return 'Rejected'
  if (row.req_finance_approval === 1) return 'Finance Approved - Ready for Purchase'
  if (row.req_handed_to_finance === 1) return 'Pending Finance Approval'
  if (row.req_procurement_ack === 1) {
    const hasQuotations = row.req_quotation_1_url && row.req_quotation_2_url && row.req_quotation_3_url
    if (hasQuotations) return 'Quotations Added - Hand over to Finance'
    return 'Acknowledged by Procurement - Add 3 Quotations'
  }
  if (row.req_ceo_approval === 1) return 'Forwarded to Procurement'
  if (row.req_committee_approval === 1) return 'Pending CEO'
  if (row.req_hod_approval === 1) return 'Pending Committee'
  return 'Pending HOD'
}

function levelLabel(daysLeft) {
  if (daysLeft <= 0) return { level: 4, label: 'Overdue / Urgent' }
  if (daysLeft === 1) return { level: 3, label: '1 day left' }
  if (daysLeft === 2) return { level: 2, label: '2 days left' }
  return { level: 1, label: '3 days left' }
}

async function getRecipientsForStageAndLevel(stage, level, creatorDepartmentId) {
  const codes = new Set()

  const byType = async (typeNames) => {
    const names = Array.isArray(typeNames) ? typeNames : [typeNames]
    const placeholders = names.map((_, i) => `$${i + 1}`).join(',')
    const rows = await executeQuery(
      `SELECT e.employee_code FROM employees e
       INNER JOIN employee_type et ON e.employee_type_id = et.emp_type_id
       WHERE et.emp_type_name IN (${placeholders}) AND e.is_active = true AND e.employee_code IS NOT NULL AND e.employee_code != ''`,
      names
    )
    ;(rows || []).forEach((r) => codes.add(r.employee_code))
  }

  const hodForDepartment = async (deptId) => {
    if (!deptId) return
    const rows = await executeQuery(
      `SELECT e.employee_code FROM employees e
       LEFT JOIN employee_type et ON e.employee_type_id = et.emp_type_id
       LEFT JOIN designation d ON e.designation_id = d.desg_id
       WHERE e.department_id = $1 AND (et.emp_type_name = 'HOD' OR d.desg_name = 'HOD')
         AND e.is_active = true AND e.employee_code IS NOT NULL AND e.employee_code != ''`,
      [creatorDepartmentId]
    )
    ;(rows || []).forEach((r) => codes.add(r.employee_code))
  }

  const addCommittee = () => byType('Committee')
  const addCeo = () => byType('CEO')
  const addProcurement = () => byType('Procurement')
  const addFinance = () => byType('Finance')

  switch (stage) {
    case 'Pending HOD':
      await hodForDepartment(creatorDepartmentId)
      if (level >= 2) await addCommittee()
      if (level >= 3) await addCeo()
      break
    case 'Pending Committee':
      await addCommittee()
      if (level >= 3) await addCeo()
      break
    case 'Pending CEO':
      await addCeo()
      break
    case 'Forwarded to Procurement':
    case 'Acknowledged by Procurement - Add 3 Quotations':
    case 'Quotations Added - Hand over to Finance':
      await addProcurement()
      if (level >= 2) await addCommittee()
      if (level >= 3) await addCeo()
      if (level >= 4) await addFinance()
      break
    case 'Pending Finance Approval':
      await addFinance()
      if (level >= 2) await addCommittee()
      if (level >= 3) await addCeo()
      break
    default:
      await addCommittee()
      await addCeo()
  }

  const codeList = [...codes]
  if (codeList.length === 0) return []
  return resolveEmailsPreferCrmForCodes(codeList)
}

async function processCheckDeadlines() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const inThreeDays = new Date(today)
  inThreeDays.setDate(inThreeDays.getDate() + 3)
  const todayStr = today.toISOString().slice(0, 10)
  const inThreeDaysStr = inThreeDays.toISOString().slice(0, 10)

  const rows = await executeQuery(
    `SELECT r.req_id, r.req_reference_no, r.req_required_by_date, r.req_emp_id, r.req_location, r.req_material,
            e.department_id AS creator_department_id
     FROM requisition r
     INNER JOIN employees e ON r.req_emp_id = e.employee_id
     WHERE r.req_is_rejected = 0 AND (r.req_finance_approval IS NULL OR r.req_finance_approval = 0)
       AND r.req_required_by_date IS NOT NULL
       AND r.req_required_by_date >= $1 AND r.req_required_by_date <= $2`,
    [todayStr, inThreeDaysStr]
  )

  for (const row of rows) {
    const reqId = row.req_id
    const requiredDate = new Date(row.req_required_by_date)
    requiredDate.setHours(0, 0, 0, 0)
    const daysLeft = Math.ceil((requiredDate - today) / (24 * 60 * 60 * 1000))
    const { level, label } = levelLabel(daysLeft)
    const jobId = `reminder-${reqId}-${level}-${todayStr}`

    try {
      await requisitionReminderQueue.add(
        'send-reminder',
        {
          reqId,
          daysLeft,
          level,
          label,
          creatorDepartmentId: row.creator_department_id,
        },
        { jobId, removeOnComplete: true }
      )
    } catch (e) {
      if (e.message && !e.message.includes('already exist')) console.error('Add reminder job error:', e)
    }
  }
}

async function processSendReminder(job) {
  const { reqId, daysLeft, level, label, creatorDepartmentId } = job.data
  const rows = await executeQuery(
    `SELECT r.req_id, r.req_reference_no, r.req_required_by_date, r.req_location, r.req_material,
            r.req_hod_approval, r.req_committee_approval, r.req_ceo_approval, r.req_procurement_ack,
            r.req_quotation_1_url, r.req_quotation_2_url, r.req_quotation_3_url,
            r.req_handed_to_finance, r.req_finance_approval, r.req_is_rejected,
            e.first_name, e.last_name
     FROM requisition r
     INNER JOIN employees e ON r.req_emp_id = e.employee_id
     WHERE r.req_id = $1`,
    [reqId]
  )
  if (!rows.length) return
  const req = rows[0]
  const status = getRequisitionStatus(req)
  const recipients = await getRecipientsForStageAndLevel(status, level, creatorDepartmentId)
  if (recipients.length === 0) return

  const refNo = req.req_reference_no || `#${req.req_id}`
  const requiredDate = req.req_required_by_date ? new Date(req.req_required_by_date).toLocaleDateString() : '—'
  const subject = `[${label}] Requisition ${refNo} – ${APP_NAME}`
  const html = `
    <p>Requisition <strong>${refNo}</strong> is still not completed and the required-by date is approaching.</p>
    <ul>
      <li><strong>Required by:</strong> ${requiredDate}</li>
      <li><strong>Current status:</strong> ${status}</li>
      <li><strong>Requested by:</strong> ${req.first_name} ${req.last_name}</li>
      <li><strong>Location:</strong> ${req.req_location || '—'}</li>
      <li><strong>Summary:</strong> ${(req.req_material || '—').slice(0, 200)}</li>
    </ul>
    <p>Please take action so the requisition can be completed by the required date.</p>
    <p><em>This is an automated reminder from ${APP_NAME}.</em></p>
  `

  if (!isSmtpConfigured()) {
    console.warn(`[Requisition Emailer] SMTP not configured – reminder not sent for ${refNo}. Set SMTP_* in .env to send emails.`)
    return
  }
  const transport = getEmailTransport()
  await transport.sendMail({
    from: EMAIL_FROM,
    to: recipients.join(', '),
    subject,
    html,
    text: html.replace(/<[^>]+>/g, ''),
  })
}

/** Send immediate email to creator: requisition ready, please acknowledge within 5 minutes. */
async function sendCreatorAckRequiredEmail(reqId) {
  const rows = await executeQuery(
    `SELECT e.employee_code, e.first_name, e.last_name, r.req_reference_no
     FROM requisition r JOIN employees e ON r.req_emp_id = e.employee_id
     WHERE r.req_id = $1`,
    [reqId]
  )
  if (!rows.length) return
  const creator = rows[0]
  const creatorCode = (creator.employee_code || '').trim()
  if (!creatorCode) return
  const creatorEmails = await resolveEmailsPreferCrmForCodes([creatorCode])
  if (!creatorEmails.length) {
    console.log('[Requisition Emailer] No CRM email for creator', creatorCode, '– ack notification not sent')
    return
  }
  const refNo = creator.req_reference_no || `#${reqId}`
  const portalUrl = (process.env.REQUISITION_PORTAL_URL || process.env.REQUEST_PORTAL_URL || 'http://rfm.itecknologi.internal/').replace(/\/$/, '') + '/'
  const ackUrl = `${portalUrl}requisition/acknowledgment`
  const subject = `Requisition ${refNo} – Please acknowledge within 5 minutes – ${APP_NAME}`
  const html = `
    <p>Dear ${creator.first_name || 'Employee'},</p>
    <p>Your requisition <strong>${refNo}</strong> has been completed by the execution team.</p>
    <p><strong>Please acknowledge within 5 minutes</strong> to close the ticket.</p>
    <p><a href="${ackUrl}">Open Acknowledgment page</a></p>
    <p><em>This is an automated message from ${APP_NAME}.</em></p>
  `
  if (!isSmtpConfigured()) {
    console.warn('[Requisition Emailer] SMTP not configured – creator ack notification not sent.')
    return
  }
  const transport = getEmailTransport()
  await transport.sendMail({
    from: EMAIL_FROM,
    to: creatorEmails[0],
    subject,
    html,
    text: html.replace(/<[^>]+>/g, ''),
  })
  console.log('[Requisition Emailer] Creator ack required email sent to', creatorEmails[0], 'for req', reqId)
}

/** Process delayed job: if creator has not acknowledged, send reminder. */
async function processCreatorAckReminder(job) {
  const { reqId } = job.data
  const rows = await executeQuery(
    `SELECT r.req_id, r.req_reference_no, r.req_creator_acknowledged,
            e.employee_code, e.first_name, e.last_name
     FROM requisition r JOIN employees e ON r.req_emp_id = e.employee_id
     WHERE r.req_id = $1`,
    [reqId]
  )
  if (!rows.length) return
  const row = rows[0]
  if (row.req_creator_acknowledged === 1) return
  const creatorCode = (row.employee_code || '').trim()
  if (!creatorCode) return
  const creatorEmails = await resolveEmailsPreferCrmForCodes([creatorCode])
  if (!creatorEmails.length) {
    console.log('[Requisition Emailer] No CRM email for creator', creatorCode, '– ack reminder not sent')
    return
  }
  const refNo = row.req_reference_no || `#${reqId}`
  const portalUrl = (process.env.REQUISITION_PORTAL_URL || process.env.REQUEST_PORTAL_URL || 'http://rfm.itecknologi.internal/').replace(/\/$/, '') + '/'
  const ackUrl = `${portalUrl}requisition/acknowledgment`
  const subject = `Reminder: Please acknowledge requisition ${refNo} – ${APP_NAME}`
  const html = `
    <p>Dear ${row.first_name || 'Employee'},</p>
    <p>This is a reminder: your requisition <strong>${refNo}</strong> is still waiting for your acknowledgment.</p>
    <p>Please acknowledge as soon as possible to close the ticket.</p>
    <p><a href="${ackUrl}">Open Acknowledgment page</a></p>
    <p><em>This is an automated reminder from ${APP_NAME}.</em></p>
  `
  if (!isSmtpConfigured()) {
    console.warn('[Requisition Emailer] SMTP not configured – creator ack reminder not sent.')
    return
  }
  const transport = getEmailTransport()
  await transport.sendMail({
    from: EMAIL_FROM,
    to: creatorEmails[0],
    subject,
    html,
    text: html.replace(/<[^>]+>/g, ''),
  })
  console.log('[Requisition Emailer] Creator ack reminder sent to', creatorEmails[0], 'for req', reqId)
}

/**
 * Notify creator that they must acknowledge the requisition within 5 minutes.
 * Sends immediate email and schedules a reminder job after 5 minutes.
 * Call when a requisition becomes "pending creator acknowledgment" (Admin approved, Purchase completed, or Loan Finance approved).
 */
export async function notifyCreatorAckRequired(reqId) {
  if (!reqId) return
  try {
    await sendCreatorAckRequiredEmail(reqId)
  } catch (e) {
    console.error('[Requisition Emailer] sendCreatorAckRequiredEmail failed:', e?.message)
  }
  try {
    await requisitionReminderQueue.add(
      'creator-ack-reminder',
      { reqId },
      { delay: CREATOR_ACK_REMINDER_DELAY_MS, jobId: `creator-ack-reminder-${reqId}-${Date.now()}` }
    )
  } catch (e) {
    console.error('[Requisition Emailer] schedule creator-ack-reminder failed:', e?.message)
  }
}

let activeWorker = null

export function startRequisitionEmailerWorker() {
  activeWorker = new Worker(
    QUEUE_NAME,
    async (job) => {
      if (job.name === 'check-deadlines') {
        await processCheckDeadlines()
      } else if (job.name === 'send-reminder') {
        await processSendReminder(job)
      } else if (job.name === 'creator-ack-reminder') {
        await processCreatorAckReminder(job)
      }
    },
    { connection, concurrency: 3 }
  )

  activeWorker.on('completed', (job) => {
    if (job.name === 'send-reminder') return
    console.log(`[Requisition Emailer] ${job.name} completed`)
  })
  activeWorker.on('failed', (job, err) => {
    console.error(`[Requisition Emailer] ${job?.name} failed:`, err?.message)
  })

  return activeWorker
}

export async function scheduleDeadlineChecks() {
  await requisitionReminderQueue.add(
    'check-deadlines',
    {},
    {
      repeat: { pattern: '0 9 * * *' },
      jobId: 'requisition-check-deadlines-daily',
    }
  )
  await requisitionReminderQueue.add('check-deadlines', {}, { jobId: `requisition-check-deadlines-once-${Date.now()}` })
}

export async function closeRequisitionEmailer() {
  if (activeWorker) {
    await activeWorker.close()
    activeWorker = null
  }
  await requisitionReminderQueue.close()
  connection.disconnect()
}
