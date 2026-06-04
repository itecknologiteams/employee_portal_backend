/**
 * Generates the Employee Portal User Manual as a PDF using pdfkit.
 *
 *   node scripts/generate-portal-manual.js [outputPath]
 *
 * Default output: docs/Employee-Portal-Manual.pdf
 * The manual content is the structured `MANUAL` array below — edit that to change the doc.
 */
import PDFDocument from 'pdfkit'
import fs from 'fs'
import path from 'path'

const OUT = process.argv[2] || path.join('docs', 'Employee-Portal-Manual.pdf')
const VERSION = process.env.MANUAL_VERSION || '1.0'
const DATE = process.env.MANUAL_DATE || '2026-06-04'

// ---- palette ---------------------------------------------------------------
const BRAND = '#1e3a8a'
const ACCENT = '#2563eb'
const DARK = '#111827'
const BODY = '#1f2937'
const GREY = '#6b7280'
const LIGHT = '#eef2ff'
const ROW = '#f3f4f6'
const LINE = '#e5e7eb'

const M = 58
const A4 = { w: 595.28, h: 841.89 }
const CONTENT_W = A4.w - M * 2
const BOTTOM = A4.h - 64

const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true, autoFirstPage: false })
doc.pipe(fs.createWriteStream(OUT))

let sectionTitle = ''

function ensure(h) {
  if (doc.y + h > BOTTOM) doc.addPage()
}

function h1(num, text) {
  doc.addPage()
  sectionTitle = text
  doc.rect(M, doc.y, CONTENT_W, 34).fill(BRAND)
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(16)
    .text(`${num}.  ${text}`, M + 12, doc.y + 9)
  doc.moveDown(1.2)
  doc.fillColor(BODY)
}

function h2(text) {
  ensure(46)
  doc.moveDown(0.5)
  doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(12.5).text(text, M, doc.y)
  doc.moveTo(M, doc.y + 2).lineTo(M + CONTENT_W, doc.y + 2).lineWidth(0.7).strokeColor(LINE).stroke()
  doc.moveDown(0.5)
  doc.fillColor(BODY)
}

function h3(text) {
  ensure(30)
  doc.moveDown(0.3)
  doc.fillColor(DARK).font('Helvetica-Bold').fontSize(10.8).text(text, M, doc.y)
  doc.moveDown(0.2)
  doc.fillColor(BODY)
}

function p(text) {
  ensure(24)
  doc.fillColor(BODY).font('Helvetica').fontSize(10).text(text, M, doc.y, {
    width: CONTENT_W, align: 'left', lineGap: 2.5
  })
  doc.moveDown(0.45)
}

function bullets(items, ordered = false) {
  doc.font('Helvetica').fontSize(10).fillColor(BODY)
  items.forEach((it, i) => {
    const marker = ordered ? `${i + 1}.` : '•'
    const indent = ordered ? 20 : 14
    const h = doc.heightOfString(it, { width: CONTENT_W - indent, lineGap: 2 })
    ensure(h + 6)
    const y = doc.y
    doc.fillColor(ACCENT).font('Helvetica-Bold').text(marker, M, y, { width: indent, continued: false })
    doc.fillColor(BODY).font('Helvetica').text(it, M + indent, y, { width: CONTENT_W - indent, lineGap: 2 })
    doc.moveDown(0.25)
  })
  doc.moveDown(0.3)
}

function note(text, label = 'Note') {
  doc.font('Helvetica').fontSize(9.5)
  const inner = CONTENT_W - 24
  const th = doc.heightOfString(text, { width: inner, lineGap: 2 })
  const boxH = th + 26
  ensure(boxH + 8)
  const y = doc.y
  doc.rect(M, y, CONTENT_W, boxH).fill(LIGHT)
  doc.rect(M, y, 4, boxH).fill(ACCENT)
  doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(9).text(label.toUpperCase(), M + 14, y + 8)
  doc.fillColor(BODY).font('Helvetica').fontSize(9.5).text(text, M + 14, y + 20, { width: inner, lineGap: 2 })
  doc.y = y + boxH
  doc.moveDown(0.6)
}

