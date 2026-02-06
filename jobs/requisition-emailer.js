import { Queue, Worker } from 'bullmq'
import IORedis from 'ioredis'
import { executeQuery } from '../config/database.js'
import { getEmailTransport, isSmtpConfigured, EMAIL_FROM, APP_NAME } from '../config/email.js'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null })

const QUEUE_NAME = 'requisition-reminders'

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
  const emails = new Set()
  const isPg = process.env.DB_DRIVER !== 'sqlserver'

  const byType = async (typeNames) => {
    const names = Array.isArray(typeNames) ? typeNames : [typeNames]
    const placeholders = names.map((_, i) => `$${i + 1}`).join(',')
    const rows = await executeQuery(
      `SELECT e.email FROM employees e
       INNER JOIN employee_type et ON e.employee_type_id = et.emp_type_id
       WHERE et.emp_type_name IN (${placeholders}) AND e.is_active = true AND e.email IS NOT NULL AND e.email != ''`,
      names
    )
    rows.forEach((r) => emails.add(r.email))
  }

  const hodForDepartment = async (deptId) => {
    if (!deptId) return
    const rows = await executeQuery(
      `SELECT e.email FROM employees e
       LEFT JOIN employee_type et ON e.employee_type_id = et.emp_type_id
       LEFT JOIN designation d ON e.designation_id = d.desg_id
       WHERE e.department_id = $1 AND (et.emp_type_name = 'HOD' OR d.desg_name = 'HOD')
         AND e.is_active = true AND e.email IS NOT NULL AND e.email != ''`,
      [creatorDepartmentId]
    )
    rows.forEach((r) => emails.add(r.email))
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

  return [...emails]
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
            e.first_name, e.last_name, e.email AS creator_email
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

let activeWorker = null

export function startRequisitionEmailerWorker() {
  activeWorker = new Worker(
    QUEUE_NAME,
    async (job) => {
      if (job.name === 'check-deadlines') {
        await processCheckDeadlines()
      } else if (job.name === 'send-reminder') {
        await processSendReminder(job)
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
