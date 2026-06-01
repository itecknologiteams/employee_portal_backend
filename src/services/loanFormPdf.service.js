import PDFDocument from 'pdfkit'
import { executeQuery } from '../../config/database.js'

const DASH = '—' // em-dash, used everywhere a value is missing

/**
 * Build a printable Loan / Advance Salary Form as a PDF Buffer.
 * Mirrors the three-section form shown in the UI:
 *   Section 1 — Employee Information
 *   Section 2 — Undertaking
 *   Section 3 — To Be Filled By HR Department
 * Returns null when the requisition cannot be loaded.
 */
export async function buildLoanFormPdfBuffer(reqId) {
  const rows = await executeQuery(
    `SELECT r.*,
            e.first_name, e.last_name, e.employee_code, e.cnic_number,
            e.join_date,
            c.city_name,
            d.department_name,
            desg.desg_name AS designation_name
       FROM requisition r
       JOIN employees e ON r.req_emp_id = e.employee_id
       LEFT JOIN departments d ON e.department_id = d.department_id
       LEFT JOIN designation desg ON e.designation_id = desg.desg_id
       LEFT JOIN city c ON e.city_id = c.city_id
      WHERE r.req_id = $1`,
    [reqId]
  )
  if (!rows.length) return null
  const row = rows[0]

  // Latest gross salary for this employee (best-effort — table may be missing in some envs).
  let grossSalary = null
  try {
    const sal = await executeQuery(
      `SELECT gross_salary FROM employee_gross_salary
         WHERE employee_id = (SELECT employee_id FROM employees WHERE employee_code = $1)
         ORDER BY updated_at DESC LIMIT 1`,
      [row.employee_code]
    )
    if (sal[0]?.gross_salary != null) grossSalary = Number(sal[0].gross_salary)
  } catch (_) { /* silently fall back */ }

  // ----- Compute display values -----
  const empName = `${row.first_name || ''} ${row.last_name || ''}`.trim() || DASH
  const empCode = row.employee_code || DASH
  const department = row.department_name || DASH
  const designation = row.designation_name || DASH
  const cnic = row.cnic_number || DASH
  const city = row.city_name || DASH
  const isLoan = String(row.loan_advance_type || '').toLowerCase() === 'loan'
  const isAdvance = String(row.loan_advance_type || '').toLowerCase() === 'advance'
  const amount = Number(row.req_hr_approved_amount || row.loan_advance_amount || 0)
  const installmentMonths = row.req_hr_approved_installments || row.loan_installment_months || 1
  const monthlyDeduction = amount ? Math.ceil(amount / installmentMonths) : 0
  const employmentStatus = row.req_employment_status || DASH
  const reason = row.loan_advance_reason || row.req_reason || DASH
  const refNo = row.req_reference_no || `REQ-${row.req_id}`
  const requestDate = row.req_created_at
    ? new Date(row.req_created_at).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : DASH
  const joinDate = row.join_date
    ? new Date(row.join_date).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : DASH
  const joinYear = row.join_date ? String(new Date(row.join_date).getFullYear()) : DASH

  // Default installment start = first of next month after Finance approval (or today).
  const startBase = row.req_finance_approval_date ? new Date(row.req_finance_approval_date) : new Date()
  const startDate = new Date(startBase.getFullYear(), startBase.getMonth() + 1, 1)
  const installmentStartFmt = startDate.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })

  const fmtLong = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''
  const financeApprovedDate = fmtLong(row.req_finance_approval_date)
  const ceoApprovedDate = fmtLong(row.req_ceo_approval_date)

  // ----- Build PDF -----
  const doc = new PDFDocument({ size: 'A4', margin: 40 })
  const chunks = []
  doc.on('data', (c) => chunks.push(c))
  const donePromise = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })

  const pageW = doc.page.width
  const margin = doc.page.margins.left
  const contentW = pageW - margin * 2

  // --- Title strip ---
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(17)
     .text('LOAN / ADVANCE RECEIPT FORM', margin, doc.y, { width: contentW, align: 'center' })
  doc.moveDown(0.15)
  doc.fontSize(10).fillColor('#475569').font('Helvetica-Bold').text(`Ref: ${refNo}`, { align: 'center' })
  doc.moveDown(0.4)
  doc.moveTo(margin, doc.y).lineTo(margin + contentW, doc.y)
     .strokeColor('#2563eb').lineWidth(2).stroke()
  doc.moveDown(0.6)

  // ============ Section 1 ============
  drawSectionHeader(doc, 'Section 1:', 'EMPLOYEE INFORMATION', margin, contentW)

  const sec1 = [
    [{ label: 'Name:', value: empName }, { label: 'Employee Code:', value: empCode }],
    [{ label: 'Type:', value: null, checkboxes: [{ checked: isLoan, label: 'Loan' }, { checked: isAdvance, label: 'Advance' }] }, { label: 'Date:', value: requestDate }],
    [{ label: 'Designation:', value: designation }, { label: 'Location:', value: city }],
    [{ label: 'Department:', value: department }, { label: 'Amount:', value: `PKR ${amount.toLocaleString()}`, highlight: true }]
  ]
  drawCellTable(doc, sec1, margin, contentW, 28)
  doc.moveDown(0.8)

  // ============ Section 2 — Undertaking ============
  drawSectionHeader(doc, 'Section 2:', 'UNDERTAKING', margin, contentW)
  doc.fillColor('#111827').font('Helvetica').fontSize(10)

  // Undertaking line 1 with inline bold values
  doc.text('I, ', margin, doc.y, { width: contentW, continued: true, align: 'justify' })
     .font('Helvetica-Bold').text(empName, { continued: true })
     .font('Helvetica').text(' holding CNIC no. ', { continued: true })
     .font('Helvetica-Bold').text(cnic, { continued: true })
     .font('Helvetica').text(' working as ', { continued: true })
     .font('Helvetica-Bold').text(designation, { continued: true })
     .font('Helvetica').text(' in ', { continued: true })
     .font('Helvetica-Bold').text(department, { continued: true })
     .font('Helvetica').text(' (Pvt.) Ltd, at ', { continued: true })
     .font('Helvetica-Bold').text(city, { continued: true })
     .font('Helvetica').text(' since ', { continued: true })
     .font('Helvetica-Bold').text(joinYear, { continued: true })
     .font('Helvetica').text(`, have applied for the ${isLoan ? 'Loan' : 'Advance'} facility amounting to Rs. `, { continued: true })
     .font('Helvetica-Bold').text(amount.toLocaleString(), { continued: true })
     .font('Helvetica').text(' /-.')
  doc.moveDown(0.5)

  // Undertaking line 2 with inline bold for installments
  doc.font('Helvetica')
     .text('I hereby, undertake that the reason for the Loan/Advance applied is true to the best of my knowledge. I agree to be bound by ', margin, doc.y, { width: contentW, continued: true, align: 'justify' })
     .font('Helvetica-Bold').text("'Advance & Loan Policy'", { continued: true })
     .font('Helvetica').text(' of the Company and be responsible for paying the entire Advance/Loan amount availed by me in ', { continued: true })
     .font('Helvetica-Bold').text(String(installmentMonths), { continued: true })
     .font('Helvetica').text(' installment (for Advance not more than 1 & for Loan not more than 10). In case of my separation from the Company, I hereby, authorize the Company to deduct the full outstanding Loan/Advance amount, if any, from my full & final settlement.')

  doc.moveDown(1.0)
  {
    const by = doc.y
    drawStatusBadge(doc, margin, by, contentW / 2 - 8, 'submitted', `Employee — ${empName}`, requestDate)
    doc.y = by + 42
  }

  // ============ Section 3 — HR Department ============
  drawSectionHeader(doc, 'Section 3:', 'TO BE FILLED BY HR DEPARTMENT', margin, contentW)

  const sec3 = [
    [{ label: 'Date of Joining:', value: joinDate }, { label: 'Monthly Gross Salary:', value: grossSalary != null ? `PKR ${grossSalary.toLocaleString()}` : DASH }],
    [{ label: 'Outstanding Loan (if any):', value: '0' }, { label: 'Employment Status:', value: employmentStatus }],
    [{ label: 'Advance / Loan Status:', value: null, checkboxes: [{ checked: true, label: 'Approved' }, { checked: false, label: 'Not Approved' }] }, { label: 'Approved Loan Amount:', value: `PKR ${amount.toLocaleString()}` }],
    [{ label: 'No. of Installments:', value: String(installmentMonths) }, { label: 'Installment Start From:', value: installmentStartFmt }]
  ]
  drawCellTable(doc, sec3, margin, contentW, 32)

  // Full-width Installment Amount row
  const fullY = doc.y
  doc.rect(margin, fullY, contentW, 30)
     .fillAndStroke('#eff6ff', '#bfdbfe')
  doc.fillColor('#1e3a8a').font('Helvetica-Bold').fontSize(9)
     .text('INSTALLMENT AMOUNT', margin + 10, fullY + 7)
  doc.fillColor('#1e3a8a').font('Helvetica-Bold').fontSize(13)
     .text(`PKR ${monthlyDeduction.toLocaleString()}`, margin + contentW / 2, fullY + 6, { width: contentW / 2 - 10, align: 'right' })
  doc.y = fullY + 36

  drawBadgeRow(doc, margin, contentW,
    ['approved', 'Verified — Finance & HR', financeApprovedDate],
    ['approved', 'Approved — CEO', ceoApprovedDate])
  doc.moveDown(0.4)

  // Footer
  doc.fillColor('#475569').font('Helvetica-Oblique').fontSize(9)
     .text(`Reason / Purpose: ${reason}`, margin, doc.y, { width: contentW })
  doc.moveDown(0.2)
  doc.fillColor('#6b7280').font('Helvetica').fontSize(8)
     .text(`Printed on: ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`, { align: 'right' })

  doc.end()
  return donePromise
}

