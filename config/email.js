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

/** Portal URL for requisition emails (link to open RFM portal). */
export const REQUISITION_PORTAL_URL = process.env.REQUISITION_PORTAL_URL || process.env.REQUEST_PORTAL_URL || 'http://rfm.itecknologi.internal/'

/**
 * Send requisition reminder email. Logs on failure, does not throw.
 * @param {object} opts
 * @param {string} opts.to - recipient email(s), comma-separated
 * @param {string} opts.subject
 * @param {string} opts.body - plain-text fallback
 * @param {string} [opts.html] - optional HTML body; if omitted, body is used with <br/> newlines
 */
export async function sendRequisitionReminder({ to, subject, body, html }) {
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
  const hasRichHtml = html != null && String(html).trim().length > 0
  const htmlContent = hasRichHtml ? html : (body ? String(body).replace(/\n/g, '<br/>') : '')
  const textContent = body || (hasRichHtml ? 'View requisition in your browser (HTML email).' : '')
  console.log('📧 [Email] Sending to:', recipient, '| Subject:', subj, hasRichHtml ? '| HTML: yes' : '')
  try {
    await trans.sendMail({
      from,
      to: recipient,
      subject: subj,
      text: textContent,
      html: htmlContent || textContent.replace(/\n/g, '<br/>')
    })
    console.log('📧 [Email] SENT OK →', recipient)
  } catch (err) {
    console.error('📧 [Email] FAILED →', recipient, '| Error:', err.message)
  }
}
