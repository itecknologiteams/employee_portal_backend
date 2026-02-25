import { REQUISITION_PORTAL_URL } from './email.js'

export function getPortalUrl() {
  return (REQUISITION_PORTAL_URL || 'http://rfm.itecknologi.internal/').replace(/\/$/, '') + '/'
}

/**
 * Build clean plain-text body for requisition emails (avoids malformed "Summary: • -- Qty" when clients strip HTML).
 * @param {Object} opts - { refNo, creatorName, requiredBy, departmentName, bucketLabel, creatorDescription, items }
 * @returns {string}
 */
export function buildRequisitionEmailPlainText(opts) {
  const refNo = opts.refNo || '—'
  const creatorName = opts.creatorName || '—'
  const requiredBy = opts.requiredBy || 'Not set'
  const departmentName = (opts.departmentName || '').trim()
  const bucketLabel = (opts.bucketLabel || '').trim()
  const creatorDescription = (opts.creatorDescription || '').trim()
  const items = Array.isArray(opts.items) ? opts.items : []
  const portalUrl = getPortalUrl()

  const lines = [
    '────────────────────────────────────────',
    '  EMPLOYEE PORTAL – Requisition Notification',
    '────────────────────────────────────────',
    '',
    `A new requisition ${refNo} has been submitted by ${creatorName}.`,
    '',
    `Required by date: ${requiredBy}`,
  ]
  if (creatorDescription) lines.push('', `Description: ${creatorDescription}`, '')
  if (departmentName) lines.push(`Department: ${departmentName}`)
  if (bucketLabel) lines.push(`Status: ${bucketLabel}`)
  if (departmentName || bucketLabel) lines.push('')

  if (items.length > 0) {
    lines.push(`Items (${items.length}):`)
    items.forEach((it, i) => {
      const desc = (it.item_desc || '').trim() || 'No description'
      const qty = it.item_qty != null ? it.item_qty : 1
      const size = (it.item_size || '').trim()
      const brand = (it.item_brand || '').trim()
      const cost = it.item_est_cost != null ? `Est. PKR ${it.item_est_cost}` : ''
      const extra = [size, brand, cost].filter(Boolean).join(' · ')
      lines.push(`  ${i + 1}. ${desc} — Qty: ${qty}${extra ? ` (${extra})` : ''}`)
    })
  } else {
    lines.push('Items: No items listed.')
  }

  lines.push('', 'Please review and take action in the portal.', '', `View in portal: ${portalUrl}`, '')
  return lines.join('\n').trim()
}

/**
 * Same structure as plain-text notification but for reminder emails (3d/2d/1d/due today).
 * @param {Object} opts - { refNo, creatorName, requiredBy, departmentName, bucketLabel (urgencyLabel), creatorDescription, daysMessage, items }
 * @returns {string}
 */
export function buildRequisitionReminderPlainText(opts) {
  const refNo = opts.refNo || '—'
  const creatorName = opts.creatorName || '—'
  const requiredBy = opts.requiredBy || 'Not set'
  const departmentName = (opts.departmentName || '').trim()
  const bucketLabel = (opts.bucketLabel || '').trim()
  const creatorDescription = (opts.creatorDescription || '').trim()
  const daysMessage = (opts.daysMessage || '').trim()
  const items = Array.isArray(opts.items) ? opts.items : []
  const portalUrl = getPortalUrl()

  const lines = [
    '────────────────────────────────────────',
    '  EMPLOYEE PORTAL – Requisition Reminder',
    '────────────────────────────────────────',
    '',
    `Reminder: Requisition ${refNo} is ${daysMessage}. Creator: ${creatorName}.`,
    '',
    `Required by date: ${requiredBy}`,
  ]
  if (creatorDescription) lines.push('', `Description: ${creatorDescription}`, '')
  if (departmentName) lines.push(`Department: ${departmentName}`)
  if (bucketLabel) lines.push(`Status: ${bucketLabel}`)
  if (departmentName || bucketLabel) lines.push('')

  if (items.length > 0) {
    lines.push(`Items (${items.length}):`)
    items.forEach((it, i) => {
      const desc = (it.item_desc || '').trim() || 'No description'
      const qty = it.item_qty != null ? it.item_qty : 1
      const size = (it.item_size || '').trim()
      const brand = (it.item_brand || '').trim()
      const cost = it.item_est_cost != null ? `Est. PKR ${it.item_est_cost}` : ''
      const extra = [size, brand, cost].filter(Boolean).join(' · ')
      lines.push(`  ${i + 1}. ${desc} — Qty: ${qty}${extra ? ` (${extra})` : ''}`)
    })
  } else {
    lines.push('Items: No items listed.')
  }

  lines.push('', 'Please review and take action in the portal.', '', `View in portal: ${portalUrl}`, '')
  return lines.join('\n').trim()
}

