# Prompt for Claude Sonnet 4.5
## Feature: Procurement → Finance → Procurement Invoice Flow with Final Email

---

## CONTEXT: EXISTING CODEBASE STRUCTURE

You are working on a Node.js/Express backend for a **Requisition Management System**. The codebase follows this architecture:
- `requisition.routes.js` → `requisition.controller.js` → `requisition.service.js` → `requisition.repository.js`
- Database: PostgreSQL (queries via `executeQuery` from `../../config/database.js`)
- File uploads: multer-based, handled via `file.utils.js`
- Email: nodemailer-based, sent via `../../config/email.js` (uses `EMAIL_FROM`, `sendRequisitionReminder`)
- BullMQ job queue available via `getQueue()` from `../../config/bullmq.js`
- Current stage tracked in `req_current_stage_key` column on `requisition` table

### Key existing DB columns on `requisition` table (relevant ones):
```
req_id, req_reference_no, req_category, req_created_at,
req_emp_id (creator), req_material, req_location, req_business,
req_hod_approval, req_hod_approval_date, req_hod_approved_by,
req_committee_approval, req_committee_approval_date,
req_ceo_approval, req_ceo_approval_date,
req_procurement_ack, req_procurement_ack_date, req_procurement_ack_by,
req_handed_to_finance, req_handed_to_finance_date,
req_finance_approval, req_finance_approval_date, req_finance_approved_by,
req_approved_quotation_index,   -- 1, 2, or 3 (set by Finance when approving)
req_quotation_1_url, req_quotation_2_url, req_quotation_3_url,
req_support_doc_1_url, req_support_doc_2_url, req_support_doc_3_url,
req_current_stage_key,
req_is_rejected, req_rejection_reason, req_rejection_stage
```

### Existing Flow (for procurement categories):
1. Creator → HOD → Committee → CEO (if amount ≥ threshold) → Procurement acknowledges → Procurement uploads 3 quotations + support docs → **handoverFinance()** → Finance selects 1 quotation (`approveFinance()` sets `req_approved_quotation_index`) → stage goes back to `procurement` → [THIS IS WHERE NEW FEATURE STARTS]

### Current `approveFinance()` behaviour (already exists, DO NOT change):
- Finance selects quotation index (1/2/3) via `approvedQuotationIndex` in body
- Calls `reqRepo.approveFinance(reqId, eid, idx)` which sets `req_finance_approval=1`, `req_finance_approval_date`, `req_finance_approved_by`, `req_approved_quotation_index`
- Then sets `req_current_stage_key = 'procurement'` and notifies procurement bucket

---

## TASK: IMPLEMENT THE FOLLOWING NEW FEATURE

### Business Logic Summary:
After Finance selects and approves a quotation, the requisition returns to Procurement. Now Procurement must:
1. Upload the **invoice/bill** for the approved (selected) quotation
2. Click **"Forward to Finance"** which triggers:
   - An email to `payable@itecknologi.com`
   - Email contains **4 attachments**:
     - The 2 **rejected** quotation files (whichever 2 were NOT selected by Finance)
     - The 1 **approved** quotation file (the one Finance selected)
     - The **invoice/bill** file just uploaded by Procurement
   - Email body contains a **full audit trail report** as an **HTML attachment** (report.html) with:
     - Requisition overview: reference no, category, location, business unit, material/description
     - Creator details: name, employee code, department
     - All approval timestamps in order: created → HOD approved → Committee approved → CEO approved (if applicable) → Procurement acknowledged → Quotations uploaded → Handed to Finance → Finance approved (with selected quotation noted) → Invoice uploaded → Forwarded to Finance/Payable

---

## WHAT TO BUILD — STEP BY STEP INSTRUCTIONS:

