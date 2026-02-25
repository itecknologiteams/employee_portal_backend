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

  const summaryHtml = summaryRows.map((r) => `<tr><td style="padding:12px 20px 12px 0;font-size:14px;color:#64748b;font-family:'Segoe UI',system-ui,sans-serif;vertical-align:top;">${escapeHtml(r.label)}</td><td style="padding:12px 0;font-size:15px;font-weight:600;color:#0f172a;font-family:'Segoe UI',system-ui,sans-serif;">${escapeHtml(String(r.value))}</td></tr>`).join('')

  let itemsHtml = ''
  if (items.length > 0) {
    const rows = items.map((it, i) => {
      const desc = (it.item_desc || '').trim() || '—'
      const size = it.item_size || '—'
      const brand = it.item_brand || '—'
      const qty = it.item_qty != null ? it.item_qty : '—'
      const cost = it.item_est_cost != null ? it.item_est_cost : '—'
      const bg = i % 2 === 0 ? '#f8fafc' : '#ffffff'
      return `<tr style="background:${bg};"><td style="padding:14px 18px;font-size:14px;color:#334155;font-family:'Segoe UI',system-ui,sans-serif;border-bottom:1px solid #e2e8f0;">${i + 1}</td><td style="padding:14px 18px;font-size:14px;color:#0f172a;font-family:'Segoe UI',system-ui,sans-serif;border-bottom:1px solid #e2e8f0;">${escapeHtml(desc)}</td><td style="padding:14px 18px;font-size:14px;color:#64748b;font-family:'Segoe UI',system-ui,sans-serif;border-bottom:1px solid #e2e8f0;">${escapeHtml(String(size))}</td><td style="padding:14px 18px;font-size:14px;color:#64748b;font-family:'Segoe UI',system-ui,sans-serif;border-bottom:1px solid #e2e8f0;">${escapeHtml(String(brand))}</td><td style="padding:14px 18px;font-size:14px;color:#0f172a;font-family:'Segoe UI',system-ui,sans-serif;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:600;">${escapeHtml(String(qty))}</td><td style="padding:14px 18px;font-size:14px;color:#0f172a;font-family:'Segoe UI',system-ui,sans-serif;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:600;">${escapeHtml(String(cost))}</td></tr>`
    })
    itemsHtml = `
    <div style="margin-top:36px;">
      <p style="margin:0 0 12px 0;font-size:11px;font-weight:700;color:#2563eb;letter-spacing:0.15em;text-transform:uppercase;font-family:'Segoe UI',system-ui,sans-serif;">Items (${items.length})</p>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;-webkit-border-radius:8px;" cellpadding="0" cellspacing="0">
        <thead><tr style="background:linear-gradient(135deg,#3b82f6 0%,#2563eb 100%);">
          <th style="padding:14px 18px;text-align:left;font-size:11px;font-weight:700;color:#ffffff;letter-spacing:0.08em;text-transform:uppercase;font-family:'Segoe UI',system-ui,sans-serif;">#</th>
          <th style="padding:14px 18px;text-align:left;font-size:11px;font-weight:700;color:#ffffff;letter-spacing:0.08em;text-transform:uppercase;font-family:'Segoe UI',system-ui,sans-serif;">Description</th>
          <th style="padding:14px 18px;text-align:left;font-size:11px;font-weight:700;color:#ffffff;letter-spacing:0.08em;text-transform:uppercase;font-family:'Segoe UI',system-ui,sans-serif;">Size</th>
          <th style="padding:14px 18px;text-align:left;font-size:11px;font-weight:700;color:#ffffff;letter-spacing:0.08em;text-transform:uppercase;font-family:'Segoe UI',system-ui,sans-serif;">Brand</th>
          <th style="padding:14px 18px;text-align:right;font-size:11px;font-weight:700;color:#ffffff;letter-spacing:0.08em;text-transform:uppercase;font-family:'Segoe UI',system-ui,sans-serif;">Qty</th>
          <th style="padding:14px 18px;text-align:right;font-size:11px;font-weight:700;color:#ffffff;letter-spacing:0.08em;text-transform:uppercase;font-family:'Segoe UI',system-ui,sans-serif;">Est. Cost (PKR)</th>
        </tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>`
  } else {
    itemsHtml = `<p style="margin:28px 0 0 0;font-size:15px;color:#64748b;font-family:'Segoe UI',system-ui,sans-serif;">No items listed – view in portal for details.</p>`
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&display=swap" rel="stylesheet">
</head>
<body style="margin:0;background:#f1f5f9;font-family:'Segoe UI',system-ui,sans-serif;padding:32px 16px;">
  <div style="max-width:600px;margin:0 auto;">
    <div style="height:8px;background:linear-gradient(90deg,#93c5fd 0%,#3b82f6 50%,#2563eb 100%);border-radius:8px 8px 0 0;"></div>
    <div style="background:#ffffff;padding:0 0 36px 0;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;">
      <div style="padding:40px 36px 32px 36px;">
        <p style="margin:0 0 6px 0;font-size:11px;font-weight:700;color:#2563eb;letter-spacing:0.2em;text-transform:uppercase;font-family:'Syne',sans-serif;">Requisition</p>
        <h1 style="margin:0;font-size:28px;font-weight:800;color:#0f172a;letter-spacing:-0.02em;line-height:1.2;font-family:'Syne',sans-serif;">${escapeHtml(title)}</h1>
        <p style="margin:14px 0 0 0;font-size:15px;color:#64748b;line-height:1.5;font-family:'Segoe UI',system-ui,sans-serif;">Please review and take action in the portal.</p>
      </div>
      <div style="margin:0 36px 32px 36px;padding:28px 32px;background:#f8fafc;border-left:4px solid #3b82f6;border-radius:0 6px 6px 0;">
        <p style="margin:0 0 20px 0;font-size:11px;font-weight:700;color:#2563eb;letter-spacing:0.15em;text-transform:uppercase;font-family:'Syne',sans-serif;">Summary</p>
        <table style="width:100%;border-collapse:collapse;">${summaryHtml}</table>
      </div>
      <div style="margin:0 36px 0 36px;padding:0 0 36px 0;">
        ${itemsHtml}
      </div>
    </div>
    <div style="background:#ffffff;padding:40px 36px;text-align:center;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;">
      <a href="${escapeAttr(portalUrl)}" style="display:inline-block;padding:16px 36px;background:linear-gradient(135deg,#3b82f6 0%,#2563eb 100%);color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;font-family:'Syne',sans-serif;border-radius:6px;">Open in Portal</a>
      <p style="margin:24px 0 0 0;font-size:12px;color:#94a3b8;font-family:'Segoe UI',system-ui,sans-serif;">${escapeHtml(portalUrl)}</p>
      <p style="margin:12px 0 0 0;font-size:11px;color:#cbd5e1;font-family:'Segoe UI',system-ui,sans-serif;">Employee Portal</p>
    </div>
    <div style="height:8px;background:linear-gradient(90deg,#2563eb 0%,#3b82f6 50%,#93c5fd 100%);border-radius:0 0 8px 8px;"></div>
  </div>
</body>
</html>`
}
