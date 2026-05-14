# Procurement → Invoice Upload → Forward to Payable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After Finance approves a quotation, Procurement uploads the invoice and forwards it (with all 3 quotations + an HTML audit report) to the payable team via email.

**Architecture:** New multer config (memory storage → base64 data URL, matching all existing upload patterns), 5 new repository functions, 2 new service functions + 1 HTML builder helper, 2 controller functions, 2 routes, and one DB migration SQL file. Files are stored as `data:<mime>;base64,...` strings in the DB — attachments are decoded back to `Buffer` when sending email via `getEmailTransport()` directly (not `sendRequisitionReminder`, which doesn't support attachments).

**Tech Stack:** Node.js/Express, PostgreSQL (`executeQuery`), multer (memoryStorage), nodemailer (`getEmailTransport()`), existing `fileToDataUrl`, `resolveApproverEmployeeId`, `isProcurementMember` helpers.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `migration_add_invoice_columns.sql` | Create | Add 5 new columns to `requisition` table |
| `src/utils/file.utils.js` | Modify | Add `invoiceUpload` multer config (append after `supportDocUpload`) |
| `src/repositories/requisition.repository.js` | Modify | Add 5 new exported async functions (append at end) |
| `src/services/requisition.service.js` | Modify | Add `buildAuditReportHtml`, `uploadInvoice`, `forwardToPayable` (append after `approveFinance`, before `getTatReport`) |
| `src/controllers/requisition.controller.js` | Modify | Add `uploadInvoice`, `forwardToPayable` (append at end of file) |
| `src/routes/requisition.routes.js` | Modify | Add 2 routes before the `/:reqId` catch-all |

---

## Task 1: Database Migration

**Files:**
- Create: `migration_add_invoice_columns.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Migration: Add invoice tracking columns to requisition table
-- Run once against your PostgreSQL database.

ALTER TABLE requisition ADD COLUMN IF NOT EXISTS req_invoice_url TEXT;
ALTER TABLE requisition ADD COLUMN IF NOT EXISTS req_invoice_uploaded_at TIMESTAMP;
ALTER TABLE requisition ADD COLUMN IF NOT EXISTS req_invoice_uploaded_by INTEGER REFERENCES employees(employee_id);

ALTER TABLE requisition ADD COLUMN IF NOT EXISTS req_forwarded_to_payable_at TIMESTAMP;
ALTER TABLE requisition ADD COLUMN IF NOT EXISTS req_forwarded_to_payable_by INTEGER REFERENCES employees(employee_id);
```

- [ ] **Step 2: Run the migration**

```bash
psql -U <db_user> -d <db_name> -f migration_add_invoice_columns.sql
```

Expected: 5 `ALTER TABLE` lines, each saying `ALTER TABLE`.

- [ ] **Step 3: Verify columns exist**

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'requisition'
  AND column_name IN (
    'req_invoice_url','req_invoice_uploaded_at','req_invoice_uploaded_by',
    'req_forwarded_to_payable_at','req_forwarded_to_payable_by'
  );
```

Expected: 5 rows.

- [ ] **Step 4: Commit**

```bash
git add migration_add_invoice_columns.sql
git commit -m "feat: add invoice and payable forwarding columns to requisition table"
```

---

## Task 2: Invoice Upload Multer Config (`file.utils.js`)

**Files:**
- Modify: `src/utils/file.utils.js` (append after `supportDocUpload`, line ~35)

- [ ] **Step 1: Open `src/utils/file.utils.js` and append the following after the closing brace of `supportDocUpload`**

The existing file ends at line 60 with `cardsProfileUpload`. Insert after `supportDocUpload` (line 35) and before `payrollExcelUpload` (line 37):

```javascript
/** Invoice/bill upload for procurement (after Finance selects quotation) — images and PDFs, max 10 MB. */
export const invoiceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /^(image\/(jpeg|jpg|png|gif|webp)|application\/pdf)$/i.test(file.mimetype)
    cb(null, !!allowed)
  }
})
```

- [ ] **Step 2: Verify the file now exports `invoiceUpload`**

Check: `src/utils/file.utils.js` now has `export const invoiceUpload = multer({...})` between `supportDocUpload` and `payrollExcelUpload`.

- [ ] **Step 3: Commit**

```bash
git add src/utils/file.utils.js
git commit -m "feat: add invoiceUpload multer config for procurement invoice upload"
```

---

## Task 3: Repository Layer (`requisition.repository.js`)

**Files:**
- Modify: `src/repositories/requisition.repository.js` (append 5 functions at end of file, after line 2234)

- [ ] **Step 1: Append the 5 new repository functions at the end of the file**

```javascript
export async function saveInvoiceUrl(reqId, invoiceUrl, uploadedByEid) {
  await executeQuery(
    `UPDATE requisition
     SET req_invoice_url = $2,
         req_invoice_uploaded_at = CURRENT_TIMESTAMP,
         req_invoice_uploaded_by = $3
     WHERE req_id = $1`,
    [reqId, invoiceUrl, uploadedByEid]
  )
}