### STEP 1: Database Migration
Write a PostgreSQL migration SQL to add these columns to the `requisition` table:
```sql
-- Invoice uploaded by Procurement (after Finance selects quotation)
ALTER TABLE requisition ADD COLUMN IF NOT EXISTS req_invoice_url TEXT;
ALTER TABLE requisition ADD COLUMN IF NOT EXISTS req_invoice_uploaded_at TIMESTAMP;
ALTER TABLE requisition ADD COLUMN IF NOT EXISTS req_invoice_uploaded_by INTEGER REFERENCES employees(employee_id);

-- Track when Procurement forwarded to Finance/Payable (second time)
ALTER TABLE requisition ADD COLUMN IF NOT EXISTS req_forwarded_to_payable_at TIMESTAMP;
ALTER TABLE requisition ADD COLUMN IF NOT EXISTS req_forwarded_to_payable_by INTEGER REFERENCES employees(employee_id);
```

---

### STEP 2: File Upload Utility (`file.utils.js`)
Add a new multer config for invoice uploads (alongside existing `quotationUpload` and `supportDocUpload`):
```javascript
// Add export: invoiceUpload
// - destination: 'uploads/invoices/'
// - fileFilter: allow images (jpg/png/webp) and PDF only
// - limits: 10MB per file
// - single field: 'invoice'
```

---

### STEP 3: Repository Layer (`requisition.repository.js`)
Add these repository functions:

**a) `saveInvoiceUrl(reqId, invoiceUrl, uploadedByEid)`**
```sql
UPDATE requisition 
SET req_invoice_url = $2, req_invoice_uploaded_at = CURRENT_TIMESTAMP, req_invoice_uploaded_by = $3
WHERE req_id = $1
```

**b) `getRequisitionForInvoiceUpload(reqId)`**
- Fetch requisition only if:
  - `req_current_stage_key = 'procurement'`
  - `req_finance_approval = 1` (Finance has already approved)
  - `req_approved_quotation_index IS NOT NULL`
- Return: `req_id, req_approved_quotation_index, req_quotation_1_url, req_quotation_2_url, req_quotation_3_url, req_invoice_url`

**c) `getRequisitionForPayableForward(reqId)`**
- Fetch full requisition with creator join:
```sql
SELECT r.*,
  e.first_name, e.last_name, e.email AS creator_email,
  e.employee_code,
  d.department_name,
  -- HOD approver name
  hod_emp.first_name AS hod_first_name, hod_emp.last_name AS hod_last_name,
  -- Finance approver name
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
  AND r.req_forwarded_to_payable_at IS NULL
```

**d) `getItemsByReqId(reqId)`**
```sql
SELECT item_desc, item_size, item_brand, item_qty, item_est_cost, item_remarks
FROM requisition_items WHERE req_id = $1
```

**e) `markForwardedToPayable(reqId, eid)`**
```sql
UPDATE requisition 
SET req_forwarded_to_payable_at = CURRENT_TIMESTAMP, req_forwarded_to_payable_by = $2,
    req_current_stage_key = 'payable_pending'
WHERE req_id = $1
```

---

### STEP 4: Service Layer (`requisition.service.js`)
Add these service functions:

**a) `uploadInvoice(reqId, invoiceFile, body)`**
```javascript
export async function uploadInvoice(reqId, invoiceFile, body) {
  // 1. Validate reqId (integer)
  // 2. Resolve approvedByEmployeeId/Code via resolveApproverEmployeeId(body)
  // 3. Check: isProcurementMember(eid) — only procurement can upload invoice
  // 4. Fetch: getRequisitionForInvoiceUpload(reqId) — must exist and be in correct state
  // 5. Validate: invoiceFile must exist (multer populated it)
  // 6. Build file URL/path from invoiceFile (same pattern as existing quotation upload)
  // 7. Call: reqRepo.saveInvoiceUrl(reqId, invoiceFileUrl, eid)
  // 8. Return: { message: 'Invoice uploaded successfully', invoiceUrl: invoiceFileUrl }
}
```

