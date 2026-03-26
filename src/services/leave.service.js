import * as leaveRepo from '../repositories/leave.repository.js'
import * as reqRepo from '../repositories/requisition.repository.js'
import * as notifRepo from '../repositories/notification.repository.js'
import * as notifSvc from './notification.service.js'
import { EMAIL_FROM, getEmailTransport, isEmailConfigured } from '../../config/email.js'

const defaultBalance = { annual: 15, sick: 10, personal: 5 }

const LEAVE_EMAIL_SICK_CASUAL = process.env.LEAVE_EMAIL_SICK_CASUAL || 'anas.ahmed@itecknologi.com'
const LEAVE_EMAIL_ANNUAL = process.env.LEAVE_EMAIL_ANNUAL || 'hr@itecknologi.com'

function getLeaveNotificationEmail(leaveType) {
  const t = (leaveType && String(leaveType).trim().toLowerCase()) || ''
  if (t.includes('sick') || t.includes('casual')) return LEAVE_EMAIL_SICK_CASUAL
  return LEAVE_EMAIL_ANNUAL
}

function parseEmployeeId(employeeId) {
  if (employeeId == null || employeeId === '') return null
  const n = parseInt(employeeId, 10)
  return Number.isNaN(n) ? null : n
}

export async function getLeaveBalance(employeeId) {
  const result = await leaveRepo.getLeaveBalance(employeeId)
  if (result.length === 0) return defaultBalance
  const b = result[0]
  return {
    annual: parseInt(b.annual_leave || 0),
    sick: parseInt(b.sick_leave || 0),
    personal: parseInt(b.personal_leave || 0)
  }
}

export async function getLeaveRequests(employeeId) {
  const result = await leaveRepo.getLeaveRequests(employeeId)
  return result.map(r => ({
    id: r.leave_request_id,
    type: r.leave_type || 'Annual Leave',
    startDate: r.start_date,
    endDate: r.end_date,
    days: parseInt(r.days || 0),
    status: r.status || 'Pending',
    reason: r.reason || '',
    date: r.created_at
  }))
}

export async function createLeaveRequest(data) {
  const { employeeId, leaveType, startDate, endDate, reason } = data
  const eid = parseEmployeeId(employeeId)
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
        const to = getLeaveNotificationEmail(leaveType)
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
  const { status, approvedByEmployeeId } = body || {}
  const reqId = parseInt(leaveRequestId, 10)
  if (Number.isNaN(reqId)) return { error: 'Valid leave request ID is required', status: 400 }
  const eid = parseEmployeeId(approvedByEmployeeId != null ? String(approvedByEmployeeId) : null)
  if (eid == null) return { error: 'Valid approvedByEmployeeId is required', status: 400 }

  const normalizedStatus = (status && String(status).trim()) || ''
  const leave = await leaveRepo.getLeaveRequestById(reqId)
  if (!leave) return { error: 'Leave request not found', status: 404 }

  const current = (leave.status || 'Pending').trim()

  if (current === 'Pending') {
    // HR can approve or reject directly without HOD approval
    if (normalizedStatus === 'Approved' || normalizedStatus === 'Rejected') {
      const isHr = await reqRepo.isHrMember(eid)
      if (!isHr) return { error: 'Only HR can approve or reject at this stage', status: 403 }
      const result = await leaveRepo.updateLeaveRequestStatus(reqId, normalizedStatus, 'Pending')
      if (!result || result.length === 0) return { error: 'Could not update status', status: 400 }
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
          const to = getLeaveNotificationEmail(leave.leave_type)
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
    const result = await leaveRepo.updateLeaveRequestStatus(reqId, normalizedStatus, 'Pending HR')
    if (!result || result.length === 0) return { error: 'Could not update status', status: 400 }
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