// =========================== Layout helpers ===========================

function drawSectionHeader(doc, sectionLabel, sectionTitle, x, width) {
  const y = doc.y
  const h = 24
  doc.rect(x, y, width, h).fillAndStroke('#f1f5f9', '#cbd5e1')
  // Blue left accent bar
  doc.rect(x, y, 4, h).fill('#2563eb')
  doc.fillColor('#1e3a8a').font('Helvetica-Bold').fontSize(10.5).text(sectionLabel, x + 12, y + 7)
  doc.fillColor('#334155').font('Helvetica-Bold').fontSize(10.5).text(sectionTitle, x + 92, y + 7, { width: width - 102 })
  doc.y = y + 30
  doc.fillColor('#111827')
}

/**
 * Draw a 2-column table of label-value cells.
 * @param rows  array of 2-cell rows; each cell = { label, value, checkboxes?, highlight? }
 * @param rowH  per-row height (use 32 for sections with checkboxes/underlines)
 */
function drawCellTable(doc, rows, x, width, rowH = 28) {
  const col = width / 2
  for (const row of rows) {
    const y = doc.y
    drawCell(doc, row[0], x, y, col, rowH)
    drawCell(doc, row[1], x + col, y, col, rowH)
    doc.y = y + rowH
  }
}

function drawCell(doc, cell, x, y, w, h) {
  doc.rect(x, y, w, h).strokeColor('#cbd5e1').lineWidth(0.6).stroke()
  // Label
  doc.fillColor('#64748b').font('Helvetica').fontSize(7.5)
     .text(cell.label || '', x + 8, y + 4, { width: w - 16 })

  // Checkbox row OR value
  if (Array.isArray(cell.checkboxes)) {
    let cx = x + 8
    const cy = y + 16
    for (const cb of cell.checkboxes) {
      drawCheckbox(doc, cx, cy - 1, cb.checked, 9)
      doc.fillColor('#111827').font('Helvetica-Bold').fontSize(9)
         .text(cb.label, cx + 12, cy, { width: 80, lineBreak: false })
      cx += 12 + doc.widthOfString(cb.label) + 14
    }
  } else {
    const v = cell.value ?? DASH
    const isHighlight = !!cell.highlight
    doc.fillColor(isHighlight ? '#1e3a8a' : '#0f172a')
       .font('Helvetica-Bold').fontSize(isHighlight ? 11 : 10)
       .text(String(v), x + 8, y + 14, { width: w - 16, lineBreak: false })
    // Underline beneath the value
    const lineY = y + h - 6
    doc.moveTo(x + 8, lineY).lineTo(x + w - 8, lineY)
       .strokeColor('#94a3b8').lineWidth(0.4).dash(2, { space: 2 }).stroke().undash()
  }
}