**b) `forwardToPayable(body)`**
```javascript
export async function forwardToPayable(body) {
  // 1. Validate requisitionId
  // 2. Resolve eid via resolveApproverEmployeeId(body)
  // 3. Check: isProcurementMember(eid)
  // 4. Fetch: getRequisitionForPayableForward(reqId) — full row with joins
  // 5. Get items: getItemsByReqId(reqId)
  // 6. Determine which quotations are approved vs rejected based on req_approved_quotation_index:
  //    - approvedIdx = row.req_approved_quotation_index (1, 2, or 3)
  //    - approvedQuotationUrl = row[`req_quotation_${approvedIdx}_url`]
  //    - rejectedUrls = [1,2,3].filter(i => i !== approvedIdx).map(i => row[`req_quotation_${i}_url`])
  // 7. Build the HTML audit trail report (see STEP 5 below)
  // 8. Send email to payable@itecknologi.com (see STEP 6 below)
  // 9. Call: reqRepo.markForwardedToPayable(reqId, eid)
  // 10. Return: { message: 'Forwarded to payable. Email sent.', status: 'Pending Payment' }
}
```

---

### STEP 5: HTML Audit Trail Report Generator (helper function inside service)

Write a function `buildAuditReportHtml(row, items)` that returns a complete HTML string. The report should include:

**Report Structure:**

```
REQUISITION AUDIT TRAIL REPORT
================================
Reference No: [req_reference_no]
Generated At: [current datetime]

─── REQUISITION DETAILS ───────────────────────────────
Reference No    : REQ-2024-XXXX
Category        : General Procurements
Business Unit   : iTecknologi Tracking Pvt. Ltd
Location        : [req_location]
Material/Purpose: [req_material]
Status          : Forwarded to Finance (Payable)

─── CREATOR INFORMATION ───────────────────────────────
Name            : [first_name last_name]
Employee Code   : [employee_code]
Department      : [department_name]
Email           : [creator_email]

─── ITEMS REQUESTED ───────────────────────────────────
# | Description | Size | Brand | Qty | Unit Cost | Remarks
[rows from requisition_items]

─── APPROVAL TIMELINE ─────────────────────────────────
[EVENT]                         [DATE & TIME]           [BY]
1. Requisition Created          DD/MM/YYYY HH:MM        [creator name]
2. HOD Approved                 DD/MM/YYYY HH:MM        [hod_first_name hod_last_name] (if available)
3. Committee Approved           DD/MM/YYYY HH:MM        —
4. CEO Approved                 DD/MM/YYYY HH:MM        — (only if req_ceo_approval = 1)
5. Procurement Acknowledged     DD/MM/YYYY HH:MM        —
6. Quotations Uploaded          DD/MM/YYYY HH:MM        —  (use req_procurement_ack_date as proxy if no separate col)
7. Handed to Finance            DD/MM/YYYY HH:MM        —
8. Finance Approved             DD/MM/YYYY HH:MM        [fin_first_name fin_last_name]
   └─ Selected Quotation        : Quotation #[req_approved_quotation_index]
9. Invoice Uploaded by Procurement: DD/MM/YYYY HH:MM    —
10. Forwarded to Payable        DD/MM/YYYY HH:MM        [forwarder name from eid]

─── QUOTATION SUMMARY ─────────────────────────────────
Quotation 1: [APPROVED / REJECTED]
Quotation 2: [APPROVED / REJECTED]  
Quotation 3: [APPROVED / REJECTED]

─── END OF REPORT ─────────────────────────────────────
```

Style the HTML with inline CSS: clean table layout, company colors (dark blue header `#1a3a5c`, white text, light grey rows, green for APPROVED, red for REJECTED). Make it look like a professional PDF-ready report.

---

### STEP 6: Email Sending Logic

Inside `forwardToPayable()`, send the email using nodemailer (via existing `sendRequisitionReminder` transporter or create inline transporter from `EMAIL_FROM` config):