export async function getRequisitionForInvoiceUpload(reqId) {
  return executeQuery(
    `SELECT req_id, req_approved_quotation_index,
            req_quotation_1_url, req_quotation_2_url, req_quotation_3_url,
            req_invoice_url
     FROM requisition
     WHERE req_id = $1
       AND req_current_stage_key = 'procurement'
       AND req_finance_approval = 1
       AND req_approved_quotation_index IS NOT NULL`,
    [reqId]
  )
}

export async function getRequisitionForPayableForward(reqId) {
  return executeQuery(
    `SELECT r.*,
            e.first_name, e.last_name, e.email AS creator_email,
            e.employee_code,
            d.department_name,
            hod_emp.first_name AS hod_first_name, hod_emp.last_name AS hod_last_name,
            fin_emp.first_name AS fin_first_name, fin_emp.last_name AS fin_last_name
     FROM requisition r
     JOIN employees e ON r.req_emp_id = e.employee_id
     LEFT JOIN departments d ON e.department_id = d.department_id
     LEFT JOIN employees hod_emp ON r.req_hod_approved_by = hod_emp.employee_id
     LEFT JOIN employees fin_emp ON r.req_finance_approved_by = fin_emp.employee_id
     WHERE r.req_id = $1
       AND r.req_current_stage_key = 'procurement'
       AND r.req_finance_approval = 1
       AND r.req_invoice_url IS NOT NULL
       AND r.req_forwarded_to_payable_at IS NULL`,
    [reqId]
  )
}

export async function getItemsByReqId(reqId) {
  return executeQuery(
    `SELECT item_desc, item_size, item_brand, item_qty, item_est_cost, item_remarks
     FROM requisition_items
     WHERE req_id = $1`,
    [reqId]
  )
}

