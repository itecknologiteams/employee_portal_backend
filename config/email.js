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
  const recipient = (to && String(to).trim()) || process.env.SMTP_USER
  if (!recipient) {
    console.warn('Requisition email: no recipient (to) and no SMTP_USER. Skip.')
    return
  }
  const subj = subject || 'Requisition Reminder'
  console.log('📧 [Email] Sending to:', recipient, '| Subject:', subj)
  try {
    await trans.sendMail({
      from,
      to: recipient,
      subject: subj,
      text: body,
      html: body.replace(/\n/g, '<br/>')
    })
    console.log('📧 [Email] SENT OK →', recipient)
  } catch (err) {
    console.error('📧 [Email] FAILED →', recipient, '| Error:', err.message)
  }
}
