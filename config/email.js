import nodemailer from 'nodemailer'

let transporter = null

function getTransporter() {
  if (transporter) return transporter
  const host = process.env.SMTP_HOST
  const port = parseInt(process.env.SMTP_PORT || '587', 10)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASSWORD
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

export function isEmailConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD)
}

/**
 * Send requisition reminder email. Logs on failure, does not throw.
 */
export async function sendRequisitionReminder({ to, subject, body }) {
  const trans = getTransporter()
  if (!trans) {
    console.warn('Email not configured (SMTP_*). Skipping send.')
    return
  }
  const from = process.env.MAIL_FROM || process.env.SMTP_USER
  try {
    await trans.sendMail({
      from,
      to: 'makhshafzaidi@gmail.com',
      subject: subject || 'Requisition Reminder',
      text: body,
      html: body.replace(/\n/g, '<br/>')
    })
  } catch (err) {
    console.error('Requisition reminder email failed:', err.message)
  }
}