export async function markForwardedToPayable(reqId, eid) {
  await executeQuery(
    `UPDATE requisition
     SET req_forwarded_to_payable_at = CURRENT_TIMESTAMP,
         req_forwarded_to_payable_by = $2,
         req_current_stage_key = 'payable_pending'
     WHERE req_id = $1`,
    [reqId, eid]
  )
}
```

- [ ] **Step 2: Verify no syntax errors**

```bash
node --input-type=module <<'EOF'
import('./src/repositories/requisition.repository.js').then(() => console.log('OK')).catch(e => console.error(e.message))
EOF
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add src/repositories/requisition.repository.js
git commit -m "feat: add invoice upload and payable forwarding repository functions"
```

---

## Task 4: Service Layer (`requisition.service.js`)

**Files:**
- Modify: `src/services/requisition.service.js` (append 3 functions after `approveFinance` closes at line 2282, before `getTatReport` at line 2284)

- [ ] **Step 1: Insert `buildAuditReportHtml`, `uploadInvoice`, and `forwardToPayable` between line 2282 and 2284**

```javascript
function formatDatePKT(date) {
  if (!date) return '—'
  try {
    return new Date(date).toLocaleString('en-PK', {
      timeZone: 'Asia/Karachi',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).replace(',', '')
  } catch (_) { return String(date) }
}

function buildAuditReportHtml(row, items, forwardedByName) {
  const approvedIdx = row.req_approved_quotation_index
  const quotationStatus = (i) => i === approvedIdx
    ? '<span style="color:#16a34a;font-weight:bold">APPROVED</span>'
    : '<span style="color:#dc2626;font-weight:bold">REJECTED</span>'

  const timelineRows = [
    ['1', 'Requisition Created', row.req_created_at, `${row.first_name} ${row.last_name}`],
    ['2', 'HOD Approved', row.req_hod_approval_date, row.req_hod_approved_by ? `${row.hod_first_name || ''} ${row.hod_last_name || ''}`.trim() : '—'],
    ['3', 'Committee Approved', row.req_committee_approval_date, '—'],
    ...(row.req_ceo_approval === 1 ? [['4', 'CEO Approved', row.req_ceo_approval_date, '—']] : []),
    ['5', 'Procurement Acknowledged', row.req_procurement_ack_date, '—'],
    ['6', 'Quotations Uploaded', row.req_procurement_ack_date, '—'],
    ['7', 'Handed to Finance', row.req_handed_to_finance_date, '—'],
    ['8', `Finance Approved (Quotation #${approvedIdx} selected)`, row.req_finance_approval_date, row.req_finance_approved_by ? `${row.fin_first_name || ''} ${row.fin_last_name || ''}`.trim() : '—'],
    ['9', 'Invoice Uploaded by Procurement', row.req_invoice_uploaded_at, '—'],
    ['10', 'Forwarded to Payable', new Date().toISOString(), forwardedByName || '—'],
  ].map(([n, event, date, by]) => `
    <tr style="background:${parseInt(n, 10) % 2 === 0 ? '#f8fafc' : '#fff'}">
      <td style="padding:6px 10px;border:1px solid #e2e8f0;color:#64748b">${n}</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0">${event}</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;white-space:nowrap">${formatDatePKT(date)}</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0">${by}</td>
    </tr>`).join('')

  const itemRows = (items || []).map((item, i) => `
    <tr style="background:${i % 2 === 0 ? '#fff' : '#f8fafc'}">
      <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:center">${i + 1}</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0">${item.item_desc || '—'}</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0">${item.item_size || '—'}</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0">${item.item_brand || '—'}</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:center">${item.item_qty || '—'}</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right">${item.item_est_cost != null ? Number(item.item_est_cost).toLocaleString() : '—'}</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0">${item.item_remarks || '—'}</td>
    </tr>`).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Audit Report — ${row.req_reference_no}</title></head>
<body style="margin:0;padding:20px;font-family:Arial,sans-serif;font-size:13px;color:#1e293b;background:#f1f5f9">
  <div style="max-width:900px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.12)">
    <div style="background:#1a3a5c;color:#fff;padding:20px 24px">
      <h1 style="margin:0;font-size:18px;letter-spacing:.5px">REQUISITION AUDIT TRAIL REPORT</h1>
      <p style="margin:4px 0 0;font-size:12px;opacity:.8">Reference: ${row.req_reference_no} &nbsp;|&nbsp; Generated: ${formatDatePKT(new Date().toISOString())} (PKT)</p>
    </div>

    <div style="padding:20px 24px">
      <h2 style="color:#1a3a5c;font-size:14px;border-bottom:2px solid #1a3a5c;padding-bottom:4px;margin-top:0">REQUISITION DETAILS</h2>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:4px 8px;width:200px;color:#64748b">Reference No</td><td style="padding:4px 8px;font-weight:bold">${row.req_reference_no || '—'}</td></tr>
        <tr style="background:#f8fafc"><td style="padding:4px 8px;color:#64748b">Category</td><td style="padding:4px 8px">${row.req_category || '—'}</td></tr>
        <tr><td style="padding:4px 8px;color:#64748b">Business Unit</td><td style="padding:4px 8px">${row.req_business || '—'}</td></tr>
        <tr style="background:#f8fafc"><td style="padding:4px 8px;color:#64748b">Location</td><td style="padding:4px 8px">${row.req_location || '—'}</td></tr>
        <tr><td style="padding:4px 8px;color:#64748b">Material / Purpose</td><td style="padding:4px 8px">${row.req_material || '—'}</td></tr>
        <tr style="background:#f8fafc"><td style="padding:4px 8px;color:#64748b">Status</td><td style="padding:4px 8px;color:#16a34a;font-weight:bold">Forwarded to Finance (Payable)</td></tr>
      </table>
    </div>

    <div style="padding:0 24px 20px">
      <h2 style="color:#1a3a5c;font-size:14px;border-bottom:2px solid #1a3a5c;padding-bottom:4px">CREATOR INFORMATION</h2>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:4px 8px;width:200px;color:#64748b">Name</td><td style="padding:4px 8px">${row.first_name || ''} ${row.last_name || ''}</td></tr>
        <tr style="background:#f8fafc"><td style="padding:4px 8px;color:#64748b">Employee Code</td><td style="padding:4px 8px">${row.employee_code || '—'}</td></tr>
        <tr><td style="padding:4px 8px;color:#64748b">Department</td><td style="padding:4px 8px">${row.department_name || '—'}</td></tr>
        <tr style="background:#f8fafc"><td style="padding:4px 8px;color:#64748b">Email</td><td style="padding:4px 8px">${row.creator_email || '—'}</td></tr>
      </table>
    </div>

    <div style="padding:0 24px 20px">
      <h2 style="color:#1a3a5c;font-size:14px;border-bottom:2px solid #1a3a5c;padding-bottom:4px">ITEMS REQUESTED</h2>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:#1a3a5c;color:#fff">
          <th style="padding:8px 10px;border:1px solid #2d5a8e;text-align:center">#</th>
          <th style="padding:8px 10px;border:1px solid #2d5a8e">Description</th>
          <th style="padding:8px 10px;border:1px solid #2d5a8e">Size</th>
          <th style="padding:8px 10px;border:1px solid #2d5a8e">Brand</th>
          <th style="padding:8px 10px;border:1px solid #2d5a8e;text-align:center">Qty</th>
          <th style="padding:8px 10px;border:1px solid #2d5a8e;text-align:right">Unit Cost</th>
          <th style="padding:8px 10px;border:1px solid #2d5a8e">Remarks</th>
        </tr></thead>
        <tbody>${itemRows || '<tr><td colspan="7" style="padding:8px;text-align:center;color:#64748b">No items found</td></tr>'}</tbody>
      </table>
    </div>

    <div style="padding:0 24px 20px">
      <h2 style="color:#1a3a5c;font-size:14px;border-bottom:2px solid #1a3a5c;padding-bottom:4px">APPROVAL TIMELINE</h2>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:#1a3a5c;color:#fff">
          <th style="padding:8px 10px;border:1px solid #2d5a8e;width:30px">#</th>
          <th style="padding:8px 10px;border:1px solid #2d5a8e">Event</th>
          <th style="padding:8px 10px;border:1px solid #2d5a8e">Date &amp; Time (PKT)</th>
          <th style="padding:8px 10px;border:1px solid #2d5a8e">By</th>
        </tr></thead>
        <tbody>${timelineRows}</tbody>
      </table>
    </div>

    <div style="padding:0 24px 20px">
      <h2 style="color:#1a3a5c;font-size:14px;border-bottom:2px solid #1a3a5c;padding-bottom:4px">QUOTATION SUMMARY</h2>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:#1a3a5c;color:#fff">
          <th style="padding:8px 10px;border:1px solid #2d5a8e">Quotation</th>
          <th style="padding:8px 10px;border:1px solid #2d5a8e">Status</th>
        </tr></thead>
        <tbody>
          <tr><td style="padding:8px 10px;border:1px solid #e2e8f0">Quotation 1</td><td style="padding:8px 10px;border:1px solid #e2e8f0">${quotationStatus(1)}</td></tr>
          <tr style="background:#f8fafc"><td style="padding:8px 10px;border:1px solid #e2e8f0">Quotation 2</td><td style="padding:8px 10px;border:1px solid #e2e8f0">${quotationStatus(2)}</td></tr>
          <tr><td style="padding:8px 10px;border:1px solid #e2e8f0">Quotation 3</td><td style="padding:8px 10px;border:1px solid #e2e8f0">${quotationStatus(3)}</td></tr>
        </tbody>
      </table>
    </div>

    <div style="background:#1a3a5c;color:#fff;padding:12px 24px;font-size:11px;text-align:center;opacity:.85">
      End of Report &nbsp;|&nbsp; Generated by Requisition Management System &nbsp;|&nbsp; ${formatDatePKT(new Date().toISOString())} (PKT)
    </div>
  </div>
</body>
</html>`
}

/**
 * Parse a base64 data URL into a nodemailer attachment object.
 * Handles: data:<mime>;base64,<data>
 */
function dataUrlToAttachment(dataUrl, filename) {
  if (!dataUrl) return null
  const match = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/)
  if (!match) return null
  return {
    filename,
    content: Buffer.from(match[2], 'base64'),
    contentType: match[1]
  }
}

export async function uploadInvoice(reqId, invoiceFile, body) {
  const reqIdNum = parseInt(reqId, 10)
  if (Number.isNaN(reqIdNum)) return { error: 'Valid requisition ID required', status: 400 }
  const eid = await resolveApproverEmployeeId({
    approvedByEmployeeId: body?.handedByEmployeeId,
    approvedByEmployeeCode: body?.handedByEmployeeCode
  })
  if (eid == null) return { error: 'Valid handedByEmployeeId or handedByEmployeeCode is required', status: 400 }
  const ok = await reqRepo.isProcurementMember(eid)
  if (!ok) return { error: 'Only Procurement can upload the invoice', status: 403 }
  const rows = await reqRepo.getRequisitionForInvoiceUpload(reqIdNum)
  if (!rows.length) return { error: 'Requisition is not in the correct stage for invoice upload', status: 400 }
  if (!invoiceFile || !invoiceFile.buffer) return { error: 'Invoice file is required', status: 400 }
  const { fileToDataUrl } = await import('../utils/file.utils.js')
  const invoiceDataUrl = fileToDataUrl(invoiceFile)
  if (!invoiceDataUrl) return { error: 'Could not read invoice file data', status: 400 }
  await reqRepo.saveInvoiceUrl(reqIdNum, invoiceDataUrl, eid)
  return { message: 'Invoice uploaded successfully', invoiceUrl: invoiceDataUrl }
}

export async function forwardToPayable(body) {
  const reqId = body?.requisitionId != null ? parseInt(body.requisitionId, 10) : null
  if (reqId == null || Number.isNaN(reqId)) return { error: 'Valid requisitionId is required', status: 400 }
  const eid = await resolveApproverEmployeeId({
    approvedByEmployeeId: body?.handedByEmployeeId,
    approvedByEmployeeCode: body?.handedByEmployeeCode
  })
  if (eid == null) return { error: 'Valid handedByEmployeeId or handedByEmployeeCode is required', status: 400 }
  const ok = await reqRepo.isProcurementMember(eid)
  if (!ok) return { error: 'Only Procurement can forward to payable', status: 403 }
  const rows = await reqRepo.getRequisitionForPayableForward(reqId)
  if (!rows.length) return { error: 'Requisition not found, invoice not uploaded, or already forwarded to payable', status: 400 }
  const row = rows[0]
  if (!row.req_quotation_1_url || !row.req_quotation_2_url || !row.req_quotation_3_url) {
    return { error: 'All 3 quotations must be uploaded before forwarding', status: 400 }
  }
  const items = await reqRepo.getItemsByReqId(reqId)
  const approvedIdx = row.req_approved_quotation_index
  const rejectedIdxs = [1, 2, 3].filter(i => i !== approvedIdx)
  const approvedQuotationUrl = row[`req_quotation_${approvedIdx}_url`]
  const rejectedUrls = rejectedIdxs.map(i => row[`req_quotation_${i}_url`])
  const forwardedByName = `Procurement (ID: ${eid})`
  const auditHtml = buildAuditReportHtml(row, items, forwardedByName)

  const ext = (url) => {
    if (!url) return 'file'
    const m = url.match(/^data:([^;]+);/)
    if (m) {
      const mime = m[1]
      if (mime.includes('pdf')) return 'pdf'
      if (mime.includes('png')) return 'png'
      if (mime.includes('webp')) return 'webp'
      if (mime.includes('gif')) return 'gif'
      return 'jpg'
    }
    return url.split('.').pop() || 'file'
  }

  const attachments = [
    dataUrlToAttachment(approvedQuotationUrl, `approved_quotation_${approvedIdx}_${row.req_reference_no}.${ext(approvedQuotationUrl)}`),
    dataUrlToAttachment(rejectedUrls[0], `rejected_quotation_${rejectedIdxs[0]}_${row.req_reference_no}.${ext(rejectedUrls[0])}`),
    dataUrlToAttachment(rejectedUrls[1], `rejected_quotation_${rejectedIdxs[1]}_${row.req_reference_no}.${ext(rejectedUrls[1])}`),
    dataUrlToAttachment(row.req_invoice_url, `invoice_${row.req_reference_no}.${ext(row.req_invoice_url)}`),
    { filename: `audit_report_${row.req_reference_no}.html`, content: auditHtml, contentType: 'text/html' }
  ].filter(Boolean)

  await reqRepo.markForwardedToPayable(reqId, eid)

  let emailWarning = null
  try {
    const { getEmailTransport, EMAIL_FROM } = await import('../../config/email.js')
    const trans = getEmailTransport()
    if (!trans) throw new Error('SMTP not configured')
    await trans.sendMail({
      from: EMAIL_FROM,
      to: 'payable@itecknologi.com',
      subject: `[Payable Action Required] Requisition ${row.req_reference_no} — Invoice Submitted`,
      html: `<p>Dear Payable Team,</p>
<p>Procurement has submitted the invoice for Requisition <strong>${row.req_reference_no}</strong> (${row.req_category}). Finance has selected <strong>Quotation #${approvedIdx}</strong>.</p>
<p>Please find attached:</p>
<ul>
  <li>✅ Approved Quotation (Quotation #${approvedIdx})</li>
  <li>❌ Rejected Quotation (Quotation #${rejectedIdxs[0]})</li>
  <li>❌ Rejected Quotation (Quotation #${rejectedIdxs[1]})</li>
  <li>📄 Invoice / Bill</li>
  <li>📊 Full Audit Trail Report (HTML)</li>
</ul>
<p>Requested By: ${row.first_name} ${row.last_name} (${row.department_name || '—'})</p>
<p>This is an automated notification from the Requisition Management System.</p>`,
      attachments
    })
    console.log(`📧 [Payable] Email sent for requisition ${row.req_reference_no}`)
  } catch (err) {
    console.error('📧 [Payable] Email send failed:', err.message)
    emailWarning = err.message
  }

  const result = {
    message: 'Invoice and quotations forwarded to payable team. Email sent to payable@itecknologi.com',
    status: 'Pending Payment'
  }
  if (emailWarning) {
    result.message = 'Forwarded to payable but email send failed'
    result.emailError = emailWarning
  }
  return result
}
```

- [ ] **Step 2: Verify no syntax errors**

```bash
node --input-type=module <<'EOF'
import('./src/services/requisition.service.js').then(() => console.log('OK')).catch(e => console.error(e.message))
EOF
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add src/services/requisition.service.js
git commit -m "feat: add uploadInvoice, forwardToPayable service functions with HTML audit report"
```

---

## Task 5: Controller Layer (`requisition.controller.js`)

**Files:**
- Modify: `src/controllers/requisition.controller.js` (append 2 functions at end, after line 875)

- [ ] **Step 1: Append the 2 new controller functions at the end of the file (before the final closing if any)**

```javascript
export async function uploadInvoice(req, res) {
  try {
    const reqId = parseInt(req.params.reqId, 10)
    if (!reqId || isNaN(reqId)) return res.status(400).json({ error: 'Invalid requisition ID' })
    const invoiceFile = req.file
    if (!invoiceFile) return res.status(400).json({ error: 'Invoice file is required' })
    const result = await requisitionService.uploadInvoice(reqId, invoiceFile, req.body)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('Upload invoice error:', error)
    res.status(500).json({ error: 'Failed to upload invoice' })
  }
}

export async function forwardToPayable(req, res) {
  try {
    const result = await requisitionService.forwardToPayable(req.body)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json({ message: result.message, status: result.status, ...(result.emailError ? { emailError: result.emailError } : {}) })
  } catch (error) {
    console.error('Forward to payable error:', error)
    res.status(500).json({ error: 'Failed to forward to payable' })
  }
}
```

- [ ] **Step 2: Verify no syntax errors**

```bash
node --input-type=module <<'EOF'
import('./src/controllers/requisition.controller.js').then(() => console.log('OK')).catch(e => console.error(e.message))
EOF
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add src/controllers/requisition.controller.js
git commit -m "feat: add uploadInvoice and forwardToPayable controller handlers"
```

---

## Task 6: Routes (`requisition.routes.js`)

**Files:**
- Modify: `src/routes/requisition.routes.js`

Insert 2 new routes before the `router.get('/:reqId', ...)` catch-all (currently at line 113). Also update the import line to include `invoiceUpload`.

- [ ] **Step 1: Update the import at line 3 to add `invoiceUpload`**

Change:
```javascript
import { quotationUpload, supportDocUpload } from '../utils/file.utils.js'
```

To:
```javascript
import { quotationUpload, supportDocUpload, invoiceUpload } from '../utils/file.utils.js'
```

- [ ] **Step 2: Add 2 new routes before the `router.get('/:reqId', ...)` line**

Insert before line 113 (`router.get('/:reqId', requisitionController.getById)`):

```javascript
// Procurement: upload invoice after Finance selects quotation
router.post(
  '/invoice/:reqId/upload',
  invoiceUpload.single('invoice'),
  requisitionController.uploadInvoice
)

// Procurement: forward invoice + quotations to payable@itecknologi.com
router.post('/forward-to-payable', requisitionController.forwardToPayable)
```

- [ ] **Step 3: Verify no syntax errors**

```bash
node --input-type=module <<'EOF'
import('./src/routes/requisition.routes.js').then(() => console.log('OK')).catch(e => console.error(e.message))
EOF
```

Expected: `OK`

- [ ] **Step 4: Start dev server and smoke-test the new endpoints**

```bash
# Terminal 1 — start server
npm run dev

# Terminal 2 — smoke test: POST invoice upload (should 400 if wrong stage, not 404)
curl -s -X POST http://localhost:3000/api/requisition/invoice/999/upload \
  -F "invoice=@/dev/null;type=application/pdf" \
  -F "handedByEmployeeId=1" | jq .
# Expected: { "error": "Invalid requisition ID" } OR { "error": "...not in correct stage..." }
# (not "Cannot POST /api/requisition/invoice/999/upload")

curl -s -X POST http://localhost:3000/api/requisition/forward-to-payable \
  -H "Content-Type: application/json" \
  -d '{"requisitionId":999,"handedByEmployeeId":1}' | jq .
# Expected: { "error": "..." } (not a 404)
```

- [ ] **Step 5: Commit**

```bash
git add src/routes/requisition.routes.js
git commit -m "feat: add invoice upload and forward-to-payable routes"
```

---

## Self-Review Checklist

- [x] **DB migration** covers all 5 new columns (3 invoice + 2 payable forwarding)
- [x] **Guard: only Procurement** — enforced in both `uploadInvoice` and `forwardToPayable`
- [x] **Guard: correct stage** — `getRequisitionForInvoiceUpload` requires `procurement` + `finance_approval=1` + quotation index set
- [x] **Guard: invoice required before forward** — `getRequisitionForPayableForward` query requires `req_invoice_url IS NOT NULL`
- [x] **Guard: not forwarded twice** — `getRequisitionForPayableForward` query requires `req_forwarded_to_payable_at IS NULL`
- [x] **Guard: all 3 quotations present** — explicit check in `forwardToPayable` before building attachments
- [x] **Email failure is non-fatal** — `markForwardedToPayable` called *before* email attempt; email wrapped in try/catch; warning surfaced in response
- [x] **File storage pattern** — `invoiceUpload` uses `memoryStorage()` matching all other multer configs; stored as base64 data URL
- [x] **Attachment decoding** — `dataUrlToAttachment` parses `data:<mime>;base64,<data>` to `Buffer` for nodemailer
- [x] **`resolveApproverEmployeeId` mapping** — `handedByEmployeeId`/`handedByEmployeeCode` correctly mapped to `approvedByEmployeeId`/`approvedByEmployeeCode`
- [x] **Null safety in audit report** — all fields use `|| '—'` fallback; CEO row only rendered if `req_ceo_approval === 1`
- [x] **Routes inserted before `/:reqId` catch-all** — preserves route resolution order
- [x] **`approveFinance` untouched** — new feature starts after it, no modifications to existing functions