function drawCheckbox(doc, x, y, checked, size = 10) {
  doc.rect(x, y, size, size).strokeColor('#374151').lineWidth(0.8).stroke()
  if (checked) {
    // Inner filled square (cleaner than an X for small sizes)
    doc.rect(x + 1.5, y + 1.5, size - 3, size - 3).fillColor('#1f2937').fill()
    doc.fillColor('#111827') // reset
  }
}

/** Small vector check mark (Helvetica has no ✓ glyph in WinAnsi, so draw it). */
function drawCheckMark(doc, cx, cy, size, color) {
  doc.save()
  doc.lineWidth(Math.max(1, size * 0.14)).strokeColor(color).lineCap('round').lineJoin('round')
  doc.moveTo(cx - size * 0.28, cy + size * 0.02)
     .lineTo(cx - size * 0.04, cy + size * 0.24)
     .lineTo(cx + size * 0.30, cy - size * 0.22)
     .stroke()
  doc.restore()
}

/**
 * Rounded status pill replacing a handwritten signature.
 * kind: 'approved' (green) | 'submitted' (blue).
 */
function drawStatusBadge(doc, x, y, w, kind, role, dateStr) {
  const h = 34
  const p = kind === 'approved'
    ? { bg: '#ecfdf5', border: '#34d399', circle: '#16a34a', title: '#15803d', label: 'APPROVED' }
    : { bg: '#eff6ff', border: '#93c5fd', circle: '#2563eb', title: '#1d4ed8', label: 'SUBMITTED' }
  doc.roundedRect(x, y, w, h, 6).fillAndStroke(p.bg, p.border)
  const r = 8.5
  const ccx = x + 18
  const ccy = y + h / 2
  doc.circle(ccx, ccy, r).fill(p.circle)
  drawCheckMark(doc, ccx, ccy, r * 1.6, '#ffffff')
  doc.fillColor(p.title).font('Helvetica-Bold').fontSize(10.5)
     .text(p.label, x + 34, y + 6, { width: w - 42, lineBreak: false })
  doc.fillColor('#475569').font('Helvetica').fontSize(7.5)
     .text(`${role}${dateStr ? '  ·  ' + dateStr : ''}`, x + 34, y + 20, { width: w - 42, lineBreak: false })
  doc.fillColor('#111827')
}

/** Two side-by-side status badges. left/right = [kind, role, dateStr]. */
function drawBadgeRow(doc, x, width, left, right) {
  const y = doc.y
  const gap = 16
  const w = (width - gap) / 2
  drawStatusBadge(doc, x, y, w, left[0], left[1], left[2])
  drawStatusBadge(doc, x + w + gap, y, w, right[0], right[1], right[2])
  doc.y = y + 40
}
