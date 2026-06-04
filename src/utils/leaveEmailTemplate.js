/**
 * Shared HTML/text email template for leave notifications (creation, approval, rejection,
 * HOD→HR notices). Pure and side-effect free so it can be unit-tested.
 */

const ACCENTS = {
  green: '#16a34a', // approved
  red: '#dc2626',   // rejected
  blue: '#2563eb',  // new / informational
  amber: '#d97706'  // pending action
}

/** Escape a value for safe interpolation into HTML. */
function esc(value) {
  if (value == null) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const DASH = '—'

/**
 * Render a branded leave email.
 * @param {Object} opts
 * @param {string} [opts.title]       Banner heading, e.g. "Leave Request Approved".
 * @param {'green'|'red'|'blue'|'amber'} [opts.accent='blue']  Banner color.
 * @param {string} [opts.greeting]    e.g. "Dear Syed Zia,".
 * @param {string[]} [opts.introLines] Paragraphs shown under the greeting.
 * @param {Array<{label:string, value:any}>} [opts.details]    Key/value detail rows.
 * @param {string|null} [opts.reason] Optional reason block.
 * @param {string} [opts.footerNote]  Footer line.
 * @returns {{ html: string, text: string }}
 */
export function renderLeaveEmail({
  title = 'Leave Notification',
  accent = 'blue',
  greeting = '',
  introLines = [],
  details = [],
  reason = null,
  footerNote = 'This is an automated message from the Employee Portal. Please do not reply.'
} = {}) {
  const color = ACCENTS[accent] || ACCENTS.blue
  const rows = (details || []).filter((d) => d && d.label)

  const detailRowsHtml = rows
    .map(
      (d) => `
            <tr>
              <td style="padding:8px 12px;color:#6b7280;font-size:13px;white-space:nowrap;vertical-align:top;">${esc(d.label)}</td>
              <td style="padding:8px 12px;color:#111827;font-size:14px;font-weight:500;">${d.value == null || d.value === '' ? DASH : esc(d.value)}</td>
            </tr>`
    )
    .join('')

  const introHtml = (introLines || [])
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 12px;color:#374151;font-size:14px;line-height:1.6;">${esc(p)}</p>`)
    .join('')

  const reasonHtml = reason
    ? `<div style="margin-top:16px;padding:12px 14px;background:#f9fafb;border-left:3px solid ${color};border-radius:4px;">
            <div style="color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px;">Reason</div>
            <div style="color:#111827;font-size:14px;line-height:1.6;">${esc(reason)}</div>
          </div>`
    : ''

  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08);">
          <tr>
            <td style="background:${color};padding:18px 24px;">
              <h1 style="margin:0;color:#ffffff;font-size:18px;font-weight:600;">${esc(title)}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:24px;">
              ${greeting ? `<p style="margin:0 0 12px;color:#111827;font-size:15px;font-weight:600;">${esc(greeting)}</p>` : ''}
              ${introHtml}
              ${rows.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;border:1px solid #e5e7eb;border-radius:6px;border-collapse:separate;">${detailRowsHtml}</table>` : ''}
              ${reasonHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:14px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;">
              <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.5;">${esc(footerNote)}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  const textLines = [title, '']
  if (greeting) textLines.push(greeting, '')
  for (const p of (introLines || []).filter(Boolean)) textLines.push(p)
  if ((introLines || []).filter(Boolean).length) textLines.push('')
  for (const d of rows) textLines.push(`${d.label}: ${d.value == null || d.value === '' ? DASH : d.value}`)
  if (reason) textLines.push('', 'Reason:', reason)
  textLines.push('', footerNote)
  const text = textLines.join('\n')

  return { html, text }
}