/**
 * Same structure as notification but for "moved to your queue" (bucket-changed) emails.
 * @param {Object} opts - { refNo, creatorName, requiredBy, departmentName, bucketLabel, creatorDescription, items }
 * @returns {string}
 */
export function buildRequisitionBucketChangedPlainText(opts) {
  const refNo = opts.refNo || '—'
  const creatorName = opts.creatorName || '—'
  const requiredBy = opts.requiredBy || 'Not set'
  const departmentName = (opts.departmentName || '').trim()
  const bucketLabel = (opts.bucketLabel || '').trim()
  const creatorDescription = (opts.creatorDescription || '').trim()
  const items = Array.isArray(opts.items) ? opts.items : []
  const portalUrl = getPortalUrl()

  const lines = [
    '────────────────────────────────────────',
    '  EMPLOYEE PORTAL – Requisition (Moved to Your Queue)',
    '────────────────────────────────────────',
    '',
    `Requisition ${refNo} has been moved to your queue: ${bucketLabel}. Creator: ${creatorName}.`,
    '',
    `Required by date: ${requiredBy}`,
  ]
  if (creatorDescription) lines.push('', `Description: ${creatorDescription}`, '')
  if (departmentName) lines.push(`Department: ${departmentName}`)
  if (bucketLabel) lines.push(`Status: ${bucketLabel}`)
  if (departmentName || bucketLabel) lines.push('')

  if (items.length > 0) {
    lines.push(`Items (${items.length}):`)
    items.forEach((it, i) => {
      const desc = (it.item_desc || '').trim() || 'No description'
      const qty = it.item_qty != null ? it.item_qty : 1
      const size = (it.item_size || '').trim()
      const brand = (it.item_brand || '').trim()
      const cost = it.item_est_cost != null ? `Est. PKR ${it.item_est_cost}` : ''
      const extra = [size, brand, cost].filter(Boolean).join(' · ')
      lines.push(`  ${i + 1}. ${desc} — Qty: ${qty}${extra ? ` (${extra})` : ''}`)
    })
  } else {
    lines.push('Items: No items listed.')
  }

  lines.push('', 'Please review and take action in the portal.', '', `View in portal: ${portalUrl}`, '')
  return lines.join('\n').trim()
}

