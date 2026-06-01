import nodemailer from 'nodemailer'

let transporter = null

/**
 * Global BCC added to every outgoing email.
 * Override via .env: EMAIL_BCC=foo@example.com,bar@example.com
 */
export const EMAIL_BCC = (process.env.EMAIL_BCC || 'ali.asif@itecknologi.com').trim()

/**
 * Loan / Advance Salary finance-approval notification recipients.
 * Override via .env: PAYABLE_EMAIL / RECEIVABLE_EMAIL / HR_EMAIL.
 */
export const PAYABLE_EMAIL = (process.env.PAYABLE_EMAIL || 'payable@itecknologi.com').trim()
export const RECEIVABLE_EMAIL = (process.env.RECEIVABLE_EMAIL || 'receivable@itecknologi.com').trim()
export const HR_EMAIL = (process.env.HR_EMAIL || 'hr@itecknologi.com').trim()

function mergeBcc(existing) {
  if (!EMAIL_BCC) return existing
  if (!existing) return EMAIL_BCC
  if (Array.isArray(existing)) return [...existing, EMAIL_BCC]
  return `${existing}, ${EMAIL_BCC}`
}

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
  // Patch sendMail to auto-inject BCC on every outgoing email
  const originalSendMail = transporter.sendMail.bind(transporter)
  transporter.sendMail = (opts, callback) => {
    const merged = { ...opts, bcc: mergeBcc(opts.bcc) }
    return originalSendMail(merged, callback)
  }
  return transporter
}

export function getEmailTransport() {
  return getTransporter()
}

export function isEmailConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && (process.env.SMTP_PASSWORD || process.env.SMTP_PASS))
}

/** Alias for isEmailConfigured (used by requisition-emailer). */
export const isSmtpConfigured = isEmailConfigured

export const EMAIL_FROM = process.env.EMAIL_FROM || process.env.MAIL_FROM || process.env.SMTP_USER

export const APP_NAME = process.env.APP_NAME || 'Employee Portal'

export const EMAIL_LOGO_PATH = process.env.EMAIL_LOGO_PATH || ''

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
  const htmlContent = hasRichHtml ? String(html).trim() : (body ? String(body).replace(/\n/g, '<br/>') : '')
  const textContent = (body || (hasRichHtml ? 'View requisition in your browser (HTML email).' : '')).trim()
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

