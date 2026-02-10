import nodemailer from 'nodemailer'

let transporter = null

function getTransporter() {
  if (transporter) return transporter
  const host = process.env.SMTP_HOST
  const port = parseInt(process.env.SMTP_PORT || '587', 10)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASSWORD || process.env.SMTP_PASS
  if (!host || !user || !pass) return null
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    tls: { rejectUnauthorized: false }
  })
  return transporter
}

export function getEmailTransport() {
  return getTransporter()
}

export function isEmailConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && (process.env.SMTP_PASSWORD || process.env.SMTP_PASS))
}

export const EMAIL_FROM = process.env.EMAIL_FROM || process.env.MAIL_FROM || process.env.SMTP_USER

/**
 * Send requisition reminder email. Logs on failure, does not throw.
 */
export async function sendRequisitionReminder({ to, subject, body }) {
  const trans = getTransporter()
  if (!trans) {
    console.warn('Email not configured (SMTP_*). Skipping send.')
    return
  }
  const from = EMAIL_FROM
  try {
    await trans.sendMail({
      from,
     to:"makhshafzaidi@gmail.com",

      subject: subject || 'Requisition Reminder',
      text: body,
      html: body.replace(/\n/g, '<br/>')
    })
    console.log('✅ Requisition email sent:', { to: to || process.env.SMTP_USER, subject: subject || 'Requisition Reminder' })
  } catch (err) {
    console.error('Requisition reminder email failed:', err.message)
  }
}
