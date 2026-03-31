import * as leaveRepo from '../repositories/leave.repository.js'
import * as reqRepo from '../repositories/requisition.repository.js'
import * as notifRepo from '../repositories/notification.repository.js'
import * as notifSvc from './notification.service.js'
import { getEmployeeIdByCode } from '../repositories/auth.repository.js'
import { EMAIL_FROM, getEmailTransport, isEmailConfigured } from '../../config/email.js'

const defaultBalance = { annual: 14, casual: 10, sick: 6 }

const LEAVE_EMAIL_SICK_CASUAL = process.env.LEAVE_EMAIL_SICK_CASUAL || 'anas.ahmed@itecknologi.com'
const LEAVE_EMAIL_ANNUAL = process.env.LEAVE_EMAIL_ANNUAL || 'hr@itecknologi.com'

function getLeaveNotificationEmail() {
  return LEAVE_EMAIL_ANNUAL
}

function isAnnualLeaveRequestType(leaveType) {
  const t = (leaveType && String(leaveType).trim().toLowerCase()) || ''
  return t.includes('annual')
}

function leaveRequestCalendarDays(leave) {
  if (!leave?.start_date || !leave?.end_date) return 0
  const s = new Date(leave.start_date)
  const e = new Date(leave.end_date)
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 0
  const diff = Math.floor((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1
  return Math.max(0, diff)
}

/**
 * On Approved: deduct annual days first, then update status; refund if status update fails.
 */
async function approveWithAnnualDeduction(leave, reqId, requiredCurrent, newStatus) {
  const eid = parseInt(leave.employee_id, 10)
  let toRefund = 0
  if (newStatus === 'Approved' && isAnnualLeaveRequestType(leave.leave_type)) {
    const already = Number(leave.annual_days_deducted) || 0
    if (already === 0) {
      const days = leaveRequestCalendarDays(leave)
      if (days > 0) {
        if (Number.isNaN(eid)) return { error: 'Invalid employee on leave request', status: 400 }
        const rows = await leaveRepo.deductAnnualLeave(eid, days)
        if (!rows.length) return { error: 'Insufficient annual leave balance', status: 400 }
        toRefund = days
      }
    }
  }
  const result = await leaveRepo.updateLeaveRequestStatus(reqId, newStatus, requiredCurrent)
  if (!result || result.length === 0) {
    if (toRefund > 0) await leaveRepo.refundAnnualLeave(eid, toRefund)
    return { error: 'Could not update status', status: 400 }
  }
  if (toRefund > 0) await leaveRepo.setAnnualDaysDeducted(reqId, toRefund)
  return { ok: true }
}

function parseEmployeeId(employeeId) {
  if (employeeId == null || employeeId === '') return null
  const n = parseInt(employeeId, 10)
  return Number.isNaN(n) ? null : n
}

/** Human-readable reference (aligned with typical HRMS leave registers). */
export function formatLeaveReference(leaveRequestId, createdAt) {
  const id = parseInt(leaveRequestId, 10)
  if (Number.isNaN(id)) return null
  const y = createdAt ? new Date(createdAt).getFullYear() : new Date().getFullYear()
  return `LV-${y}-${String(id).padStart(5, '0')}`
}

function parseYmdLocal(value) {
  if (value == null || String(value).trim() === '') return null
  const s = String(value).trim()
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  const y = parseInt(m[1], 10)
  const mo = parseInt(m[2], 10) - 1
  const d = parseInt(m[3], 10)
  const dt = new Date(y, mo, d)
  if (dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== d) return null
  return dt
}

function startOfLocalDay(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

/** Validates ISO date strings; returns calendar days inclusive (industry standard: calendar days unless policy defines working days). */
function validateLeaveDateRange(startDate, endDate) {
  const start = parseYmdLocal(startDate)
  const end = parseYmdLocal(endDate)
  if (!start || !end) {
    return { error: 'Valid start and end dates (YYYY-MM-DD) are required', status: 400 }
  }
  if (end < start) {
    return { error: 'End date must be on or after the start date', status: 400 }
  }
  const days = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1
  if (days < 1 || days > 366) {
    return { error: 'Leave duration must be between 1 and 366 calendar days', status: 400 }
  }
  const today = startOfLocalDay(new Date())
  if (startOfLocalDay(start) < today) {
    return { error: 'Start date cannot be in the past', status: 400 }
  }
  return { days, start, end }
}

async function resolveApproverEmployeeId(body) {
  if (body?.approvedByEmployeeId != null && String(body.approvedByEmployeeId).trim() !== '') {
    const eid = parseEmployeeId(String(body.approvedByEmployeeId))
    if (eid != null) return eid
  }
  if (body?.approvedByEmployeeCode != null && String(body.approvedByEmployeeCode).trim() !== '') {
    return await getEmployeeIdByCode(String(body.approvedByEmployeeCode).trim())
  }
  return null
}

export async function getLeaveBalance(employeeId) {
  const result = await leaveRepo.getLeaveBalance(employeeId)
  if (result.length === 0) return defaultBalance
  const b = result[0]
  return {
    annual: parseInt(b.annual_leave || 0, 10),
    casual: parseInt(b.casual_leave ?? 0, 10),
    sick: parseInt(b.sick_leave || 0, 10)
  }
}

/** HR only: replace employee leave quotas (annual, casual, sick days). */
export async function hrSetLeaveBalance(hrEmployeeId, targetEmployeeCode, body) {
  const hid = parseEmployeeId(hrEmployeeId != null ? String(hrEmployeeId) : null)
  if (hid == null) return { error: 'Valid hrEmployeeId is required', status: 400 }
  const isHr = await reqRepo.isHrMember(hid)
  if (!isHr) return { error: 'Only HR can update leave quotas', status: 403 }

  const code = targetEmployeeCode != null ? String(targetEmployeeCode).trim() : ''
  if (!code) return { error: 'Employee code is required', status: 400 }

  const tid = await getEmployeeIdByCode(code)
  if (!tid) return { error: 'Employee not found', status: 404 }

  const annual = Math.max(0, Math.floor(Number(body?.annual)))
  const casual = Math.max(0, Math.floor(Number(body?.casual)))
  const sick = Math.max(0, Math.floor(Number(body?.sick)))
  if (![annual, casual, sick].every((n) => Number.isFinite(n))) {
    return { error: 'annual, casual, and sick must be non-negative numbers', status: 400 }
  }

  const rows = await leaveRepo.setLeaveBalanceTotals(tid, annual, casual, sick)
  if (!rows.length) return { error: 'Could not update leave balance', status: 400 }
  const b = rows[0]
  return {
    employeeCode: code,
    annual: parseInt(b.annual_leave || 0, 10),
    casual: parseInt(b.casual_leave ?? 0, 10),
    sick: parseInt(b.sick_leave || 0, 10)
  }
}

export async function getLeaveRequests(employeeId) {
  const result = await leaveRepo.getLeaveRequests(employeeId)
  return result.map(r => ({
    id: r.leave_request_id,
    reference: formatLeaveReference(r.leave_request_id, r.created_at),
    type: r.leave_type || 'Annual Leave',
    startDate: r.start_date,
    endDate: r.end_date,
    days: parseInt(r.days || 0),
    status: r.status || 'Pending',
    reason: r.reason || '',
    date: r.created_at
  }))
}

/** HR manual leave deduction with mandatory reason + full audit trail. */
export async function hrDeductLeaveBalance(body) {
  let hid = parseEmployeeId(body?.hrEmployeeId != null ? String(body.hrEmployeeId) : null)
  if (hid == null && body?.hrEmployeeCode != null && String(body.hrEmployeeCode).trim() !== '') {
    hid = await getEmployeeIdByCode(String(body.hrEmployeeCode).trim())
  }
  if (hid == null) return { error: 'Valid hrEmployeeId is required', status: 400 }
  const isHr = await reqRepo.isHrMember(hid)
  if (!isHr) return { error: 'Only HR can deduct leave', status: 403 }

  const targetCode = body?.employeeCode != null ? String(body.employeeCode).trim() : ''
  if (!targetCode) return { error: 'employeeCode is required', status: 400 }
  const targetEmployeeId = await getEmployeeIdByCode(targetCode)
  if (!targetEmployeeId) return { error: 'Employee not found', status: 404 }

  const leaveType = String(body?.leaveType || '').trim().toLowerCase()
  if (!['annual', 'casual', 'sick'].includes(leaveType)) {
    return { error: 'leaveType must be one of: annual, casual, sick', status: 400 }
  }
  const days = Math.floor(Number(body?.days) || 0)
  if (days <= 0) return { error: 'days must be a positive integer', status: 400 }
  const reason = body?.reason != null ? String(body.reason).trim() : ''
  if (!reason) return { error: 'reason is required', status: 400 }
  if (reason.length > 1000) return { error: 'reason must be 1000 characters or less', status: 400 }

  let rows
  try {
    rows = await leaveRepo.createManualDeduction(targetEmployeeId, leaveType, days, reason, hid)
  } catch (err) {
    const msg = String(err?.message || '')
    if (msg.includes('leave_deduction_log')) {
      return {
        error:
          'Deduction log table is missing. Please run migration: database/migrations/leave_deduction_log_pg.sql',
        status: 500
      }
    }
    throw err
  }
  if (!rows.length) return { error: 'Insufficient leave balance for this deduction', status: 400 }
  const r = rows[0]
  return {
    deductionId: r.deduction_id,
    employeeCode: targetCode,
    leaveType: r.leave_type,
    days: parseInt(r.days_deducted || 0, 10),
    reason: r.reason || '',
    balanceBefore: parseInt(r.balance_before || 0, 10),
    balanceAfter: parseInt(r.balance_after || 0, 10),
    createdAt: r.created_at,
    balances: {
      annual: parseInt(r.annual_leave || 0, 10),
      casual: parseInt(r.casual_leave || 0, 10),
      sick: parseInt(r.sick_leave || 0, 10)
    }
  }
}

/** HR list of manual leave deductions (optionally filtered by employee code). */
export async function getManualDeductionLog(query = {}) {
  let hid = parseEmployeeId(query?.hrEmployeeId != null ? String(query.hrEmployeeId) : null)
  if (hid == null && query?.hrEmployeeCode != null && String(query.hrEmployeeCode).trim() !== '') {
    hid = await getEmployeeIdByCode(String(query.hrEmployeeCode).trim())
  }
  if (hid == null) return { error: 'Valid hrEmployeeId is required', status: 400 }
  const isHr = await reqRepo.isHrMember(hid)
  if (!isHr) return { error: 'Only HR can view deduction log', status: 403 }

  const employeeCode = query?.employeeCode != null ? String(query.employeeCode).trim() : ''
  const page = Math.max(1, parseInt(query.page, 10) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20))
  const offset = (page - 1) * limit
  const [total, rows] = await Promise.all([
    leaveRepo.countManualDeductions(employeeCode),
    leaveRepo.listManualDeductions(limit, offset, employeeCode)
  ])

  return {
    data: rows.map((r) => ({
      deductionId: r.deduction_id,
      employeeId: r.employee_id,
      employeeCode: r.employee_code,
      employeeName: [r.first_name, r.last_name].filter(Boolean).join(' ').trim() || null,
      leaveType: r.leave_type,
      days: parseInt(r.days_deducted || 0, 10),
      reason: r.reason || '',
      balanceBefore: parseInt(r.balance_before || 0, 10),
      balanceAfter: parseInt(r.balance_after || 0, 10),
      createdAt: r.created_at,
      deductedByEmployeeId: r.deducted_by_employee_id,
      deductedByEmployeeCode: r.deducted_by_employee_code,
      deductedByName: [r.deducted_by_first_name, r.deducted_by_last_name].filter(Boolean).join(' ').trim() || null
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1
  }
}

/** HR can edit a previous manual deduction entry and balances are re-adjusted accordingly. */
export async function hrEditDeduction(deductionId, body) {
  let hid = parseEmployeeId(body?.hrEmployeeId != null ? String(body.hrEmployeeId) : null)
  if (hid == null && body?.hrEmployeeCode != null && String(body.hrEmployeeCode).trim() !== '') {
    hid = await getEmployeeIdByCode(String(body.hrEmployeeCode).trim())
  }
  if (hid == null) return { error: 'Valid hrEmployeeId is required', status: 400 }
  const isHr = await reqRepo.isHrMember(hid)
  if (!isHr) return { error: 'Only HR can edit deduction records', status: 403 }

  const id = parseInt(deductionId, 10)
  if (Number.isNaN(id)) return { error: 'Valid deductionId is required', status: 400 }
  const existing = await leaveRepo.getManualDeductionById(id)
  if (!existing) return { error: 'Deduction record not found', status: 404 }

  const leaveType = String(body?.leaveType || '').trim().toLowerCase()
  if (!['annual', 'casual', 'sick'].includes(leaveType)) {
    return { error: 'leaveType must be one of: annual, casual, sick', status: 400 }
  }
  const days = Math.floor(Number(body?.days) || 0)
  if (days <= 0) return { error: 'days must be a positive integer', status: 400 }
  const reason = body?.reason != null ? String(body.reason).trim() : ''
  if (!reason) return { error: 'reason is required', status: 400 }
  if (reason.length > 1000) return { error: 'reason must be 1000 characters or less', status: 400 }

  const rows = await leaveRepo.updateManualDeduction(id, leaveType, days, reason)
  if (!rows.length) {
    return { error: 'Cannot apply edit: resulting leave balance would be negative', status: 400 }
  }
  const r = rows[0]
  return {
    deductionId: r.deduction_id,
    employeeId: r.employee_id,
    leaveType: r.leave_type,
    days: parseInt(r.days_deducted || 0, 10),
    reason: r.reason || '',
    balanceBefore: parseInt(r.balance_before || 0, 10),
    balanceAfter: parseInt(r.balance_after || 0, 10),
    createdAt: r.created_at,
    balances: {
      annual: parseInt(r.annual_leave || 0, 10),
      casual: parseInt(r.casual_leave || 0, 10),
      sick: parseInt(r.sick_leave || 0, 10)
    }
  }
}

export async function createLeaveRequest(data) {
  const { employeeId, leaveType, startDate, endDate, reason } = data
  if (!isAnnualLeaveRequestType(leaveType)) {
    return {
      error:
        'Only annual leave can be requested in this portal. Casual and sick leave are managed through the Attendance system.',
      status: 400
    }
  }
  const range = validateLeaveDateRange(startDate, endDate)
  if (range.error) return { error: range.error, status: range.status }
  const { days } = range

  const eid = parseEmployeeId(employeeId)
  if (eid != null) {
    const bal = await getLeaveBalance(eid)
    if (days > bal.annual) {
      return {
        error: `Insufficient annual leave balance. You have ${bal.annual} day(s) available; this request needs ${days} calendar day(s).`,
        status: 400
      }
    }
  }

  let initialStatus = 'Pending'
  if (eid != null) {
    const emp = await reqRepo.getEmployeeDept(employeeId)
    if (emp?.department_id != null) {
      const hodId = await reqRepo.getHodByDepartment(emp.department_id)
      if (hodId === eid) initialStatus = 'Pending HR'
    }
    if (initialStatus === 'Pending') {
      const isSenior = await reqRepo.isSeniorExecutiveForLeave(eid)
      if (isSenior) initialStatus = 'Pending HR'
    }
  }
  const result = await leaveRepo.createLeaveRequest(employeeId, leaveType, startDate, endDate, reason, initialStatus)
  const leaveRequestId = result[0].leave_request_id

  if (isEmailConfigured()) {
    const transport = getEmailTransport()
    if (transport) {
      try {
        const to = getLeaveNotificationEmail()
        const subject = `New Leave Request – ${(leaveType && String(leaveType).trim()) || 'Leave'}`
        const body = [
          `Leave Request ID: ${leaveRequestId}`,
          `Employee ID: ${employeeId}`,
          `Leave Type: ${leaveType || '—'}`,
          `Start Date: ${startDate || '—'}`,
          `End Date: ${endDate || '—'}`,
          '',
          'Reason:',
          reason ? String(reason).trim() : '—'
        ].join('\n')
        console.log('📧 [Leave] Sending to:', to, '| Subject:', subject)
        await transport.sendMail({
          from: EMAIL_FROM,
          to,
          subject,
          text: body
        })
        console.log('📧 [Leave] SENT OK →', to)
      } catch (err) {
        console.error('📧 [Leave] FAILED →', to, '| Error:', err.message)
      }
    }
  }

  try {
    const applicantDept = await reqRepo.getEmployeeDept(employeeId)
    const deptId = applicantDept?.department_id
    if (initialStatus === 'Pending HR') {
      const hrIds = await notifRepo.getHrEmployeeIds()
      notifSvc.notifySafe(notifSvc.notifyMany(hrIds, {
        type: 'leave_pending_hr',
        title: 'New leave request',
        body: `Leave request #${leaveRequestId} is pending HR (employee ${employeeId}).`,
        url: '/leave',
        relatedEntityType: 'leave',
        relatedEntityId: leaveRequestId
      }))
    } else if (deptId != null) {
      const hodIds = await notifRepo.getHodEmployeeIdsForDepartment(deptId)
      notifSvc.notifySafe(notifSvc.notifyMany(hodIds, {
        type: 'leave_pending_hod',
        title: 'New leave request',
        body: `Leave request #${leaveRequestId} is pending your approval.`,
        url: '/leave',
        relatedEntityType: 'leave',
        relatedEntityId: leaveRequestId
      }))
    }
  } catch (nErr) {
    console.warn('leave create notification:', nErr.message)
  }

  return {
    message: 'Leave request submitted successfully',
    leaveRequestId
  }
}

/** Update leave request status. HR can approve/reject from Pending or Pending HR. HOD can set Pending -> Pending HR or Rejected. */
export async function updateLeaveStatus(leaveRequestId, body) {
  const { status } = body || {}
  const reqId = parseInt(leaveRequestId, 10)
  if (Number.isNaN(reqId)) return { error: 'Valid leave request ID is required', status: 400 }
  const eid = await resolveApproverEmployeeId(body || {})
  if (eid == null) {
    return { error: 'Valid approvedByEmployeeId or approvedByEmployeeCode is required', status: 400 }
  }

  const normalizedStatus = (status && String(status).trim()) || ''
  const leave = await leaveRepo.getLeaveRequestById(reqId)
  if (!leave) return { error: 'Leave request not found', status: 404 }

  const current = (leave.status || 'Pending').trim()

  if (current === 'Pending') {
    // HR can approve or reject directly without HOD approval
    if (normalizedStatus === 'Approved' || normalizedStatus === 'Rejected') {
      const isHr = await reqRepo.isHrMember(eid)
      if (!isHr) return { error: 'Only HR can approve or reject at this stage', status: 403 }
      if (normalizedStatus === 'Approved') {
        const ar = await approveWithAnnualDeduction(leave, reqId, 'Pending', 'Approved')
        if (ar.error) return ar
      } else {
        const rej = await leaveRepo.updateLeaveRequestStatus(reqId, normalizedStatus, 'Pending')
        if (!rej || rej.length === 0) return { error: 'Could not update status', status: 400 }
      }
      const applicantId = parseInt(leave.employee_id, 10)
      if (!Number.isNaN(applicantId)) {
        notifSvc.notifySafe(notifSvc.notify({
          recipientEmployeeId: applicantId,
          type: normalizedStatus === 'Approved' ? 'leave_approved' : 'leave_rejected',
          title: normalizedStatus === 'Approved' ? 'Leave approved' : 'Leave rejected',
          body: `Your leave request #${reqId} was ${normalizedStatus.toLowerCase()}.`,
          url: '/leave',
          relatedEntityType: 'leave',
          relatedEntityId: reqId
        }))
      }
      return { message: `Leave request ${normalizedStatus.toLowerCase()}`, status: normalizedStatus }
    }
    // HOD can set Pending HR (forward to HR) or Rejected
    if (normalizedStatus !== 'Pending HR' && normalizedStatus !== 'Rejected') {
      return { error: 'HOD can set status to Pending HR (approve for next step) or Rejected', status: 400 }
    }
    const hodId = await reqRepo.getHodByDepartment(leave.department_id)
    if (hodId == null || hodId !== eid) {
      return { error: 'Only HOD of the applicant\'s department can approve or reject', status: 403 }
    }
    const result = await leaveRepo.updateLeaveRequestStatus(reqId, normalizedStatus, 'Pending')
    if (!result || result.length === 0) return { error: 'Could not update status', status: 400 }
    if (normalizedStatus === 'Pending HR' && isEmailConfigured()) {
      const transport = getEmailTransport()
      if (transport) {
        try {
          const to = getLeaveNotificationEmail()
          const subject = `Leave request forwarded to HR – pending your approval (ID: ${reqId})`
          const body = [
            'A leave request has been forwarded by HOD and is now in your HR bucket.',
            '',
            `Leave Request ID: ${reqId}`,
            `Employee ID: ${leave.employee_id}`,
            `Leave Type: ${leave.leave_type || '—'}`,
            `Start Date: ${leave.start_date || '—'}`,
            `End Date: ${leave.end_date || '—'}`,
            '',
            'Reason:',
            (leave.reason && String(leave.reason).trim()) || '—'
          ].join('\n')
          console.log('📧 [Leave] HR notify: Sending to:', to, '| Subject:', subject)
          await transport.sendMail({ from: EMAIL_FROM, to, subject, text: body })
          console.log('📧 [Leave] HR notify SENT OK →', to)
        } catch (err) {
          console.error('📧 [Leave] HR notify FAILED:', err.message)
        }
      }
    }
    if (normalizedStatus === 'Pending HR') {
      notifSvc.notifySafe(notifSvc.notifyMany(await notifRepo.getHrEmployeeIds(), {
        type: 'leave_pending_hr',
        title: 'Leave forwarded to HR',
        body: `Leave #${reqId} was forwarded by HOD for HR review.`,
        url: '/leave',
        relatedEntityType: 'leave',
        relatedEntityId: reqId
      }))
    }
    if (normalizedStatus === 'Rejected') {
      const applicantId = parseInt(leave.employee_id, 10)
      if (!Number.isNaN(applicantId)) {
        notifSvc.notifySafe(notifSvc.notify({
          recipientEmployeeId: applicantId,
          type: 'leave_rejected',
          title: 'Leave rejected',
          body: `Your leave request #${reqId} was rejected by HOD.`,
          url: '/leave',
          relatedEntityType: 'leave',
          relatedEntityId: reqId
        }))
      }
    }
    return { message: normalizedStatus === 'Rejected' ? 'Leave request rejected' : 'Leave forwarded to HR', status: normalizedStatus }
  }

  if (current === 'Pending HR') {
    if (normalizedStatus !== 'Approved' && normalizedStatus !== 'Rejected') {
      return { error: 'HR can set status to Approved or Rejected', status: 400 }
    }
    const isHr = await reqRepo.isHrMember(eid)
    if (!isHr) return { error: 'Only HR can approve or reject at this stage', status: 403 }
    let result
    if (normalizedStatus === 'Approved') {
      const ar = await approveWithAnnualDeduction(leave, reqId, 'Pending HR', 'Approved')
      if (ar.error) return ar
      result = [{ leave_request_id: reqId }]
    } else {
      result = await leaveRepo.updateLeaveRequestStatus(reqId, normalizedStatus, 'Pending HR')
      if (!result || result.length === 0) return { error: 'Could not update status', status: 400 }
    }
    const applicantIdHr = parseInt(leave.employee_id, 10)
    if (!Number.isNaN(applicantIdHr)) {
      notifSvc.notifySafe(notifSvc.notify({
        recipientEmployeeId: applicantIdHr,
        type: normalizedStatus === 'Approved' ? 'leave_approved' : 'leave_rejected',
        title: normalizedStatus === 'Approved' ? 'Leave approved' : 'Leave rejected',
        body: `Your leave request #${reqId} was ${normalizedStatus.toLowerCase()} by HR.`,
        url: '/leave',
        relatedEntityType: 'leave',
        relatedEntityId: reqId
      }))
    }
    return { message: `Leave request ${normalizedStatus.toLowerCase()}`, status: normalizedStatus }
  }

  return { error: 'Leave request is not pending approval', status: 400 }
}

/** HR list: all leave requests across all departments with status. Pagination: page (default 1), limit (default 20, max 100). */
export async function getHrList(employeeId, query = {}) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return { error: 'Valid employee ID is required', status: 400 }
  const isHr = await reqRepo.isHrMember(eid)
  if (!isHr) return { error: 'Only HR can view this list', status: 403 }

  const page = Math.max(1, parseInt(query.page, 10) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20))
  const offset = (page - 1) * limit

  const [total, rows] = await Promise.all([
    leaveRepo.countAllLeavesForHr(),
    leaveRepo.getAllLeavesForHr(limit, offset)
  ])

  const data = rows.map(r => ({
    id: r.leave_request_id,
    reference: formatLeaveReference(r.leave_request_id, r.created_at),
    employeeId: r.employee_id,
    type: r.leave_type || 'Annual Leave',
    startDate: r.start_date,
    endDate: r.end_date,
    days: parseInt(r.days || 0),
    status: r.status || 'Pending',
    reason: r.reason || '',
    date: r.created_at,
    firstName: r.first_name,
    lastName: r.last_name,
    email: r.email,
    departmentName: r.department_name
  }))

  return {
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1
  }
}

/** HR pending: leave requests with status Pending HR (awaiting HR approval). */
export async function getPendingHr(employeeId) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return { error: 'Valid employee ID is required', status: 400 }
  const isHr = await reqRepo.isHrMember(eid)
  if (!isHr) return { error: 'Only HR can view pending list', status: 403 }

  const rows = await leaveRepo.getPendingHrLeaves()
  return rows.map(r => ({
    id: r.leave_request_id,
    reference: formatLeaveReference(r.leave_request_id, r.created_at),
    employeeId: r.employee_id,
    type: r.leave_type || 'Annual Leave',
    startDate: r.start_date,
    endDate: r.end_date,
    days: parseInt(r.days || 0),
    status: r.status || 'Pending HR',
    reason: r.reason || '',
    date: r.created_at,
    firstName: r.first_name,
    lastName: r.last_name,
    email: r.email,
    departmentName: r.department_name
  }))
}

/** Pending leave requests for HOD's department (same logic as pending requisition for HOD). */
export async function getPendingHod(employeeId) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return { error: 'Valid employee ID is required', status: 400 }
  const emp = await reqRepo.getEmployeeDept(employeeId)
  if (!emp) return { error: 'Employee not found', status: 404 }
  const deptId = emp.department_id
  const deptName = (emp.department_name || '').trim().toLowerCase()
  if (deptId == null && !deptName) return []
  const hodId = await reqRepo.getHodByDepartment(deptId)
  if (hodId == null || hodId !== eid) return []

  const rows = await leaveRepo.getPendingHodLeaves(deptId, deptName, eid)
  return rows.map(r => ({
    id: r.leave_request_id,
    reference: formatLeaveReference(r.leave_request_id, r.created_at),
    employeeId: r.employee_id,
    type: r.leave_type || 'Annual Leave',
    startDate: r.start_date,
    endDate: r.end_date,
    days: parseInt(r.days || 0),
    status: r.status || 'Pending',
    reason: r.reason || '',
    date: r.created_at,
    firstName: r.first_name,
    lastName: r.last_name,
    email: r.email,
    departmentName: r.department_name
  }))
}