function table(headers, rows, widths) {
  const colW = widths.map((w) => w * CONTENT_W)
  const pad = 6
  const drawRow = (cells, { head = false, zebra = false } = {}) => {
    doc.font(head ? 'Helvetica-Bold' : 'Helvetica').fontSize(head ? 9 : 9)
    const heights = cells.map((c, i) => doc.heightOfString(String(c ?? ''), { width: colW[i] - pad * 2, lineGap: 1.5 }))
    const rowH = Math.max(...heights) + pad * 2
    ensure(rowH)
    const y = doc.y
    if (head) doc.rect(M, y, CONTENT_W, rowH).fill(BRAND)
    else if (zebra) doc.rect(M, y, CONTENT_W, rowH).fill(ROW)
    let x = M
    cells.forEach((c, i) => {
      doc.fillColor(head ? '#ffffff' : BODY).font(head ? 'Helvetica-Bold' : 'Helvetica').fontSize(9)
        .text(String(c ?? ''), x + pad, y + pad, { width: colW[i] - pad * 2, lineGap: 1.5 })
      x += colW[i]
    })
    doc.moveTo(M, y + rowH).lineTo(M + CONTENT_W, y + rowH).lineWidth(0.5).strokeColor(LINE).stroke()
    doc.y = y + rowH
  }
  ensure(40)
  drawRow(headers, { head: true })
  rows.forEach((r, i) => drawRow(r, { zebra: i % 2 === 1 }))
  doc.moveDown(0.6)
}

// ---- cover ------------------------------------------------------------------
function cover() {
  doc.addPage()
  doc.rect(0, 0, A4.w, 220).fill(BRAND)
  doc.rect(0, 220, A4.w, 8).fill(ACCENT)
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(30).text('Employee Portal', M, 88, { width: CONTENT_W })
  doc.fontSize(18).font('Helvetica').text('User & Operations Manual', M, 130)
  doc.fillColor(DARK).font('Helvetica-Bold').fontSize(13).text('iTecknologi — Internal HR & Procurement System', M, 280, { width: CONTENT_W })
  doc.fillColor(GREY).font('Helvetica').fontSize(10.5).moveDown(0.8)
    .text('This manual explains how each part of the Employee Portal works — authentication and access, roles and permissions, the dashboard, profile management, leave, requisitions (procurement), payroll and salary slips, feedback, notifications, the technician card directory, the extensions directory, and administration. It is written for everyday users as well as approvers and administrators.', M, doc.y, { width: CONTENT_W, lineGap: 3 })
  const by = 700
  doc.moveTo(M, by).lineTo(M + CONTENT_W, by).lineWidth(1).strokeColor(LINE).stroke()
  doc.fillColor(DARK).font('Helvetica-Bold').fontSize(10).text(`Version ${VERSION}`, M, by + 12)
  doc.fillColor(GREY).font('Helvetica').fontSize(10).text(`Last updated: ${DATE}`, M, by + 12, { width: CONTENT_W, align: 'right' })
}

// ---- content model ----------------------------------------------------------
function render(blocks) {
  for (const b of blocks) {
    if (b.h2) h2(b.h2)
    else if (b.h3) h3(b.h3)
    else if (b.p) p(b.p)
    else if (b.ul) bullets(b.ul)
    else if (b.ol) bullets(b.ol, true)
    else if (b.note) note(b.note)
    else if (b.table) table(b.table.head, b.table.rows, b.table.widths)
  }
}

cover()
let n = 0
for (const sec of MANUAL()) {
  n += 1
  h1(n, sec.title)
  render(sec.body)
}

// ---- footers (page numbers) -------------------------------------------------
const range = doc.bufferedPageRange()
for (let i = 1; i < range.count; i++) { // skip cover (page 0)
  doc.switchToPage(i)
  const savedBottom = doc.page.margins.bottom
  doc.page.margins.bottom = 0 // prevent the footer (drawn below the text area) from spawning new pages
  doc.font('Helvetica').fontSize(8).fillColor(GREY)
  doc.moveTo(M, A4.h - 50).lineTo(M + CONTENT_W, A4.h - 50).lineWidth(0.5).strokeColor(LINE).stroke()
  doc.text('Employee Portal — User & Operations Manual', M, A4.h - 44, { width: CONTENT_W, align: 'left', lineBreak: false })
  doc.text(`Page ${i}`, M, A4.h - 44, { width: CONTENT_W, align: 'right', lineBreak: false })
  doc.page.margins.bottom = savedBottom
}