```javascript
// Email config:
const mailOptions = {
  from: EMAIL_FROM,
  to: 'payable@itecknologi.com',
  subject: `[Payable Action Required] Requisition ${row.req_reference_no} — Invoice Submitted`,
  html: `
    <p>Dear Payable Team,</p>
    <p>Procurement has submitted the invoice for Requisition <strong>${row.req_reference_no}</strong> 
    (${row.req_category}). Finance has selected <strong>Quotation #${row.req_approved_quotation_index}</strong>.</p>
    <p>Please find attached:</p>
    <ul>
      <li>✅ Approved Quotation (Quotation #${approvedIdx})</li>
      <li>❌ Rejected Quotation (Quotation #${rejectedIdxs[0]})</li>
      <li>❌ Rejected Quotation (Quotation #${rejectedIdxs[1]})</li>
      <li>📄 Invoice / Bill</li>
      <li>📊 Full Audit Trail Report (attached as PDF/HTML)</li>
    </ul>
    <p>Requested By: ${row.first_name} ${row.last_name} (${row.department_name})</p>
    <p>This is an automated notification from the Requisition Management System.</p>
  `,
  attachments: [
    // Approved quotation
    { filename: `approved_quotation_${approvedIdx}_${row.req_reference_no}.${ext}`, path: approvedQuotationUrl },
    // Rejected quotations
    { filename: `rejected_quotation_${rejectedIdxs[0]}_${row.req_reference_no}.${ext}`, path: rejectedUrls[0] },
    { filename: `rejected_quotation_${rejectedIdxs[1]}_${row.req_reference_no}.${ext}`, path: rejectedUrls[1] },
    // Invoice
    { filename: `invoice_${row.req_reference_no}.${invoiceExt}`, path: row.req_invoice_url },
    // Audit trail report as HTML attachment
    { filename: `audit_report_${row.req_reference_no}.html`, content: auditHtml, contentType: 'text/html' }
  ]
}
```

> **Note on file paths:** The `req_quotation_X_url` columns likely store relative paths like `uploads/quotations/filename.jpg`. Use `path.resolve(process.cwd(), url)` to get absolute paths for nodemailer attachments. Handle the case where URLs might be absolute HTTP URLs — in that case, download the file buffer first using `fetch()` and pass as `content` instead of `path`.

---

### STEP 7: Controller Layer (`requisition.controller.js`)
Add two new controller functions:

**a) `uploadInvoice`**
```javascript
export async function uploadInvoice(req, res) {
  try {
    const reqId = parseInt(req.params.reqId, 10)
    if (!reqId || isNaN(reqId)) return res.status(400).json({ error: 'Invalid requisition ID' })
    const invoiceFile = req.file  // from multer single('invoice')
    if (!invoiceFile) return res.status(400).json({ error: 'Invoice file is required' })
    const result = await requisitionService.uploadInvoice(reqId, invoiceFile, req.body)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('Upload invoice error:', error)
    res.status(500).json({ error: 'Failed to upload invoice' })
  }
}
```

**b) `forwardToPayable`**
```javascript
export async function forwardToPayable(req, res) {
  try {
    const result = await requisitionService.forwardToPayable(req.body)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json({ message: result.message, status: result.status })
  } catch (error) {
    console.error('Forward to payable error:', error)
    res.status(500).json({ error: 'Failed to forward to payable' })
  }
}
```

---

### STEP 8: Routes (`requisition.routes.js`)
Add these new routes **before** the `router.get('/:reqId', ...)` catch-all:

```javascript
import { invoiceUpload } from '../utils/file.utils.js'

// Procurement: upload invoice after Finance selects quotation
router.post(
  '/invoice/:reqId/upload',
  invoiceUpload.single('invoice'),
  requisitionController.uploadInvoice
)

// Procurement: forward invoice + quotations to payable@itecknologi.com
router.post('/forward-to-payable', requisitionController.forwardToPayable)
```

---

## GUARD CONDITIONS & VALIDATION RULES

Enforce these rules strictly (return 400/403 errors if violated):

| Rule | Error Message |
|------|--------------|
| Only Procurement members can upload invoice | `'Only Procurement can upload the invoice'` |
| Invoice upload only allowed when `req_current_stage_key = 'procurement'` AND `req_finance_approval = 1` | `'Requisition is not in the correct stage for invoice upload'` |
| `forwardToPayable` only allowed when invoice is already uploaded (`req_invoice_url IS NOT NULL`) | `'Please upload the invoice before forwarding to payable'` |
| Cannot forward to payable more than once (`req_forwarded_to_payable_at IS NULL`) | `'This requisition has already been forwarded to payable'` |
| All 3 quotation URLs must exist (they should already, from the earlier handover step) | `'All 3 quotations must be uploaded before forwarding'` |

---

## REQUEST/RESPONSE CONTRACTS

### POST `/requisition/invoice/:reqId/upload`
**Request:** `multipart/form-data`
- Param: `reqId` (integer)
- Field: `invoice` (file — image or PDF)
- Body: `handedByEmployeeId` OR `handedByEmployeeCode` (string)

**Response 200:**
```json
{
  "message": "Invoice uploaded successfully",
  "invoiceUrl": "uploads/invoices/invoice_123_1700000000000.pdf"
}
```

---

### POST `/requisition/forward-to-payable`
**Request:** `application/json`
```json
{
  "requisitionId": 123,
  "handedByEmployeeId": 45
}
```
**Response 200:**
```json
{
  "message": "Invoice and quotations forwarded to payable team. Email sent to payable@itecknologi.com",
  "status": "Pending Payment"
}
```

---

## IMPORTANT IMPLEMENTATION NOTES

1. **File path handling:** The existing codebase stores file URLs as relative paths (e.g., `uploads/quotations/file.jpg`). When attaching to email, resolve to absolute path using `path.resolve(process.cwd(), url)` or the equivalent pattern already used in the codebase for serving static files.

2. **Email transporter:** Reuse whatever transporter is already set up in `../../config/email.js`. Look at how `sendRequisitionReminder` is implemented and follow the same pattern. Do not hardcode SMTP credentials — use existing env vars.

3. **Audit report dates:** Format all dates as `DD/MM/YYYY HH:MM (PKT)`. Use `toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })` or moment-timezone if available.

4. **Null safety:** Many approval date fields may be null (e.g., CEO approval if amount was below threshold). Show `—` or `N/A` for those rows in the report instead of crashing.

5. **Existing `approveFinance()` function:** Do NOT modify it. It already sets `req_current_stage_key = 'procurement'` and `req_approved_quotation_index`. Your new feature starts AFTER this point.

6. **File extension detection:** When naming attachments, detect extension from the stored URL string (e.g., `url.split('.').pop()`) to preserve original file format.

7. **Error handling:** Wrap the email send in try/catch. If email fails, still mark `req_forwarded_to_payable_at` but return a warning in the response: `{ message: '...forwarded but email failed', emailError: err.message }`.

8. **Consistency:** Follow the exact same code style, error-return pattern (`return { error: '...', status: 400 }`), and naming conventions as the existing codebase.

---

## DELIVERABLES

Please produce the following files with complete, production-ready code:

1. `migration_add_invoice_columns.sql` — Database migration
2. `file.utils.js` — Updated with `invoiceUpload` export (show only the new addition + export)
3. `requisition.repository.js` — Only the 5 new functions (a through e from Step 3)
4. `requisition.service.js` — Only the 2 new functions + `buildAuditReportHtml` helper (Steps 4 & 5)
5. `requisition.controller.js` — Only the 2 new controller functions (Step 7)
6. `requisition.routes.js` — Only the 2 new route lines to add (Step 8)

For each file, clearly comment where in the existing file the new code should be inserted.