function escapeHtml(s) {
  if (s == null) return ''
  const str = String(s)
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function escapeAttr(s) {
  if (s == null) return ''
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Build bold HTML email for requisition. Used by both API (on create) and worker (queue).
 * @param {Object} opts - { title, refNo, creatorName, requiredBy, departmentName, bucketLabel, creatorDescription, items }
 * @param {Array} opts.items - [{ item_desc, item_size, item_brand, item_qty, item_est_cost }]
 */
export function buildRequisitionEmailHtml(opts) {
  const portalUrl = getPortalUrl()
  const title = opts.title || 'Requisition'
  const refNo = opts.refNo || '—'
  const creatorName = opts.creatorName || '—'
  const requiredBy = opts.requiredBy || 'Not set'
  const departmentName = opts.departmentName || ''
  const bucketLabel = opts.bucketLabel || ''
  const creatorDescription = (opts.creatorDescription || '').trim()
  const items = Array.isArray(opts.items) ? opts.items : []

  const summaryRows = [
    { label: 'Reference', value: refNo },
    { label: 'Created by', value: creatorName },
    { label: 'Required by', value: requiredBy }
  ]
  if (creatorDescription) summaryRows.push({ label: 'Description', value: creatorDescription })
  if (departmentName) summaryRows.push({ label: 'Department', value: departmentName })
  if (bucketLabel) summaryRows.push({ label: 'Status', value: bucketLabel })

  const summaryHtml = summaryRows.map((r) =>
    `<tr><td style="padding:8px 12px 8px 0;font-size:13px;color:#6b7280;font-family:Arial,sans-serif;">${escapeHtml(r.label)}</td><td style="padding:8px 0;font-size:14px;font-weight:600;color:#111827;font-family:Arial,sans-serif;">${escapeHtml(String(r.value))}</td></tr>`
  ).join('')

  let itemsHtml = ''
  if (items.length > 0) {
    const rows = items.map((it, i) => {
      const desc = (it.item_desc || '').trim() || '—'
      const size = it.item_size || '—'
      const brand = it.item_brand || '—'
      const qty = it.item_qty != null ? it.item_qty : '—'
      const cost = it.item_est_cost != null ? it.item_est_cost : '—'
      const bg = i % 2 === 0 ? '#f9fafb' : '#ffffff'
      return `<tr style="background:${bg};"><td style="padding:10px 12px;font-size:13px;color:#374151;font-family:Arial,sans-serif;border-bottom:1px solid #e5e7eb;">${i + 1}</td><td style="padding:10px 12px;font-size:13px;color:#111827;font-family:Arial,sans-serif;border-bottom:1px solid #e5e7eb;">${escapeHtml(desc)}</td><td style="padding:10px 12px;font-size:13px;color:#6b7280;font-family:Arial,sans-serif;border-bottom:1px solid #e5e7eb;">${escapeHtml(String(size))}</td><td style="padding:10px 12px;font-size:13px;color:#6b7280;font-family:Arial,sans-serif;border-bottom:1px solid #e5e7eb;">${escapeHtml(String(brand))}</td><td style="padding:10px 12px;font-size:13px;color:#111827;font-family:Arial,sans-serif;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600;">${escapeHtml(String(qty))}</td><td style="padding:10px 12px;font-size:13px;color:#111827;font-family:Arial,sans-serif;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600;">${escapeHtml(String(cost))}</td></tr>`
    })
    itemsHtml = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;border:1px solid #d1d5db;border-collapse:collapse;background:#ffffff;">
      <tr><td style="padding:12px 16px;background:#3b82f6;font-size:13px;font-weight:700;color:#ffffff;font-family:Arial,sans-serif;">Requisition Items (${items.length})</td></tr>
      <tr><td style="padding:0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <tr style="background:#f3f4f6;"><td style="padding:10px 12px;font-size:12px;font-weight:700;color:#374151;font-family:Arial,sans-serif;">#</td><td style="padding:10px 12px;font-size:12px;font-weight:700;color:#374151;font-family:Arial,sans-serif;">Description</td><td style="padding:10px 12px;font-size:12px;font-weight:700;color:#374151;font-family:Arial,sans-serif;">Size</td><td style="padding:10px 12px;font-size:12px;font-weight:700;color:#374151;font-family:Arial,sans-serif;">Brand</td><td style="padding:10px 12px;font-size:12px;font-weight:700;color:#374151;font-family:Arial,sans-serif;text-align:right;">Qty</td><td style="padding:10px 12px;font-size:12px;font-weight:700;color:#374151;font-family:Arial,sans-serif;text-align:right;">Est. Cost (PKR)</td></tr>
          ${rows.join('')}
        </table>
      </td></tr>
    </table>`
  } else {
    itemsHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;border:1px solid #e5e7eb;background:#f9fafb;"><tr><td style="padding:20px;font-size:14px;color:#6b7280;font-family:Arial,sans-serif;">No items listed. View in portal for details.</td></tr></table>`
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Requisition ${escapeAttr(refNo)} – Employee Portal</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;font-size:14px;color:#374151;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
          <tr>
            <td style="background:#ffffff;border:1px solid #e5e7eb;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:20px 24px;background:#3b82f6;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="font-size:16px;font-weight:700;color:#ffffff;">Employee Portal</td>
                      </tr>
                      <tr>
                        <td style="padding-top:4px;font-size:13px;color:#bfdbfe;">Requisition Notification</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:24px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td>
                          <span style="display:inline-block;padding:6px 12px;background:#dbeafe;color:#1d4ed8;font-size:13px;font-weight:700;">Ref: ${escapeHtml(refNo)}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding-top:16px;font-size:18px;font-weight:700;color:#111827;">${escapeHtml(title)}</td>
                      </tr>
                      <tr>
                        <td style="padding-top:8px;font-size:14px;color:#6b7280;">Please review this requisition and take action in the portal.</td>
                      </tr>
                    </table>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;border:1px solid #e5e7eb;background:#f9fafb;">
                      <tr>
                        <td style="padding:14px 16px;font-size:12px;font-weight:700;color:#3b82f6;text-transform:uppercase;letter-spacing:0.5px;">Details</td>
                      </tr>
                      <tr>
                        <td style="padding:0 16px 16px 16px;">
                          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${summaryHtml}</table>
                        </td>
                      </tr>
                    </table>
                    ${itemsHtml}
                  </td>
                </tr>
                <tr>
                  <td style="padding:20px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;text-align:center;">
                    <a href="${escapeAttr(portalUrl)}" style="display:inline-block;padding:12px 28px;background:#3b82f6;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">View in Portal</a>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding-top:12px;font-size:12px;color:#9ca3af;">${escapeHtml(portalUrl)}</td></tr></table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}