doc.end()
console.log('Manual written to', OUT)

// ============================================================================
// MANUAL CONTENT
// ============================================================================
function MANUAL() {
  return [
    {
      title: 'Portal Overview',
      body: [
        { p: 'The Employee Portal is iTecknologi’s internal web application for day-to-day HR and procurement operations. It brings together employee self-service, approval workflows, and administration in one place, so that requests are submitted, routed, approved, and recorded consistently and with a full audit trail.' },
        { h2: 'What you can do in the portal' },
        { ul: [
          'View a personalised dashboard with organisation stats and your pending approvals.',
          'Maintain your profile and request changes that HR approves.',
          'Apply for leave and track its approval; approvers act on requests routed to them.',
          'Raise requisitions (procurement requests) and move them through the approval chain.',
          'View and download your salary slips, protected by a personal PIN.',
          'Submit feedback, receive notifications, and look up colleagues in the card and extension directories.',
          'Administrators manage employees, departments, designations, roles, permissions, and history.'
        ] },
        { h2: 'How the portal is organised' },
        { p: 'Access to each feature is controlled by your role and permissions. A standard employee sees self-service features (profile, leave, salary slip, feedback, personal requisitions). Approvers (HOD, HR, Committee, CEO, Procurement, Finance) additionally see the queues for requests awaiting their action. Administrators and SuperAdmins see configuration and master-data tools.' },
        { note: 'Throughout this manual, monetary amounts are in Pakistani Rupees (PKR). Role names such as HOD (Head of Department), Committee, and CEO refer to the approval roles configured for your account, not necessarily your job title.' }
      ]
    },
    {
      title: 'Getting Started: Login & Access',
      body: [
        { h2: 'Signing in' },
        { ol: [
          'Open the portal in your browser and enter your username/email and password (minimum 8 characters). Passwords are securely hashed.',
          'Optionally tick “Remember Me” to keep the session for up to 7 days.',
          'If single sign-on (CRM SSO) is enabled for your organisation, you can be signed in automatically from the CRM; an SSO session can also be revoked from the CRM side, which logs you out of the portal.'
        ] },
        { p: 'Sessions are kept server-side. When you reopen the portal, your session is restored automatically. You can log out at any time, which ends the session.' },
        { h2: 'User types' },
        { table: { head: ['User type', 'Who it is', 'Typical access'], widths: [0.22, 0.30, 0.48], rows: [
          ['SuperAdmin', 'System administrator', 'Everything, including roles, permissions and administration.'],
          ['Admin', 'Administrative user', 'As configured by the SuperAdmin (departments, designations, employees, etc.).'],
          ['Staff', 'HR / payroll / procurement staff', 'Elevated access as configured per role.'],
          ['User', 'Standard employee', 'Profile, salary slip, leave, feedback, own requisitions.'],
          ['Technician', 'Field/technical staff', 'Profile, salary slip, leave, feedback, help & support, extensions.']
        ] } },
        { note: 'A user’s portal access (user type) is separate from their Employee Type (HR/payroll classification) and their Designation (job title). One person can be, for example, User + “Employee” type + “Technician” designation.' }
      ]
    },
    {
      title: 'Roles & Permissions',
      body: [
        { p: 'The portal uses role-based access control. Each role (Admin, Staff, User, Technician) is granted a set of permission keys, and those permissions decide which menu items and actions appear for a user. Only a SuperAdmin can view and change the permission matrix.' },
        { h2: 'Three separate concepts' },
        { ul: [
          'Portal Role (user_type): controls access level in the portal — SuperAdmin, Admin, Staff, User, Technician.',
          'Employee Type: an HR/payroll classification such as Employee, HOD, Committee, CEO, Procurement, Finance. This is what drives approval routing in workflows.',
          'Designation: the job title (e.g. Team Lead, Manager, Director). A designation containing “Technician” automatically maps the user to the Technician role.'
        ] },
        { h2: 'How permissions are configured' },
        { ol: [
          'A SuperAdmin opens the Role Permissions page and authenticates with their employee code.',
          'A matrix shows roles as columns (Admin, Staff, User, Technician) and features as rows, grouped by area (General, Salary, Leave, Feedback, Requisition, Reports, Payroll, Administration).',
          'Toggling a permission and saving updates the role; the full matrix is saved together so changes persist.'
        ] },
        { h2: 'Examples of permission keys' },
        { ul: [
          'General: dashboard, profile, profile_update_requests, help_support, extensions.',
          'Salary & Payroll: salary_slip, view_salary_slips, payroll and its sub-permissions.',
          'Leave: leave, leave_pending, leave_approvals.',
          'Requisition: requisition_create, requisition_can_add_items, requisition_pending, requisition_approved, requisition_history, requisition_reports, requisition_acknowledgment.',
          'Administration: administration, tat_report.'
        ] },
        { note: 'SuperAdmin is an explicit system role (users.user_type = “SuperAdmin”), not a designation. It has full control over permissions and administration.' }
      ]
    },
    {
      title: 'Dashboard',
      body: [
        { p: 'The dashboard is the landing page after login. It shows a personalised summary and quick links.' },
        { h2: 'Summary statistics' },
        { ul: [
          'Total Employees — organisation-wide count of active employees.',
          'Active Leaves — approved leave requests where today falls within the leave period.',
          'Pending Requests — for approvers only: the number of items awaiting your action (e.g. an HOD sees department requisitions and leave; Committee/CEO/Finance/Procurement see items at their stage).'
        ] },
        { h2: 'Recent activity & quick actions' },
        { ul: [
          'Recent Activity lists the pages you last visited, with how long ago, for quick navigation back.',
          'Quick Actions link directly to Request Leave, Requisitions, Download Salary Slip, and Update Profile.'
        ] }
      ]
    },
    {
      title: 'Profile & Profile Change Requests',
      body: [
        { p: 'Every user has a profile with basic and extended details. To keep records accurate, employees do not edit critical fields directly — they submit a change request that HR reviews.' },
        { h2: 'Requesting a profile change (employee)' },
        { ol: [
          'Open the Profile page and submit the fields you want changed (e.g. name, email, phone, address, date of birth, CNIC details, emergency contact, profile image).',
          'A change request is created with status Pending and HR is notified.',
          'You can see your request status on the Profile page. Only one pending request exists at a time — submitting again updates it.'
        ] },
        { h2: 'HR review' },
        { ul: [
          'HR opens Profile Update Requests (requires the profile_update_requests permission and an HR role).',
          'Approve applies all requested fields to the employee record and marks the request Approved; the employee is notified.',
          'Reject discards the request with no changes and marks it Rejected; the employee is notified.'
        ] }
      ]
    },
    {
      title: 'Leave Management',
      body: [
        { p: 'The leave module handles leave balances, requests, and approvals, and synchronises Casual/Sick leave with the external ICS Attendance System.' },
        { h2: 'Leave types' },
        { table: { head: ['ID', 'Type', 'Notes'], widths: [0.1, 0.3, 0.6], rows: [
          ['1', 'Casual', 'Managed via ICS Attendance System; portal tracks/sync.'],
          ['2', 'Sick', 'Managed via ICS Attendance System; portal tracks/sync.'],
          ['3', 'Annual', 'Prorated for new joiners; full allocation after one year.'],
          ['4', 'Marriage', 'Portal-managed allocation.'],
          ['5', 'Maternity', 'Female employees.'],
          ['6', 'Paternal', 'Male employees.'],
          ['7', 'Pilgrimage', 'Portal-managed allocation.']
        ] } },
        { h2: 'Approval routing' },
        { p: 'The initial status of a request is decided automatically from who is applying and the leave type:' },
        { ul: [
          'Standard employee → routed to their HOD. HOD approval is final.',
          'An HOD applying for their own leave → Annual, Marriage, Maternity, Paternal and Pilgrimage go to the CEO (CEO approval is final); Casual and Sick still go to HR.',
          'Senior executives (CEO/COO/Director) applying for their own leave → go to HR (they cannot approve their own leave).'
        ] },
        { p: 'Status values: Pending (with HOD), Pending HR, Pending CEO, Approved, Rejected.' },
        { note: 'Leaves in “Pending CEO” are intentionally hidden from HR’s leave register, because they belong to the CEO’s approval queue.' },
        { h2: 'Where each role acts' },
        { ul: [
          'Employee: applies for leave and tracks status on the Leave page; balance cards show Annual, Carried Forward and external Casual/Sick.',
          'HOD: a pending queue of department leaves (status Pending); approve forwards to HR (or to CEO for the HOD’s own special leaves), reject is final.',
          'HR: a pending HR queue plus a full leave register; HR also manages balances, quotas, deductions and rollovers.',
          'CEO: a CEO approval queue showing only the HODs’ special leaves awaiting CEO sign-off.'
        ] },
        { h2: 'HR balance & quota functions' },
        { ul: [
          'Allocate default quotas to all active employees (prorated Annual; gender-based Maternity/Paternal).',
          'Edit an individual employee’s balances, or bulk-import quotas by CSV.',
          'One-time import of Carried Forward values; afterwards it is computed automatically on rollover.',
          'Manual deduction with a mandatory reason — recorded in an immutable audit log (balance before/after, who, when).',
          'Annual leave rollover for employees with 2+ years of service: remaining Annual moves to Carried Forward and Annual resets.'
        ] },
        { h2: 'Approval effects & notifications' },
        { ul: [
          'On approval of a portal-managed leave, the balance is deducted (Annual draws on Annual + Carried Forward).',
          'Casual/Sick decisions are synced back to the ICS Attendance System.',
          'Submit, approve and reject events send in-app notifications and branded HTML emails (using a shared template) to the relevant people; the applicant is emailed the decision.'
        ] }
      ]
    },
    {
      title: 'Requisition (Procurement) Management',
      body: [
        { p: 'The requisition module routes purchase and advance requests through a configurable approval chain that depends on the requisition category, then tracks execution to completion and acknowledgment.' },
        { h2: 'Roles involved' },
        { table: { head: ['Role', 'Responsibility'], widths: [0.24, 0.76], rows: [
          ['Employee / Creator', 'Submits the requisition (location, category, items, required-by date). Cannot approve their own.'],
          ['HOD', 'First approval for most categories; enters/edits the Bill of Quantities (BOQ); can reject or revert for corrections.'],
          ['IT', 'Optional stage (IT Equipments) to restructure items into vendor specifications.'],
          ['HR', 'Mandatory stage for Loan & Advance Salary; sets approved amount and installments.'],
          ['Committee', 'Reviews and sets approved quantity per item.'],
          ['CEO', 'Approves higher-value requisitions (committee-approved total ≥ PKR 100,000).'],
          ['Procurement', 'Acknowledges, uploads three quotations, hands over to Finance, marks purchase complete.'],
          ['Finance', 'Selects the approved quotation and gives final financial approval.'],
          ['Admin', 'Executes categories that have no Procurement stage (e.g. Stationary).']
        ] } },
        { h2: 'Category-driven flow' },
        { p: 'Each category defines, per stage, one of three behaviours: approval (must sign off), for_info (auto-approved and notified), or skip (bypassed). This makes each category’s chain configurable. Examples:' },
        { ul: [
          'IT Equipments: HOD → IT → Committee → CEO (if ≥ PKR 100,000) → Procurement → Finance. BOQ and 18% sales tax apply.',
          'General Procurements (Grocery/Appliances): Committee → CEO (if ≥ PKR 100,000) → Procurement. HOD, IT and HR are skipped.',
          'Stationary: HOD is “for info” (auto-approved) → Admin executes. No BOQ.',
          'Loan & Advance Salary: HOD → HR → Finance (Committee/CEO/Procurement skipped).'
        ] },
        { h2: 'Lifecycle' },
        { ol: [
          'Create: the employee picks a category and submits items/details; it routes to the first non-skipped stage. If the creator is themselves an HOD/Committee/CEO, earlier stages auto-advance.',
          'Approvals: each stage approves, rejects (with reason), or — from Committee onward — reverts to the HOD for corrections. The HOD enters BOQ (size, brand, qty, price) for BOQ categories.',
          'Committee quantities: the Committee sets an approved quantity per item; the approved line total decides the CEO rule.',
          'CEO threshold: if the committee-approved total is below PKR 100,000, the CEO stage is skipped automatically.',
          'Procurement: acknowledges, uploads three quotations, sets an expected handover date, and hands over to Finance.',
          'Finance: selects the approved quotation (1–3) and approves; Procurement then marks the purchase complete.',
          'Acknowledgment: the HOD and/or creator acknowledges receipt, which closes the requisition.'
        ] },
        { h2: 'Statuses' },
        { ul: [
          'Pending HOD, Pending IT, Pending HR, Pending Committee, Pending CEO, Pending Admin — awaiting that stage.',
          'Forwarded to Procurement, Acknowledged by Procurement – Add 3 Quotations, Quotations Added – Hand over to Finance.',
          'Pending Finance Approval, Finance Approved – Ready for Purchase.',
          'Completed – Pending Acknowledgment, Pending your acknowledgment, Completed, Closed.',
          'Rejected — with the reason recorded.'
        ] },
        { h2: 'Other features' },
        { ul: [
          'Rejection always records a reason and notifies the creator.',
          'Revert-to-HOD lets a later approver send the request back for correction; on resubmission it skips intermediate stages.',
          'IT Equipment items carry 18% sales tax (rate configurable by SuperAdmin).',
          'Urgent requisitions bypass the minimum required-by-date rule.',
          'Requisitions can be hidden (soft-deleted) and restored by a SuperAdmin.',
          'Per-stage comments, in-app + email notifications, and BullMQ-based reminder emails (3/2/1 days) keep everyone informed.'
        ] },
        { note: 'A BOQ category requires at least one line item with a quantity before the Committee can approve. If a requisition was created with no items, items must be added (by the HOD) first.' }
      ]
    },
    {
      title: 'Payroll & Salary',
      body: [
        { p: 'The portal provides automated payroll (calculating slips from attendance, leave, loans and salary structures) and a traditional payroll path (Excel uploads with manual control). Both store results as salary slips that employees can view and download.' },
        { h2: 'Payroll periods' },
        { p: 'A payroll period moves through states: Draft (editable; deletable), Processing (run in progress), Processed (slips generated; can re-run), Published (visible to employees) and Closed (final, locked).' },
        { h2: 'Automated payroll' },
        { ol: [
          'Create a period (name, dates, working days).',
          'Add variable entries per employee — allowances (overtime, KPI incentives, arrears, etc.) and deductions (income tax, loan, advance, pandemic, leaves, device, etc.) — typed in or imported by CSV/Excel (flat or grid format).',
          'Run payroll: the system gathers active employees, salary structures, approved leaves and attendance, then computes each slip and stores it.',
          'Review and adjust slips; then publish and/or close the period.'
        ] },
        { h2: 'How a slip is calculated' },
        { ul: [
          'Effective working days are prorated for joiners/leavers within the period.',
          'Absent days = attendance absences + (late count ÷ 3) + unpaid leave days; paid days = effective days − absent days.',
          'Gross = daily rate × paid days, where daily rate = (basic + total allowances) ÷ effective working days.',
          'Deductions (EOBI plus the variable deductions for the month) are summed; Net = Gross − Deductions (not below zero).',
          'Absent and late “deductions” are shown for information only — they are already reflected in the prorated gross.'
        ] },
        { h2: 'Traditional payroll' },
        { ul: [
          'Upload gross salaries or a full payroll sheet to populate salary structures.',
          'Optionally set per-employee period overrides (working days, other allowance/deduction, loan, advance).',
          'Run payroll to generate slips, then apply a deductions sheet to fill income tax/loan/other deductions.',
          'Slips can be held (hidden from employees) individually or for a whole period.'
        ] },
        { h2: 'Salary slips for employees' },
        { ul: [
          'Employees view their slips on the Salary Slip page; access is protected by a 4–8 digit FPIN (5 wrong attempts triggers a short lockout).',
          'A slip can be downloaded as a PDF (company header, earnings, deductions, net).',
          'HR with the view_salary_slips permission can see all slips and bypass the PIN.'
        ] },
        { note: 'Income tax is not auto-computed from tax slabs in the current implementation — it is set during slip editing or imported from the payroll sheet. Attendance integration depends on the ICS endpoint being configured.' }
      ]
    },
    {
      title: 'Feedback',
      body: [
        { p: 'Employees can submit structured feedback, which HR reviews. Feedback is stored with the employee’s ID but presented to reviewers without identifying the author.' },
        { h2: 'Submitting feedback' },
        { ul: [
          'Provide a subject, category (HR, IT, Finance, General, Work Environment, Process Improvement, Team Collaboration, Other), a message, and an optional 1–5 star rating.',
          'On submit, HR members receive an in-app notification (and an optional email to the category’s configured address).'
        ] },
        { h2: 'Reviewing feedback' },
        { ul: [
          'HR opens Feedback Records to see all submissions, newest first, with subject, category, message, rating, status and date.',
          'Employees can review their own submissions in Feedback History.'
        ] }
      ]
    },
    {
      title: 'Notifications',
      body: [
        { p: 'The portal keeps users informed through in-app notifications, optional web-push, and email.' },
        { h2: 'In-app notifications' },
        { ul: [
          'A header badge shows the unread count; notifications can be marked read individually or all at once.',
          'Each notification has a title, body, a deep link to the related item, and a timestamp; they are stored and survive refreshes.',
          'Real-time delivery uses a server-sent events stream so new notifications appear without polling.'
        ] },
        { h2: 'Web push & email' },
        { ul: [
          'Browsers can subscribe to web-push (VAPID); failed subscriptions are cleaned up automatically.',
          'Email notifications are sent for key events when SMTP is configured (e.g. leave decisions, requisition stage changes, feedback).'
        ] },
        { h2: 'Who gets notified' },
        { ul: [
          'Leave: applicant and the relevant approver (HOD, HR, or CEO) on submit; the applicant on decision.',
          'Requisitions: the approver at each stage on hand-off; the creator on rejection or revert.',
          'Feedback: all HR members on submission.'
        ] }
      ]
    },
    {
      title: 'Card Directory & Extensions',
      body: [
        { h2: 'Technician Cards' },
        { p: 'The Cards module is a directory of technician profile cards, each with contact details and a QR code. It is backed by its own cards database, separate from the main employee records.' },
        { ul: [
          'A public grid lists technicians with photo, name, code, department, designation, phone, email, website and address.',
          'Each card has a QR code linking to its detail page (useful for printed cards); all QR codes can be exported together as a ZIP of PNGs.',
          'Cards can be added and edited; profile images are stored inline (as data URLs).'
        ] },
        { h2: 'Extensions Directory' },
        { p: 'The Extensions page is a quick reference of employees with their department, designation, location and phone extension — handy for internal dialling and finding key contacts.' }
      ]
    },
    {
      title: 'Administration & Employee History',
      body: [
        { p: 'Administration (restricted to the administration permission) is where master data and employee records are maintained, with automatic history logging for key changes.' },
        { h2: 'Master data' },
        { ul: [
          'Departments, Designations and Employee Types — create, edit and delete (deletion is blocked while employees reference them).',
          'Stations and Cities — geographic locations used on profiles and requisitions.',
          'Requisition Categories — names and optional custom form layouts that shape the requisition form.'
        ] },
        { h2: 'Employees & HOD assignments' },
        { ul: [
          'Search and filter employees; create and update records; toggle active/inactive and set a last working date for separations.',
          'Assign one or more employees as HOD of one or more departments (this drives requisition and leave approval routing).'
        ] },
        { h2: 'Employee history & audit' },
        { ul: [
          'A history log records events such as salary change, department/designation/type change, confirmation, probation, joining, last working date, rehire, location and grade changes.',
          'Editing an employee’s department, designation, type, grade or location auto-logs a history event (idempotent and non-blocking).',
          'Each event captures effective date, old/new values, reason, reference, approver and approval status — giving a complete, auditable trail.'
        ] }
      ]
    },
    {
      title: 'Help & Support',
      body: [
        { p: 'The Help & Support page is the in-portal guide to the system. It provides an overview and step-by-step instructions for login, dashboard, profile, salary slip, leave, feedback and the full requisition workflow.' },
        { p: 'This manual is intended to be published on the Help & Support page so that the same explanations are available to everyone directly inside the portal.' },
        { note: 'If you spot anything in this manual that does not match what you see in the portal, please tell the HR/IT team so the document can be corrected and re-published.' }
      ]
    }
  ]
}
