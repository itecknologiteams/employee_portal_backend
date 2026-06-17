import * as leaveRepo from '../repositories/leave.repository.js'
import * as reqRepo from '../repositories/requisition.repository.js'
import * as notifRepo from '../repositories/notification.repository.js'
import * as notifSvc from './notification.service.js'
import { getEmployeeIdByCode, findEmployeeByEmployeeId } from '../repositories/auth.repository.js'
import { EMAIL_FROM, HR_EMAIL, getEmailTransport, isEmailConfigured } from '../../config/email.js'
import { renderLeaveEmail } from '../utils/leaveEmailTemplate.js'
import { decideAnnualAllocation } from '../utils/annualLeave.js'

/** External ICS Attendance System API Base URL */
const ICS_API_BASE_URL = process.env.ICS_API_BASE_URL || 'https://webtrack.itecknologi.com/InternalCommunicationSystem'

/** Leave type ids that stay with HR even for an HOD applicant: Casual (1), Sick (2). */
export const CASUAL_SICK_TYPE_IDS = new Set([1, 2])

/**
 * Pure routing decision for a newly created leave request.
 * - Senior executives (CEO/COO/Director) → HR (checked first so a CEO never routes to themselves).
 * - HOD applying for own leave → Casual/Sick stay with HR, everything else goes to CEO.
 * - Everyone else → HOD approval (Pending).
 * @param {{ isSenior: boolean, isHod: boolean, leaveTypeId: number|string }} facts
 * @returns {'Pending' | 'Pending HR' | 'Pending CEO'}
 */
export function decideInitialLeaveStatus({ isSenior, isHod, leaveTypeId }) {
  if (isSenior) return 'Pending HR'
  if (isHod) {
    return CASUAL_SICK_TYPE_IDS.has(Number(leaveTypeId)) ? 'Pending HR' : 'Pending CEO'
  }
  return 'Pending'
}

/**
 * Resolve the initial status for a leave request by gathering the routing facts from the
 * repositories, then applying the pure {@link decideInitialLeaveStatus} rule.
 * @param {number|string} employeeId
 * @param {number|string} leaveTypeId
 * @returns {Promise<'Pending' | 'Pending HR' | 'Pending CEO'>}
 */
export async function resolveInitialLeaveStatus(employeeId, leaveTypeId) {
  const eid = Number(employeeId)
  const isSenior = await reqRepo.isSeniorExecutiveForLeave(eid)
  let isHod = false
  if (!isSenior) {
    const emp = await reqRepo.getEmployeeDept(employeeId)
    if (emp?.department_id != null) {
      const hodId = await reqRepo.getHodByDepartment(emp.department_id)
      isHod = hodId != null && Number(hodId) === eid
    }
  }
  return decideInitialLeaveStatus({ isSenior, isHod, leaveTypeId })
}

/** findEmployeeByEmployeeId returns an array of rows; this returns the single row (or null). */
async function getEmployeeRow(employeeId) {
  const rows = await findEmployeeByEmployeeId(employeeId)
  return Array.isArray(rows) ? (rows[0] || null) : (rows || null)
}

/** Format a date for leave emails (e.g. "3 Jun 2026"); null/invalid → null. */
function fmtLeaveDate(d) {
  if (!d) return null
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return null
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Send a templated leave email. Never throws (logs and swallows). No-op if SMTP unconfigured or no recipient. */
async function sendLeaveEmailSafe(to, subject, templateOpts) {
  if (!to || !isEmailConfigured()) return
  const transport = getEmailTransport()
  if (!transport) return
  const { html, text } = renderLeaveEmail(templateOpts)
  try {
    await transport.sendMail({ from: EMAIL_FROM, to, subject, html, text })
  } catch (err) {
    console.error('[Leave] email FAILED:', err.message)
  }
}

/** Human "N days" label, or null. */
function daysLabel(days) {
  if (days == null) return null
  return `${days} ${Number(days) === 1 ? 'day' : 'days'}`
}

/**
 * Email the applicant that their leave was approved/rejected.
 * @param {object} leave  Row from getLeaveRequestById (has leave_type, start/end_date, days, reason, created_at).
 * @param {number} reqId
 * @param {'Approved'|'Rejected'} decision
 * @param {string} byRole e.g. 'CEO', 'HR', 'HOD' — who took the action.
 */
async function emailApplicantLeaveDecision(leave, reqId, decision, byRole) {
  const emp = await getEmployeeRow(leave.employee_id)
  const to = emp?.email
  if (!to) return
  const approved = decision === 'Approved'
  const name = emp ? `${emp.first_name || ''} ${emp.last_name || ''}`.trim() : ''
  const reference = formatLeaveReference(reqId, leave.created_at)
  await sendLeaveEmailSafe(
    to,
    `Leave Request ${approved ? 'Approved' : 'Rejected'} — ${reference}`,
    {
      title: `Leave Request ${approved ? 'Approved' : 'Rejected'}`,
      accent: approved ? 'green' : 'red',
      greeting: name ? `Dear ${name},` : 'Dear Applicant,',
      introLines: [`Your leave request has been ${approved ? 'approved' : 'rejected'} by the ${byRole}.`],
      details: [
        { label: 'Reference', value: reference },
        { label: 'Employee Code', value: emp?.employee_code || null },
        { label: 'Type', value: leave.leave_type },
        { label: 'Start Date', value: fmtLeaveDate(leave.start_date) },
        { label: 'End Date', value: fmtLeaveDate(leave.end_date) },
        { label: 'Days', value: daysLabel(leave.days) },
        { label: 'Status', value: decision }
      ],
      reason: leave.reason || null
    }
  )
}

/**
 * Call external ICS Attendance System API to sync leave status.
 * This is used when HOD approves/rejects a leave request.
 * @param {Object} params - Leave sync parameters
 * @param {string} params.employeeCode - Employee code
 * @param {number} params.leaveId - Leave request ID from portal
 * @param {string} params.status - 'Approved' or 'Rejected'
 * @param {string} params.leaveType - Leave type (Casual, Sick, etc.)
 * @param {string} params.startDate - Start date (YYYY-MM-DD)
 * @param {string} params.endDate - End date (YYYY-MM-DD)
 * @returns {Promise<Object>} External API response
 */
async function syncLeaveStatusToICS(params) {
  const { employeeCode, leaveId, status, leaveType, startDate, endDate } = params

  try {
    const response = await fetch(`${ICS_API_BASE_URL}/leaves/update-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        emp_code: employeeCode,
        portal_leave_id: leaveId,
        status: status.toLowerCase(), // 'approved' or 'rejected'
        leave_type: leaveType,
        start_date: startDate,
        end_date: endDate,
        source: 'portal',
        synced_at: new Date().toISOString()
      }),
      timeout: 10000
    })

    if (!response.ok) {
      console.error(`ICS API Error: ${response.status} - ${response.statusText}`)
      return { success: false, error: `External API returned ${response.status}` }
    }

    const data = await response.json()
    console.log(`✅ Leave ${leaveId} status synced to ICS:`, data)
    return { success: true, data }
  } catch (error) {
    console.error('❌ Failed to sync leave status to ICS:', error.message)
    // Return failure but don't throw - we don't want to block the portal flow
    return { success: false, error: error.message }
  }
}

const defaultBalance = {
  annual: 14,
  casual: 10,
  sick: 6,
  carried: 0,
  marriage: 10,
  maternity: 90,
  paternal: 7,
  pilgrimage: 20
}

/** Calculate prorated annual leave for an employee based on join date.
 * Formula: 14(AL)/12 * Remaining Months in completion of year
 * After completing 1 year, employee gets full 14 days
 */
export async function calculateEmployeeAnnualLeave(employeeId) {
  const joinDate = await leaveRepo.getEmployeeJoinDate(employeeId)
  const prorated = leaveRepo.calculateProratedAnnualLeave(joinDate)

  return {
    employeeId,
    joinDate,
    calculatedAnnualLeave: prorated,
    fullAnnualLeave: defaultBalance.annual,
    isProrated: prorated < defaultBalance.annual,
    note: prorated < defaultBalance.annual
      ? `Prorated annual leave: ${prorated} days (Formula: 14/12 * remaining months in completion of year)`
      : `Full annual leave: ${prorated} days (Employee has completed 1 year)`
  }
}

/** Calculate prorated annual leave by employee code. */
export async function calculateEmployeeAnnualLeaveByCode(employeeCode) {
  const code = String(employeeCode || '').trim()
  if (!code) return { error: 'Employee code is required', status: 400 }

  const joinDate = await leaveRepo.getEmployeeJoinDateByCode(code)
  if (!joinDate) {
    return {
      employeeCode: code,
      joinDate: null,
      calculatedAnnualLeave: defaultBalance.annual,
      fullAnnualLeave: defaultBalance.annual,
      isProrated: false,
      note: 'No join date found. Using default annual leave.'
    }
  }

  const prorated = leaveRepo.calculateProratedAnnualLeave(joinDate)

  return {
    employeeCode: code,
    joinDate,
    calculatedAnnualLeave: prorated,
    fullAnnualLeave: defaultBalance.annual,
    isProrated: prorated < defaultBalance.annual,
    note: prorated < defaultBalance.annual
      ? `Prorated annual leave: ${prorated} days (Formula: 14/12 * remaining months in completion of year)`
      : `Full annual leave: ${prorated} days (Employee has completed 1 year)`
  }
}

/** Rollover annual leave for an employee (2+ years): Move remaining annual to carried_forward and reset annual.
 * HR can use this to process annual leave rollover for eligible employees.
 */
export async function rolloverAnnualLeaveForEmployee(hrEmployeeId, employeeCode) {
  const hid = parseEmployeeId(hrEmployeeId != null ? String(hrEmployeeId) : null)
  if (hid == null) return { error: 'Valid hrEmployeeId is required', status: 400 }
  const isHr = await reqRepo.isHrMember(hid)
  if (!isHr) return { error: 'Only HR can perform annual leave rollover', status: 403 }

  const code = String(employeeCode || '').trim()
  if (!code) return { error: 'Employee code is required', status: 400 }

  try {
    const result = await leaveRepo.rolloverAnnualLeaveByCode(code)

    if (!result.eligible) {
      return {
        success: false,
        employeeCode: code,
        eligible: false,
        reason: result.reason,
        yearsOfService: result.yearsOfService,
        status: 200
      }
    }

    return {
      success: true,
      employeeCode: code,
      eligible: true,
      yearsOfService: result.yearsOfService,
      previousAnnual: result.previousAnnual,
      previousCarried: result.previousCarried,
      rolledOverAmount: result.rolledOverAmount,
      newAnnualLeave: result.newAnnualLeave,
      newCarriedForward: result.newCarriedForward,
      rolloverDate: result.rolloverDate,
      message: `Annual leave rolled over successfully. ${result.rolledOverAmount} days moved to carried forward. New annual quota: ${result.newAnnualLeave} days.`
    }
  } catch (err) {
    return { error: err?.message || 'Failed to rollover annual leave', status: 400 }
  }
}

/** Bulk rollover for all eligible employees (2+ years).
 * HR can use this at year-end to process all eligible employees at once.
 */
export async function bulkRolloverAnnualLeaves(hrEmployeeId) {
  const hid = parseEmployeeId(hrEmployeeId != null ? String(hrEmployeeId) : null)
  if (hid == null) return { error: 'Valid hrEmployeeId is required', status: 400 }
  const isHr = await reqRepo.isHrMember(hid)
  if (!isHr) return { error: 'Only HR can perform bulk annual leave rollover', status: 403 }

  try {
    const results = await leaveRepo.bulkRolloverAnnualLeaves()

    return {
      success: true,
      processed: results.processed,
      skipped: results.skipped,
      total: results.processed + results.skipped,
      details: results.details,
      message: `Bulk rollover completed. ${results.processed} employees processed, ${results.skipped} skipped.`
    }
  } catch (err) {
    return { error: err?.message || 'Failed to perform bulk rollover', status: 500 }
  }
}

/** Check rollover eligibility for an employee. */
export async function checkRolloverEligibility(employeeCode) {
  const code = String(employeeCode || '').trim()
  if (!code) return { error: 'Employee code is required', status: 400 }

  try {
    const joinDate = await leaveRepo.getEmployeeJoinDateByCode(code)
    if (!joinDate) {
      return {
        employeeCode: code,
        eligible: false,
        reason: 'No join date found for employee'
      }
    }

    const yearsOfService = leaveRepo.getYearsOfService(joinDate)
    const eligible = leaveRepo.hasCompletedTwoYears(joinDate)

    // Get current balance
    const balance = await leaveRepo.getLeaveBalanceByEmployeeCode(code)
    const currentAnnual = balance.length > 0 ? parseInt(balance[0].annual_leave || 0, 10) : 0
    const currentCarried = balance.length > 0 ? parseInt(balance[0].carried_forward || 0, 10) : 0

    return {
      employeeCode: code,
      eligible,
      yearsOfService,
      joinDate,
      currentAnnual,
      currentCarried,
      projectedCarried: eligible ? currentAnnual + currentCarried : currentCarried,
      newAnnualQuota: eligible ? defaultBalance.annual : null,
      message: eligible
        ? `Employee is eligible for rollover. ${currentAnnual} days will be added to carried forward, and annual leave will reset to ${defaultBalance.annual} days.`
        : `Employee not eligible yet. Needs ${2 - yearsOfService} more year(s) to complete 2 years.`
    }
  } catch (err) {
    return { error: err?.message || 'Failed to check eligibility', status: 400 }
  }
}

/** All leave types that can be requested through the portal. */
const PORTAL_REQUESTABLE_LEAVE_TYPES = [
  'Annual Leave',
  'Marriage Leave',
  'Maternity Leave',
  'Paternal Leave',
  'Paternity Leave',
  'Pilgrimage Leave'
]

/** Check if leave type is requestable through the portal. */
function isPortalRequestableLeaveType(leaveType) {
  const t = String(leaveType || '').trim().toLowerCase()
  return PORTAL_REQUESTABLE_LEAVE_TYPES.some(
    type => t === type.toLowerCase() || t.includes(type.toLowerCase().replace(' leave', ''))
  )
}

/** Get the normalized leave type name. */
function getNormalizedLeaveType(leaveType) {
  const t = String(leaveType || '').trim().toLowerCase()
  if (t.includes('annual')) return 'Annual Leave'
  if (t.includes('marriage')) return 'Marriage Leave'
  if (t.includes('maternity')) return 'Maternity Leave'
  if (t.includes('paternal') || t.includes('paternity')) return 'Paternal Leave'
  if (t.includes('pilgrimage')) return 'Pilgrimage Leave'
  if (t.includes('casual')) return 'Casual Leave'
  if (t.includes('sick')) return 'Sick Leave'
  return leaveType
}

/** Get the balance key for a leave type. */
function getLeaveBalanceKey(leaveType) {
  const t = String(leaveType || '').trim().toLowerCase()
  if (t.includes('annual')) return 'annual'
  if (t.includes('marriage')) return 'marriage'
  if (t.includes('maternity')) return 'maternity'
  if (t.includes('paternal') || t.includes('paternity')) return 'paternal'
  if (t.includes('pilgrimage')) return 'pilgrimage'
  if (t.includes('casual')) return 'casual'
  if (t.includes('sick')) return 'sick'
  return null
}

const LEAVE_EMAIL_SICK_CASUAL = process.env.LEAVE_EMAIL_SICK_CASUAL || 'anas.ahmed@itecknologi.com'
const LEAVE_EMAIL_ANNUAL = process.env.LEAVE_EMAIL_ANNUAL || 'hr@itecknologi.com'

function getLeaveNotificationEmail() {
  return LEAVE_EMAIL_ANNUAL
}

function isAnnualLeaveRequestType(leaveType) {
  const t = (leaveType && String(leaveType).trim().toLowerCase()) || ''
  return t.includes('annual')
}

/** Check if leave type is a portal-managed leave type (supports requests/deductions). */
function isPortalManagedLeaveType(leaveType) {
  const t = (leaveType && String(leaveType).trim().toLowerCase()) || ''
  return t.includes('annual') ||
         t.includes('marriage') ||
         t.includes('maternity') ||
         t.includes('paternal') ||
         t.includes('paternity') ||
         t.includes('pilgrimage')
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
 * On Approved: deduct leave days first, then update status; refund if status update fails.
 * Supports all portal-managed leave types: annual, marriage, maternity, paternal, pilgrimage.
 */
async function approveWithLeaveDeduction(leave, reqId, requiredCurrent, newStatus) {
  const eid = parseInt(leave.employee_id, 10)
  let toRefund = 0
  let deductedType = null
  if (newStatus === 'Approved' && isPortalManagedLeaveType(leave.leave_type)) {
    const already = Number(leave.annual_days_deducted) || 0
    if (already === 0) {
      const days = leaveRequestCalendarDays(leave)
      if (days > 0) {
        if (Number.isNaN(eid)) return { error: 'Invalid employee on leave request', status: 400 }
        const rows = await leaveRepo.deductLeave(eid, leave.leave_type, days)
        if (!rows.length) {
          const leaveName = getNormalizedLeaveType(leave.leave_type)
          return { error: `Insufficient ${leaveName} balance`, status: 400 }
        }
        toRefund = days
        deductedType = getLeaveBalanceKey(leave.leave_type)
      }
    }
  }
  const result = await leaveRepo.updateLeaveRequestStatus(reqId, newStatus, requiredCurrent)
  if (!result || result.length === 0) {
    if (toRefund > 0 && deductedType) {
      await leaveRepo.refundLeave(eid, deductedType, toRefund)
    }
    return { error: 'Could not update status', status: 400 }
  }
  if (toRefund > 0) await leaveRepo.setAnnualDaysDeducted(reqId, toRefund)
  return { ok: true }
}

// Keep for backward compatibility - delegates to new function
async function approveWithAnnualDeduction(leave, reqId, requiredCurrent, newStatus) {
  return approveWithLeaveDeduction(leave, reqId, requiredCurrent, newStatus)
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
    employeeCode: b.employee_code || null,
    annual: parseInt(b.annual_leave || 0, 10),
    casual: parseInt(b.casual_leave ?? 0, 10),
    sick: parseInt(b.sick_leave || 0, 10),
    carried: parseInt(b.carried_forward ?? 0, 10),
    marriage: parseInt(b.marriage_leave ?? defaultBalance.marriage, 10),
    maternity: parseInt(b.maternity_leave ?? defaultBalance.maternity, 10),
    paternal: parseInt(b.paternal_leave ?? defaultBalance.paternal, 10),
    pilgrimage: parseInt(b.pilgrimage_leave ?? defaultBalance.pilgrimage, 10)
  }
}

/** Get leave balance by employee code - returns data with employee_code field. */
export async function getLeaveBalanceByCode(employeeCode) {
  const result = await leaveRepo.getLeaveBalanceByEmployeeCode(employeeCode)
  if (result.length === 0) {
    // Return default balance with employee code
    return {
      employeeCode: employeeCode,
      annual: defaultBalance.annual,
      casual: defaultBalance.casual,
      sick: defaultBalance.sick,
      carried: 0,
      marriage: defaultBalance.marriage,
      maternity: defaultBalance.maternity,
      paternal: defaultBalance.paternal,
      pilgrimage: defaultBalance.pilgrimage
    }
  }
  const b = result[0]
  return {
    employeeCode: b.employee_code,
    annual: parseInt(b.annual_leave || 0, 10),
    casual: parseInt(b.casual_leave ?? 0, 10),
    sick: parseInt(b.sick_leave || 0, 10),
    carried: parseInt(b.carried_forward ?? 0, 10),
    marriage: parseInt(b.marriage_leave ?? defaultBalance.marriage, 10),
    maternity: parseInt(b.maternity_leave ?? defaultBalance.maternity, 10),
    paternal: parseInt(b.paternal_leave ?? defaultBalance.paternal, 10),
    pilgrimage: parseInt(b.pilgrimage_leave ?? defaultBalance.pilgrimage, 10),
    updatedAt: b.updated_at
  }
}

/** HR only: Get all leave balances with employee_code for all employees. */
export async function getAllLeaveBalances(hrEmployeeId, limit = 100, offset = 0) {
  const hid = parseEmployeeId(hrEmployeeId != null ? String(hrEmployeeId) : null)
  if (hid == null) return { error: 'Valid hrEmployeeId is required', status: 400 }
  const isHr = await reqRepo.isHrMember(hid)
  if (!isHr) return { error: 'Only HR can view all leave balances', status: 403 }

  const rows = await leaveRepo.getAllLeaveBalances(limit, offset)
  return {
    balances: rows.map(b => ({
      employeeCode: b.employee_code,
      annual: parseInt(b.annual_leave || 0, 10),
      casual: parseInt(b.casual_leave ?? 0, 10),
      sick: parseInt(b.sick_leave || 0, 10),
      carried: parseInt(b.carried_forward ?? 0, 10),
      marriage: parseInt(b.marriage_leave ?? defaultBalance.marriage, 10),
      maternity: parseInt(b.maternity_leave ?? defaultBalance.maternity, 10),
      paternal: parseInt(b.paternal_leave ?? defaultBalance.paternal, 10),
      pilgrimage: parseInt(b.pilgrimage_leave ?? defaultBalance.pilgrimage, 10),
      updatedAt: b.updated_at
    })),
    limit,
    offset
  }
}

/** HR only: replace employee leave quotas (annual, casual, sick, marriage, maternity, paternal, pilgrimage days). */
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
  const marriage = Math.max(0, Math.floor(Number(body?.marriage) || defaultBalance.marriage))
  const maternity = Math.max(0, Math.floor(Number(body?.maternity) || defaultBalance.maternity))
  const paternal = Math.max(0, Math.floor(Number(body?.paternal) || defaultBalance.paternal))
  const pilgrimage = Math.max(0, Math.floor(Number(body?.pilgrimage) || defaultBalance.pilgrimage))

  if (![annual, casual, sick, marriage, maternity, paternal, pilgrimage].every((n) => Number.isFinite(n))) {
    return { error: 'All leave quota values must be non-negative numbers', status: 400 }
  }

  const carried = Math.max(0, Math.floor(Number(body?.carried) || 0))

  const rows = await leaveRepo.setAllLeaveBalanceTotals(tid, {
    annual, casual, sick, carried, marriage, maternity, paternal, pilgrimage
  })
  if (!rows.length) return { error: 'Could not update leave balance', status: 400 }
  const b = rows[0]
  return {
    employeeCode: code,
    annual: parseInt(b.annual_leave || 0, 10),
    casual: parseInt(b.casual_leave ?? 0, 10),
    sick: parseInt(b.sick_leave || 0, 10),
    carried: parseInt(b.carried_forward ?? 0, 10),
    marriage: parseInt(b.marriage_leave ?? defaultBalance.marriage, 10),
    maternity: parseInt(b.maternity_leave ?? defaultBalance.maternity, 10),
    paternal: parseInt(b.paternal_leave ?? defaultBalance.paternal, 10),
    pilgrimage: parseInt(b.pilgrimage_leave ?? defaultBalance.pilgrimage, 10)
  }
}

/** HR only: Bulk import leave quotas from CSV by employee_code.
 * Gender-based assignment:
 * - Female employees: maternity_leave only (paternal_leave = 0)
 * - Male employees: paternal_leave only (maternity_leave = 0)
 */
export async function hrBulkImportLeaveBalances(hrEmployeeId, importRows) {
  const hid = parseEmployeeId(hrEmployeeId != null ? String(hrEmployeeId) : null)
  if (hid == null) return { error: 'Valid hrEmployeeId is required', status: 400 }
  const isHr = await reqRepo.isHrMember(hid)
  if (!isHr) return { error: 'Only HR can import leave quotas', status: 403 }

  if (!Array.isArray(importRows) || importRows.length === 0) {
    return { error: 'No data to import. Expected array of rows with employeeCode and leave balances.', status: 400 }
  }

  const results = []
  const errors = []

  for (const row of importRows) {
    const code = String(row?.employeeCode || '').trim()
    if (!code) {
      errors.push({ row, error: 'Employee code is required' })
      continue
    }

    // Get employee gender for gender-based leave assignment
    const genderRows = await leaveRepo.getEmployeeGenderByCode(code)
    const gender = genderRows || ''
    const isFemale = gender === 'female'
    const isMale = gender === 'male'

    const annual = Math.max(0, Math.floor(Number(row?.annual)))
    const casual = Math.max(0, Math.floor(Number(row?.casual)))
    const sick = Math.max(0, Math.floor(Number(row?.sick)))
    const carried = Math.max(0, Math.floor(Number(row?.carried) || 0))
    const marriage = Math.max(0, Math.floor(Number(row?.marriage) || defaultBalance.marriage))

    // Handle gender-based maternity/paternal leave assignment
    // If CSV has explicit value, use it; otherwise use gender-based default
    let maternity, paternal
    if (row?.maternity !== undefined && row?.maternity !== '' && row?.maternity !== null) {
      maternity = Math.max(0, Math.floor(Number(row.maternity)))
    } else {
      maternity = isFemale ? defaultBalance.maternity : 0
    }

    if (row?.paternal !== undefined && row?.paternal !== '' && row?.paternal !== null) {
      paternal = Math.max(0, Math.floor(Number(row.paternal)))
    } else {
      paternal = isMale ? defaultBalance.paternal : 0
    }

    const pilgrimage = Math.max(0, Math.floor(Number(row?.pilgrimage) || defaultBalance.pilgrimage))

    try {
      const rows = await leaveRepo.upsertLeaveBalanceByEmployeeCode(code, {
        annual, casual, sick, carried, marriage, maternity, paternal, pilgrimage
      })
      if (rows.length === 0) {
        errors.push({ employeeCode: code, error: 'Employee not found' })
      } else {
        const b = rows[0]
        results.push({
          employeeCode: b.employee_code,
          gender: gender || 'unknown',
          annual: parseInt(b.annual_leave || 0, 10),
          casual: parseInt(b.casual_leave ?? 0, 10),
          sick: parseInt(b.sick_leave || 0, 10),
          carried: parseInt(b.carried_forward ?? 0, 10),
          marriage: parseInt(b.marriage_leave ?? defaultBalance.marriage, 10),
          maternity: parseInt(b.maternity_leave ?? 0, 10),
          paternal: parseInt(b.paternal_leave ?? 0, 10),
          pilgrimage: parseInt(b.pilgrimage_leave ?? defaultBalance.pilgrimage, 10),
          genderBasedAssignment: isFemale
            ? 'Female: Maternity leave assigned'
            : isMale
              ? 'Male: Paternal leave assigned'
              : 'Unknown gender: No special leave assigned'
        })
      }
    } catch (err) {
      errors.push({ employeeCode: code, error: err?.message || 'Failed to update' })
    }
  }

  return {
    imported: results.length,
    failed: errors.length,
    results,
    errors
  }
}

/** HR only: Allocate default leave quotas to ALL active employees at once.
 * This is useful for initial setup or yearly refresh.
 * - Annual leave is prorated based on join date (for < 1 year) or full 14 days (for 1+ year)
 * - Gender-based assignment: Female get maternity (90), Male get paternal (7)
 * - Existing carried_forward is preserved
 * - NOTE: Casual and Sick leaves come from external Attendance System API, not allocated here
 */
export async function allocateAllEmployeesLeaveQuota(hrEmployeeId) {
  const hid = parseEmployeeId(hrEmployeeId != null ? String(hrEmployeeId) : null)
  if (hid == null) return { error: 'Valid hrEmployeeId is required', status: 400 }
  const isHr = await reqRepo.isHrMember(hid)
  if (!isHr) return { error: 'Only HR can allocate leave quotas', status: 403 }

  // Get all active employees
  const employees = await leaveRepo.getAllActiveEmployeesForAllocation()

  if (!Array.isArray(employees) || employees.length === 0) {
    return { error: 'No active employees found', status: 404 }
  }

  const results = []
  const errors = []
  let processed = 0
  let skipped = 0

  for (const emp of employees) {
    try {
      const isFemale = emp.gender === 'female'
      const isMale = emp.gender === 'male'

      // Calculate prorated annual leave based on join date
      const proratedAnnual = leaveRepo.calculateProratedAnnualLeave(emp.join_date)

      // Preserve existing carried_forward, casual, sick (from external API)
      const carried = parseInt(emp.current_carried || 0, 10)
      // Casual and Sick come from external Attendance System - preserve existing values
      const casual = parseInt(emp.current_casual || 0, 10)
      const sick = parseInt(emp.current_sick || 0, 10)

      const data = {
        employeeCode: emp.employee_code,
        annual: proratedAnnual,
        casual, // Preserved from external API
        sick,   // Preserved from external API
        marriage: defaultBalance.marriage,
        maternity: isFemale ? defaultBalance.maternity : 0,
        paternal: isMale ? defaultBalance.paternal : 0,
        pilgrimage: defaultBalance.pilgrimage
      }

      const rows = await leaveRepo.upsertLeaveBalanceByEmployeeCode(emp.employee_code, data)

      if (rows.length === 0) {
        errors.push({ employeeCode: emp.employee_code, error: 'Failed to update' })
        skipped++
      } else {
        const b = rows[0]
        processed++
        results.push({
          employeeCode: b.employee_code,
          gender: emp.gender || 'unknown',
          annual: parseInt(b.annual_leave || 0, 10),
          casual: parseInt(b.casual_leave ?? 0, 10), // From external API (preserved)
          sick: parseInt(b.sick_leave || 0, 10),     // From external API (preserved)
          carried: parseInt(b.carried_forward ?? 0, 10),
          marriage: parseInt(b.marriage_leave ?? 0, 10),
          maternity: parseInt(b.maternity_leave ?? 0, 10),
          paternal: parseInt(b.paternal_leave ?? 0, 10),
          pilgrimage: parseInt(b.pilgrimage_leave ?? 0, 10),
          isProrated: proratedAnnual < leaveRepo.DEFAULT_ANNUAL,
          yearsOfService: leaveRepo.getYearsOfService(emp.join_date),
          note: 'Casual/Sick from Attendance System API'
        })
      }
    } catch (err) {
      errors.push({ employeeCode: emp.employee_code, error: err?.message || 'Failed to process' })
      skipped++
    }
  }

  return {
    success: true,
    total: employees.length,
    processed,
    skipped,
    errors: errors.length,
    details: results.slice(0, 50), // Return first 50 for preview
    errorDetails: errors.slice(0, 10) // Return first 10 errors
  }
}

/** HR: Import carried forward leaves only (one-time setup).
 * This ONLY updates carried_forward field and does NOT modify other leave types.
 * Use this for initial setup before automatic rollover takes over.
 * @param {string|number} hrEmployeeId - HR employee ID
 * @param {Array} importRows - Array of { employeeCode, carried }
 * @returns {Object} Import results
 */
export async function importCarriedForwardOnly(hrEmployeeId, importRows) {
  const hid = parseEmployeeId(hrEmployeeId != null ? String(hrEmployeeId) : null)
  if (hid == null) return { error: 'Valid hrEmployeeId is required', status: 400 }
  const isHr = await reqRepo.isHrMember(hid)
  if (!isHr) return { error: 'Only HR can import carried forward leaves', status: 403 }

  if (!Array.isArray(importRows) || importRows.length === 0) {
    return { error: 'No import data provided', status: 400 }
  }

  const results = []
  const errors = []
  let imported = 0
  let failed = 0

  for (const row of importRows) {
    const code = String(row?.employeeCode || '').trim()
    const carriedDays = Math.max(0, Math.floor(Number(row?.carried) || 0))

    if (!code) {
      errors.push({ employeeCode: code || 'Unknown', error: 'Employee code is required' })
      failed++
      continue
    }

    try {
      const rows = await leaveRepo.updateCarriedForwardByEmployeeCode(code, carriedDays)

      if (rows.length === 0) {
        errors.push({ employeeCode: code, error: 'Employee not found or no update made' })
        failed++
      } else {
        const b = rows[0]
        imported++
        results.push({
          employeeCode: b.employee_code,
          carriedForward: parseInt(b.carried_forward || 0, 10),
          annualLeave: parseInt(b.annual_leave || 0, 10)
        })
      }
    } catch (err) {
      errors.push({ employeeCode: code, error: err?.message || 'Failed to process' })
      failed++
    }
  }

  return {
    success: true,
    total: importRows.length,
    imported,
    failed,
    errors: errors.length,
    details: results.slice(0, 50),
    errorDetails: errors.slice(0, 10)
  }
}

/** HR: import current annual-leave balances from a sheet (rows: { employeeCode, annual }). */
export async function importAnnualLeavesOnly(hrEmployeeId, importRows) {
  const hid = parseEmployeeId(hrEmployeeId != null ? String(hrEmployeeId) : null)
  if (hid == null) return { error: 'Valid hrEmployeeId is required', status: 400 }
  if (!(await reqRepo.isHrMember(hid))) return { error: 'Only HR can import annual leaves', status: 403 }
  if (!Array.isArray(importRows) || importRows.length === 0) return { error: 'No import data provided', status: 400 }

  const results = []; const errors = []; let imported = 0; let failed = 0
  for (const row of importRows) {
    const code = String(row?.employeeCode || '').trim()
    const annual = Math.max(0, Math.floor(Number(row?.annual) || 0))
    if (!code) { errors.push({ employeeCode: code || 'Unknown', error: 'Employee code is required' }); failed++; continue }
    try {
      const rows = await leaveRepo.updateAnnualLeaveByEmployeeCode(code, annual)
      if (rows.length === 0) { errors.push({ employeeCode: code, error: 'Employee not found' }); failed++ }
      else { imported++; results.push({ employeeCode: rows[0].employee_code, annualLeave: parseInt(rows[0].annual_leave || 0, 10) }) }
    } catch (err) { errors.push({ employeeCode: code, error: err?.message || 'Failed to process' }); failed++ }
  }
  return { success: true, total: importRows.length, imported, failed, errors: errors.length, details: results.slice(0, 50), errorDetails: errors.slice(0, 10) }
}

/**
 * HR: run the yearly annual-leave allocation (idempotent).
 * Grants the 1-year anniversary proration where due, and the January full-14 reset (with
 * carry-forward) once per calendar year. `opts.today` ('YYYY-MM-DD') overrides the run date (tests).
 */
export async function runAnnualAllocation(hrEmployeeId, opts = {}) {
  const hid = parseEmployeeId(hrEmployeeId != null ? String(hrEmployeeId) : null)
  if (hid == null) return { error: 'Valid hrEmployeeId is required', status: 400 }
  if (!(await reqRepo.isHrMember(hid))) return { error: 'Only HR can run annual allocation', status: 403 }

  const today = opts.today || new Date().toISOString().slice(0, 10)
  const employees = await leaveRepo.getActiveEmployeesForAnnualAllocation()
  let prorated = 0; let reset = 0; let skipped = 0; const details = []
  for (const e of employees) {
    const decision = decideAnnualAllocation({
      joinDate: e.join_date,
      prorationGrantedAt: e.annual_proration_granted_at,
      lastAllocatedYear: e.annual_last_allocated_year != null ? Number(e.annual_last_allocated_year) : null,
      today
    })
    try {
      if (decision.action === 'proration') {
        await leaveRepo.applyAnnualProration(e.employee_id, decision.proratedDays, today, decision.year)
        prorated++
        details.push({ employeeCode: e.employee_code, action: 'proration', days: decision.proratedDays })
      } else if (decision.action === 'january_reset') {
        await leaveRepo.applyAnnualJanuaryReset(e.employee_id, decision.year)
        reset++
        details.push({ employeeCode: e.employee_code, action: 'january_reset', annual: 14 })
      } else {
        skipped++
      }
    } catch (err) {
      skipped++
      details.push({ employeeCode: e.employee_code, action: 'error', error: err?.message })
    }
  }
  return { success: true, total: employees.length, prorated, reset, skipped, details: details.slice(0, 100) }
}

export async function getLeaveRequests(employeeId) {
  const result = await leaveRepo.getLeaveRequests(employeeId)
  // An HOD's non-casual/sick leave routes to the CEO (not HR), so its approval status should be
  // shown as "CEO Status". Flag those rows so the UI can relabel.
  const isHod = await reqRepo.isHodEmployee(parseEmployeeId(employeeId))
  return result.map(r => ({
    id: r.leave_request_id,
    reference: formatLeaveReference(r.leave_request_id, r.created_at),
    leaveTypeId: r.leave_type_id,
    type: r.leave_type || 'Annual Leave',
    startDate: r.start_date,
    endDate: r.end_date,
    days: parseInt(r.days || 0),
    status: r.status || 'Pending',
    reason: r.reason || '',
    date: r.created_at,
    source: r.source || 'portal',
    icsLeaveId: r.ics_leave_id ?? null,
    isHodRequest: isHod && !CASUAL_SICK_TYPE_IDS.has(Number(r.leave_type_id))
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

  const leaveType = String(body?.leaveType || '').trim().toLowerCase().replace(/\s+/g, '').replace('leave', '')
  const validTypes = ['annual', 'casual', 'sick', 'marriage', 'maternity', 'paternal', 'pilgrimage', 'paternity']
  if (!validTypes.includes(leaveType)) {
    return { error: 'leaveType must be one of: annual, casual, sick, marriage, maternity, paternal, pilgrimage', status: 400 }
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
    // Check for actual missing table error (relation does not exist)
    if (msg.includes('relation') && msg.includes('does not exist')) {
      return {
        error:
          'Deduction log table is missing. Please run migration: database/migrations/leave_deduction_log_pg.sql',
        status: 500
      }
    }
    // Check for check constraint violation on leave_type
    if (msg.includes('check constraint') && msg.includes('leave_type')) {
      return {
        error: `Invalid leave type "${leaveType}" for deduction log. Please update the database constraint to include this leave type.`,
        status: 400
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
      sick: parseInt(r.sick_leave || 0, 10),
      marriage: parseInt(r.marriage_leave ?? defaultBalance.marriage, 10),
      maternity: parseInt(r.maternity_leave ?? defaultBalance.maternity, 10),
      paternal: parseInt(r.paternal_leave ?? defaultBalance.paternal, 10),
      pilgrimage: parseInt(r.pilgrimage_leave ?? defaultBalance.pilgrimage, 10)
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

  const leaveType = String(body?.leaveType || '').trim().toLowerCase().replace(/\s+/g, '').replace('leave', '')
  const validTypes = ['annual', 'casual', 'sick', 'marriage', 'maternity', 'paternal', 'pilgrimage', 'paternity']
  if (!validTypes.includes(leaveType)) {
    return { error: 'leaveType must be one of: annual, casual, sick, marriage, maternity, paternal, pilgrimage', status: 400 }
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
      sick: parseInt(r.sick_leave || 0, 10),
      marriage: parseInt(r.marriage_leave ?? defaultBalance.marriage, 10),
      maternity: parseInt(r.maternity_leave ?? defaultBalance.maternity, 10),
      paternal: parseInt(r.paternal_leave ?? defaultBalance.paternal, 10),
      pilgrimage: parseInt(r.pilgrimage_leave ?? defaultBalance.pilgrimage, 10)
    }
  }
}

/**
 * Receive a leave request pushed from the ICS Attendance System.
 * Creates the record with source='ics', determines HOD vs HR initial status,
 * and notifies the appropriate approver.
 *
 * Expected body from ICS:
 *   { employeeCode, leaveTypeId, startDate, endDate, reason, icsLeaveId? }
 *
 * Returns:
 *   { leaveRequestId, status, message } on success
 *   { error, status } on failure
 */
export async function receiveIcsLeaveRequest(data) {
  const { employeeCode, leaveTypeId, startDate, endDate, reason, icsLeaveId } = data || {}

  // --- Validate required fields ---
  const code = String(employeeCode || '').trim()
  if (!code) return { error: 'employeeCode is required', status: 400 }

  const typeId = parseInt(leaveTypeId, 10)
  if (Number.isNaN(typeId) || typeId < 1) {
    return { error: 'leaveTypeId is required and must be a positive integer', status: 400 }
  }

  // ICS leaves are Casual (1) or Sick (2) — enforce this
  if (![1, 2].includes(typeId)) {
    return {
      error: 'ICS leaves must be Casual (leaveTypeId=1) or Sick (leaveTypeId=2)',
      status: 400
    }
  }

  const range = validateLeaveDateRange(startDate, endDate)
  if (range.error) return { error: range.error, status: range.status }

  // --- Resolve employee ---
  const employeeId = await getEmployeeIdByCode(code)
  if (!employeeId) return { error: 'Employee not found', status: 404 }

  // --- Validate leave type is active ---
  const leaveTypeDetails = await leaveRepo.getLeaveTypeById(typeId)
  if (!leaveTypeDetails) return { error: 'Invalid leave type ID', status: 400 }
  if (!leaveTypeDetails.is_active) return { error: 'This leave type is currently inactive', status: 400 }

  const normalizedTypeName = leaveTypeDetails.leave_type_name

  // --- Determine initial status: HOD's own Annual/long leaves → CEO, Casual/Sick → HR, others → HOD ---
  const emp = await reqRepo.getEmployeeDept(employeeId)
  const initialStatus = await resolveInitialLeaveStatus(employeeId, typeId)

  // --- Persist with source='ics' ---
  const result = await leaveRepo.createLeaveRequest(
    employeeId, typeId, startDate, endDate,
    reason || `ICS leave request${icsLeaveId ? ` (ICS ref: ${icsLeaveId})` : ''}`,
    initialStatus,
    'ics'
  )
  const leaveRequestId = result[0]?.leave_request_id
  if (!leaveRequestId) return { error: 'Failed to create leave request', status: 500 }

  // --- Notify approver ---
  try {
    const deptId = emp?.department_id
    if (initialStatus === 'Pending CEO') {
      const ceoIds = await notifRepo.getEmployeeIdsByRoleType('CEO')
      notifSvc.notifySafe(notifSvc.notifyMany(ceoIds, {
        type: 'leave_pending_ceo',
        title: 'New ICS leave request',
        body: `ICS ${normalizedTypeName} request #${leaveRequestId} from ${code} (HOD) is pending your (CEO) approval.`,
        url: '/leave',
        relatedEntityType: 'leave',
        relatedEntityId: leaveRequestId
      }))
    } else if (initialStatus === 'Pending HR') {
      const hrIds = await notifRepo.getHrEmployeeIds()
      notifSvc.notifySafe(notifSvc.notifyMany(hrIds, {
        type: 'leave_pending_hr',
        title: 'New ICS leave request',
        body: `ICS ${normalizedTypeName} request #${leaveRequestId} from ${code} is pending HR review.`,
        url: '/leave',
        relatedEntityType: 'leave',
        relatedEntityId: leaveRequestId
      }))
    } else if (deptId != null) {
      const hodIds = await notifRepo.getHodEmployeeIdsForDepartment(deptId)
      notifSvc.notifySafe(notifSvc.notifyMany(hodIds, {
        type: 'leave_pending_hod',
        title: 'New ICS leave request',
        body: `ICS ${normalizedTypeName} request #${leaveRequestId} from ${code} is pending your approval.`,
        url: '/leave',
        relatedEntityType: 'leave',
        relatedEntityId: leaveRequestId
      }))
    }
  } catch (nErr) {
    console.warn('ICS leave receive notification error:', nErr.message)
  }

  return {
    message: 'ICS leave request received and queued for approval',
    leaveRequestId,
    leaveTypeId: typeId,
    leaveType: normalizedTypeName,
    status: initialStatus,
    source: 'ics'
  }
}

export async function createLeaveRequest(data) {
  const { employeeId, leaveTypeId, leaveType, startDate, endDate, reason } = data

  // Support both leaveTypeId (preferred) and legacy leaveType
  let finalLeaveTypeId = leaveTypeId
  let normalizedTypeName = null

  if (!finalLeaveTypeId && leaveType) {
    // Legacy: lookup leaveTypeId from leaveType name
    normalizedTypeName = getNormalizedLeaveType(leaveType)
    const typeRows = await leaveRepo.getLeaveTypeIdByName(normalizedTypeName)
    if (typeRows && typeRows.length > 0) {
      finalLeaveTypeId = typeRows[0].leave_type_id
    }
  }

  if (!finalLeaveTypeId) {
    return {
      error: 'leaveTypeId is required. Portal-requestable types: 3=Annual, 4=Marriage, 5=Maternity, 6=Paternal, 7=Pilgrimage. (Casual and Sick are managed through the Attendance system.)',
      status: 400
    }
  }

  // Get leave type details for validation
  const leaveTypeDetails = await leaveRepo.getLeaveTypeById(finalLeaveTypeId)
  if (!leaveTypeDetails) {
    return { error: 'Invalid leave type ID', status: 400 }
  }

  // Check if leave type is active
  if (!leaveTypeDetails.is_active) {
    return { error: 'This leave type is currently inactive', status: 400 }
  }

  normalizedTypeName = normalizedTypeName || leaveTypeDetails.leave_type_name

  // Check if leave type is requestable through portal (exclude Casual/Sick for portal)
  const portalRequestableIds = [3, 4, 5, 6, 7] // Annual, Marriage, Maternity, Paternal, Pilgrimage
  if (!portalRequestableIds.includes(parseInt(finalLeaveTypeId, 10))) {
    return {
      error: 'Invalid leave type for portal request. Allowed types: Annual(3), Marriage(4), Maternity(5), Paternal(6), Pilgrimage(7). Casual(1) and Sick(2) are managed through the Attendance system.',
      status: 400
    }
  }

  const range = validateLeaveDateRange(startDate, endDate)
  if (range.error) return { error: range.error, status: range.status }
  const { days } = range

  const eid = parseEmployeeId(employeeId)
  if (eid != null) {
    const bal = await getLeaveBalance(eid)
    const balanceKey = getLeaveBalanceKey(normalizedTypeName)
    if (!balanceKey) {
      return { error: 'Could not determine leave balance type', status: 400 }
    }

    // Annual leave draws from the fresh allotment PLUS carried-forward days (matches the form,
    // which shows annual + carried as one pool). Other types use their single balance.
    const available = balanceKey === 'annual' ? (bal.annual + bal.carried) : bal[balanceKey]
    if (days > available) {
      return {
        error: `Insufficient ${normalizedTypeName} balance. You have ${available} day(s) available; this request needs ${days} calendar day(s).`,
        status: 400
      }
    }
  }

  const initialStatus = eid != null
    ? await resolveInitialLeaveStatus(employeeId, finalLeaveTypeId)
    : 'Pending'
  const result = await leaveRepo.createLeaveRequest(employeeId, finalLeaveTypeId, normalizedTypeName, startDate, endDate, reason, initialStatus)
  const leaveRequestId = result[0].leave_request_id

  // Notify the leave-approval mailbox of the new request (branded HTML).
  {
    const applicant = await getEmployeeRow(employeeId)
    const applicantName = applicant ? `${applicant.first_name || ''} ${applicant.last_name || ''}`.trim() : ''
    const applicantCode = applicant?.employee_code || null
    const pendingWhom = initialStatus === 'Pending CEO' ? 'CEO approval'
      : initialStatus === 'Pending HR' ? 'HR approval' : 'HOD approval'
    // Recipients: the leave mailbox always; for an HOD's own leave (routed to CEO) the CEO(s) too.
    const recipients = [getLeaveNotificationEmail()]
    if (initialStatus === 'Pending CEO') {
      const ceoEmails = await notifRepo.getEmployeeEmailsByRoleType('CEO').catch(() => [])
      recipients.push(...ceoEmails)
    }
    const toList = [...new Set(recipients.filter(Boolean))].join(', ')
    await sendLeaveEmailSafe(
      toList,
      `New Leave Request — ${normalizedTypeName}`,
      {
        title: 'New Leave Request',
        accent: 'blue',
        introLines: [`A new ${normalizedTypeName} request has been submitted${applicantName ? ` by ${applicantName}` : ''} and is now pending ${pendingWhom}.`],
        details: [
          { label: 'Reference', value: formatLeaveReference(leaveRequestId) },
          { label: 'Employee', value: applicantName || `#${employeeId}` },
          { label: 'Employee Code', value: applicantCode },
          { label: 'Type', value: normalizedTypeName },
          { label: 'Start Date', value: fmtLeaveDate(startDate) },
          { label: 'End Date', value: fmtLeaveDate(endDate) },
          { label: 'Status', value: initialStatus }
        ],
        reason: reason ? String(reason).trim() : null
      }
    )
  }

  try {
    const applicantDept = await reqRepo.getEmployeeDept(employeeId)
    const deptId = applicantDept?.department_id
    if (initialStatus === 'Pending CEO') {
      const ceoIds = await notifRepo.getEmployeeIdsByRoleType('CEO')
      notifSvc.notifySafe(notifSvc.notifyMany(ceoIds, {
        type: 'leave_pending_ceo',
        title: 'New leave request',
        body: `Leave request #${leaveRequestId} from HOD (employee ${employeeId}) is pending your (CEO) approval.`,
        url: '/leave',
        relatedEntityType: 'leave',
        relatedEntityId: leaveRequestId
      }))
    } else if (initialStatus === 'Pending HR') {
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
    leaveRequestId,
    leaveTypeId: finalLeaveTypeId,
    leaveType: normalizedTypeName
  }
}

/** Update leave request status. HR can approve/reject from Pending or Pending HR. HOD can set Pending -> Pending HR or Rejected. */
export async function updateLeaveStatus(leaveRequestId, body) {
  const { status, source } = body || {}
  const reqId = parseInt(leaveRequestId, 10)
  if (Number.isNaN(reqId)) return { error: 'Valid leave request ID is required', status: 400 }
  const eid = await resolveApproverEmployeeId(body || {})
  if (eid == null) {
    return { error: 'Valid approvedByEmployeeId or approvedByEmployeeCode is required', status: 400 }
  }

  const normalizedStatus = (status && String(status).trim()) || ''
  const leave = await leaveRepo.getLeaveRequestById(reqId)
  if (!leave) return { error: 'Leave request not found', status: 404 }

  // Check if this is an ICS leave (requires only HOD approval, no HR)
  const isIcsLeave = (leave.source || 'portal') === 'ics'

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

      // Sync leave status to external ICS Attendance System (HR approval - non-blocking)
      const empData = await getEmployeeRow(leave.employee_id)
      const employeeCode = empData?.employee_code || empData?.code
      if (employeeCode) {
        syncLeaveStatusToICS({
          employeeCode,
          leaveId: reqId,
          status: normalizedStatus,
          leaveType: leave.leave_type || 'Annual',
          startDate: leave.start_date,
          endDate: leave.end_date
        }).catch(err => console.error('ICS sync error (non-blocking):', err?.message))
        syncStatusToCrm(leave.ics_leave_id, employeeCode, normalizedStatus)
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
    // HOD directly approves or rejects — no HR approval step required
    if (!['Approved', 'Rejected'].includes(normalizedStatus)) {
      return {
        error: 'HOD can set status to Approved or Rejected',
        status: 400
      }
    }

    const hodId = await reqRepo.getHodByDepartment(leave.department_id)
    if (hodId == null || hodId !== eid) {
      return { error: 'Only HOD of the applicant\'s department can approve or reject', status: 403 }
    }

    if (normalizedStatus === 'Approved') {
      const ar = await approveWithAnnualDeduction(leave, reqId, 'Pending', 'Approved')
      if (ar.error) return ar
    } else {
      const result = await leaveRepo.updateLeaveRequestStatus(reqId, 'Rejected', 'Pending')
      if (!result || result.length === 0) return { error: 'Could not update status', status: 400 }
    }

    // Sync status to ICS and CRM
    const empData = await getEmployeeRow(leave.employee_id)
    const employeeCode = empData?.employee_code || empData?.code
    if (employeeCode) {
      syncLeaveStatusToICS({
        employeeCode,
        leaveId: reqId,
        status: normalizedStatus,
        leaveType: leave.leave_type || 'Annual',
        startDate: leave.start_date,
        endDate: leave.end_date
      }).catch(err => console.error('ICS sync error (non-blocking):', err?.message))
      syncStatusToCrm(leave.ics_leave_id, employeeCode, normalizedStatus)
    } else {
      console.warn(`⚠️ Could not find employee_code for employee_id ${leave.employee_id}, skipping ICS sync`)
    }

    // Notify HR by email when HOD approves so they are aware the employee will be on leave
    if (normalizedStatus === 'Approved') {
      const empName = empData ? `${empData.first_name || ''} ${empData.last_name || ''}`.trim() : `Employee #${leave.employee_id}`
      await sendLeaveEmailSafe(
        HR_EMAIL,
        `Leave Approved — ${empName} on leave (${formatLeaveReference(reqId, leave.created_at)})`,
        {
          title: 'Leave Approved (HOD)',
          accent: 'green',
          introLines: [`${empName}'s leave has been approved by their HOD. This is an informational notice — no action is required from HR.`],
          details: [
            { label: 'Reference', value: formatLeaveReference(reqId, leave.created_at) },
            { label: 'Employee', value: empName },
            { label: 'Employee Code', value: empData?.employee_code || null },
            { label: 'Type', value: leave.leave_type },
            { label: 'Start Date', value: fmtLeaveDate(leave.start_date) },
            { label: 'End Date', value: fmtLeaveDate(leave.end_date) },
            { label: 'Days', value: daysLabel(leave.days) }
          ],
          reason: (leave.reason && String(leave.reason).trim()) || null
        }
      )
    }

    // In-app notification to the employee
    const applicantId = parseInt(leave.employee_id, 10)
    if (!Number.isNaN(applicantId)) {
      notifSvc.notifySafe(notifSvc.notify({
        recipientEmployeeId: applicantId,
        type: normalizedStatus === 'Approved' ? 'leave_approved' : 'leave_rejected',
        title: normalizedStatus === 'Approved' ? 'Leave approved' : 'Leave rejected',
        body: `Your leave request #${reqId} was ${normalizedStatus.toLowerCase()} by HOD.`,
        url: '/leave',
        relatedEntityType: 'leave',
        relatedEntityId: reqId
      }))
    }

    const message = normalizedStatus === 'Rejected' ? 'Leave request rejected' : 'Leave request approved'
    return { message, status: normalizedStatus }
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

    // Sync leave status to external ICS Attendance System (HR final approval - non-blocking)
    const empDataHr = await getEmployeeRow(leave.employee_id)
    const employeeCodeHr = empDataHr?.employee_code || empDataHr?.code
    if (employeeCodeHr) {
      syncLeaveStatusToICS({
        employeeCode: employeeCodeHr,
        leaveId: reqId,
        status: normalizedStatus,
        leaveType: leave.leave_type || 'Annual',
        startDate: leave.start_date,
        endDate: leave.end_date
      }).catch(err => console.error('ICS sync error (non-blocking):', err?.message))
      syncStatusToCrm(leave.ics_leave_id, employeeCodeHr, normalizedStatus)
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

  if (current === 'Pending CEO') {
    if (normalizedStatus !== 'Approved' && normalizedStatus !== 'Rejected') {
      return { error: 'CEO can set status to Approved or Rejected', status: 400 }
    }
    const isCeo = await reqRepo.isCeoMember(eid)
    if (!isCeo) return { error: 'Only CEO can approve or reject at this stage', status: 403 }
    if (normalizedStatus === 'Approved') {
      const ar = await approveWithAnnualDeduction(leave, reqId, 'Pending CEO', 'Approved')
      if (ar.error) return ar
    } else {
      const rej = await leaveRepo.updateLeaveRequestStatus(reqId, normalizedStatus, 'Pending CEO')
      if (!rej || rej.length === 0) return { error: 'Could not update status', status: 400 }
    }

    // Sync leave status to external ICS Attendance System (CEO final approval - non-blocking)
    const empDataCeo = await getEmployeeRow(leave.employee_id)
    const employeeCodeCeo = empDataCeo?.employee_code || empDataCeo?.code
    if (employeeCodeCeo) {
      syncLeaveStatusToICS({
        employeeCode: employeeCodeCeo,
        leaveId: reqId,
        status: normalizedStatus,
        leaveType: leave.leave_type || 'Annual',
        startDate: leave.start_date,
        endDate: leave.end_date
      }).catch(err => console.error('ICS sync error (non-blocking):', err?.message))
      syncStatusToCrm(leave.ics_leave_id, employeeCodeCeo, normalizedStatus)
    }

    const applicantIdCeo = parseInt(leave.employee_id, 10)
    if (!Number.isNaN(applicantIdCeo)) {
      notifSvc.notifySafe(notifSvc.notify({
        recipientEmployeeId: applicantIdCeo,
        type: normalizedStatus === 'Approved' ? 'leave_approved' : 'leave_rejected',
        title: normalizedStatus === 'Approved' ? 'Leave approved' : 'Leave rejected',
        body: `Your leave request #${reqId} was ${normalizedStatus.toLowerCase()} by CEO.`,
        url: '/leave',
        relatedEntityType: 'leave',
        relatedEntityId: reqId
      }))
    }

    // Email the applicant the CEO's decision
    await emailApplicantLeaveDecision(leave, reqId, normalizedStatus, 'CEO')

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

  const [total, rows, hodIdList] = await Promise.all([
    leaveRepo.countAllLeavesForHr(),
    leaveRepo.getAllLeavesForHr(limit, offset),
    reqRepo.getAllHodEmployeeIds()
  ])
  // HOD non-casual/sick leaves are approved by the CEO, so mark them so the UI shows "CEO Status".
  const hodIds = new Set(hodIdList)

  const data = rows.map(r => ({
    id: r.leave_request_id,
    reference: formatLeaveReference(r.leave_request_id, r.created_at),
    employeeId: r.employee_id,
    employeeCode: r.employee_code,
    leaveTypeId: r.leave_type_id,
    type: r.leave_type || 'Annual Leave',
    startDate: r.start_date,
    endDate: r.end_date,
    days: parseInt(r.days || 0),
    status: r.status || 'Pending',
    source: r.source || 'portal',
    icsLeaveId: r.ics_leave_id ?? null,
    reason: r.reason || '',
    date: r.created_at,
    firstName: r.first_name,
    lastName: r.last_name,
    email: r.email,
    departmentName: r.department_name,
    isHodRequest: hodIds.has(parseInt(r.employee_id, 10)) && !CASUAL_SICK_TYPE_IDS.has(Number(r.leave_type_id))
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
    employeeCode: r.employee_code,
    leaveTypeId: r.leave_type_id,
    type: r.leave_type || 'Annual Leave',
    startDate: r.start_date,
    endDate: r.end_date,
    days: parseInt(r.days || 0),
    status: r.status || 'Pending HR',
    source: r.source || 'portal',
    icsLeaveId: r.ics_leave_id ?? null,
    reason: r.reason || '',
    date: r.created_at,
    firstName: r.first_name,
    lastName: r.last_name,
    email: r.email,
    departmentName: r.department_name
  }))
}

/**
 * Fetch ICS pending leaves for all dept employees directly from ICS API.
 * No DB insert. Excludes leaves already actioned in portal (HOD already approved/rejected).
 */
async function fetchIcsDeptPendingLeaves(deptId, excludeEmployeeId) {
  try {
    const employees = await leaveRepo.getActiveEmployeesByDepartment(deptId, excludeEmployeeId)
    console.log(`[ICS fetch] dept ${deptId}: ${employees.length} employees`)
    if (!employees.length) return []

    // ICS leave IDs already actioned in portal — skip those
    const processed = await leaveRepo.getProcessedIcsLeaveIds(employees.map(e => e.employee_id))
    const processedSet = new Set(processed.map(r => r.ics_leave_id))

    const currentYear = new Date().getFullYear()
    const results = []

    await Promise.all(employees.map(async (e) => {
      const empCode = String(e.employee_code || '').trim()
      if (!empCode) return
      const empName = [e.first_name, e.last_name].filter(Boolean).join(' ') || `Employee ${empCode}`
      try {
        const response = await fetch(`${ICS_API_BASE_URL}/view-allocated-leaves-by-emp.php`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ emp_id: parseInt(empCode, 10), year: currentYear }),
          signal: AbortSignal.timeout(10000)
        })
        if (!response.ok) {
          console.warn(`[ICS fetch] ${empCode}: HTTP ${response.status}`)
          return
        }
        const data = await response.json()
        const leaves = data?.data?.leaves || []
        const pending = leaves.filter(l => l.leave_type_id && l.start_date && l.leave_status === 'Pending')
        console.log(`[ICS fetch] ${empCode}: total=${leaves.length} pending=${pending.length} statuses=${[...new Set(leaves.map(l => l.leave_status))]}`)
        for (const l of pending) {
          if (processedSet.has(l.leave_id)) { console.log(`[ICS fetch] ${empCode} leave ${l.leave_id} already processed, skip`); continue }
          results.push({
            id: l.leave_id,
            icsLeaveId: l.leave_id,
            employeeId: e.employee_id,
            employeeCode: empCode,
            employeeName: empName,
            leaveTypeId: l.leave_type_id,
            type: l.leave_type_name || 'Casual',
            startDate: l.start_date,
            endDate: l.end_date || l.start_date,
            days: l.total_days || 1,
            reason: l.reason || '',
            date: l.created_at || null,
            status: 'Pending',
            source: 'ics'
          })
        }
      } catch (err) {
        console.warn(`[ICS fetch] ${empCode} error:`, err.message)
      }
    }))

    return results
  } catch (err) {
    console.warn('[ICS fetch] dept error:', err.message)
    return []
  }
}

/** Pending leave requests for HOD's department (same logic as pending requisition for HOD). */
export async function getPendingHod(employeeId) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return { error: 'Valid employee ID is required', status: 400 }
  const emp = await reqRepo.getEmployeeDept(employeeId)
  if (!emp) return { error: 'Employee not found', status: 404 }
  const deptId = emp.department_id
  const deptName = (emp.department_name || '').trim().toLowerCase()
  console.log(`[getPendingHod] eid=${eid} deptId=${deptId} deptName="${deptName}"`)
  if (deptId == null && !deptName) { console.log('[getPendingHod] no dept → []'); return [] }
  const hodId = await reqRepo.getHodByDepartment(deptId)
  console.log(`[getPendingHod] hodId=${hodId} eid=${eid} match=${hodId === eid}`)
  if (hodId == null || hodId !== eid) return []

  const [rows, icsLeaves] = await Promise.all([
    leaveRepo.getPendingHodLeaves(deptId, deptName, eid),
    fetchIcsDeptPendingLeaves(deptId, eid)
  ])
  console.log(`[getPendingHod] portalRows=${rows.length} icsLeaves=${icsLeaves.length}`)

  const portalLeaves = rows.map(r => ({
    id: r.leave_request_id,
    reference: formatLeaveReference(r.leave_request_id, r.created_at),
    employeeId: r.employee_id,
    employeeName: [r.first_name, r.last_name].filter(Boolean).join(' '),
    leaveTypeId: r.leave_type_id,
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
    departmentName: r.department_name,
    source: 'portal'
  }))

  return [...portalLeaves, ...icsLeaves]
}

/**
 * HOD approves or rejects an ICS leave (which is NOT in the portal DB yet).
 * - approve: creates a portal record with status='Pending HR' for HR to action, calls CRM API
 * - reject: calls CRM API only, no portal record needed
 */
export async function hodActOnIcsLeave(body) {
  const { icsLeaveId, empCode, hodEmployeeCode, action, leaveTypeId, leaveTypeName, startDate, endDate, reason } = body || {}

  if (!icsLeaveId || !empCode || !hodEmployeeCode) {
    return { error: 'icsLeaveId, empCode and hodEmployeeCode are required', status: 400 }
  }
  if (!['approve', 'reject'].includes(action)) {
    return { error: 'action must be approve or reject', status: 400 }
  }

  const hodId = await getEmployeeIdByCode(String(hodEmployeeCode))
  if (!hodId) return { error: 'HOD not found', status: 404 }

  const empId = await getEmployeeIdByCode(String(empCode))
  if (!empId) return { error: 'Employee not found', status: 404 }

  // Verify the requester is actually the HOD of this employee's department
  const emp = await reqRepo.getEmployeeDept(empId)
  if (!emp?.department_id) return { error: 'Employee department not found', status: 404 }
  const actualHodId = await reqRepo.getHodByDepartment(emp.department_id)
  if (actualHodId == null || actualHodId !== hodId) {
    return { error: 'Only HOD of the applicant\'s department can approve or reject', status: 403 }
  }

  const typeId = leaveTypeId ? parseInt(leaveTypeId, 10) : null
  if (!typeId || !startDate) return { error: 'leaveTypeId and startDate are required', status: 400 }

  const newStatus = action === 'reject' ? 'Rejected' : 'Approved'
  const typeName = String(leaveTypeName || 'Casual').trim()

  // Update existing portal record; if not yet synced, create it first
  let updated = await leaveRepo.findAndUpdateIcsLeave(empId, icsLeaveId, typeId, startDate, newStatus)
  if (!updated) {
    const result = await leaveRepo.createIcsLeaveInPortal(
      empId, typeId, typeName, startDate, endDate || startDate, reason || '', newStatus, icsLeaveId
    )
    updated = result[0] || null
  }
  const portalLeaveId = updated?.leave_request_id

  // Sync final decision to CRM
  syncStatusToCrm(icsLeaveId, empCode, newStatus)

  // In-app notification to employee
  const applicantId = parseInt(empId, 10)
  if (!Number.isNaN(applicantId)) {
    notifSvc.notifySafe(notifSvc.notify({
      recipientEmployeeId: applicantId,
      type: newStatus === 'Approved' ? 'leave_approved' : 'leave_rejected',
      title: newStatus === 'Approved' ? 'Leave approved' : 'Leave rejected',
      body: `Your leave request was ${newStatus.toLowerCase()} by HOD.`,
      url: '/leave',
      relatedEntityType: 'leave',
      relatedEntityId: portalLeaveId || icsLeaveId
    }))
  }

  if (action === 'reject') {
    return { message: 'Leave request rejected', status: 'Rejected' }
  }

  // HOD approved — notify HR by email (informational only, no action required)
  await sendLeaveEmailSafe(
    HR_EMAIL,
    `Leave Approved — Employee on leave (${portalLeaveId ? formatLeaveReference(portalLeaveId) : `ICS ${icsLeaveId}`})`,
    {
      title: 'Leave Approved (HOD)',
      accent: 'green',
      introLines: ['An employee\'s leave has been approved by their HOD. This is an informational notice — no action is required from HR.'],
      details: [
        { label: 'Reference', value: portalLeaveId ? formatLeaveReference(portalLeaveId) : null },
        { label: 'ICS Leave ID', value: icsLeaveId },
        { label: 'Employee Code', value: empCode },
        { label: 'Type', value: typeName },
        { label: 'Start Date', value: fmtLeaveDate(startDate) },
        { label: 'End Date', value: fmtLeaveDate(endDate || startDate) }
      ],
      reason: reason || null
    }
  )

  return { message: 'Leave request approved', status: 'Approved', portalLeaveId }
}

/** Get pending leave requests for CEO approval.
 * CEO approves HOD's Annual/Other leave requests (bypass HOD approval, direct to CEO)
 */
export async function getPendingCeo(employeeCode) {
  const code = String(employeeCode || '').trim()
  if (!code) return { error: 'Employee code is required', status: 400 }

  // Check if requester is CEO
  const employeeId = await getEmployeeIdByCode(code)
  if (!employeeId) return { error: 'Employee not found', status: 404 }

  const isCeo = await reqRepo.isCeoMember(employeeId)
  if (!isCeo) return { error: 'Only CEO can view this list', status: 403 }

  const rows = await leaveRepo.getPendingCeoLeaves()
  return rows.map(r => ({
    id: r.leave_request_id,
    reference: formatLeaveReference(r.leave_request_id, r.created_at),
    employeeId: r.employee_id,
    employeeCode: r.employee_code,
    leaveTypeId: r.leave_type_id,
    type: r.leave_type || 'Annual Leave',
    startDate: r.start_date,
    endDate: r.end_date,
    days: parseInt(r.days || 0),
    status: r.status || 'Pending CEO',
    reason: r.reason || '',
    date: r.created_at,
    firstName: r.first_name,
    lastName: r.last_name,
    email: r.email,
    departmentName: r.department_name,
    isHodRequest: true,
    requiresCeoApproval: true
  }))
}

/**
 * Sync a single ICS leave record into the portal DB so it appears in the HOD approval bucket.
 * Skips date-range validation (ICS leaves may be past dates).
 * Is idempotent — returns early if a portal record already exists for this leave.
 */

const CRM_STATUS_URL = 'https://webtrack.itecknologi.com/InternalCommunicationSystem/update-status.php'

/** Map portal leave status to CRM new_status code. */
function toCrmStatus(portalStatus) {
  switch (String(portalStatus || '').trim()) {
    case 'Approved': return 2
    case 'Rejected': return 3
    default: return 1   // Pending / Pending HR → still pending in CRM
  }
}

/**
 * Push a leave status update to the CRM API (non-blocking fire-and-forget).
 * Only called for ICS leaves that have an ics_leave_id stored.
 */
export function syncStatusToCrm(icsLeaveId, empCode, portalStatus) {
  if (!icsLeaveId || !empCode) return
  const new_status = toCrmStatus(portalStatus)
  fetch(CRM_STATUS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leave_id: parseInt(icsLeaveId, 10), new_status, emp_id: parseInt(empCode, 10) })
  })
    .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
    .then(data => console.log(`[CRM sync] leave ${icsLeaveId} → new_status ${new_status}:`, data))
    .catch(err => console.error(`[CRM sync] leave ${icsLeaveId} error:`, err.message))
}

export async function syncIcsLeaveToPortal(employeeCode, icsLeave) {
  const code = String(employeeCode || '').trim()
  if (!code) return null

  const typeId = parseInt(icsLeave?.leave_type_id, 10)
  const startDate = icsLeave?.start_date
  if (Number.isNaN(typeId) || !startDate) return null

  const employeeId = await getEmployeeIdByCode(code)
  if (!employeeId) return null

  const existing = await leaveRepo.findIcsLeaveInPortal(employeeId, typeId, startDate)
  if (existing) return existing

  const initialStatus = await resolveInitialLeaveStatus(employeeId, typeId)

  const typeName = String(icsLeave.leave_type_name || icsLeave.leave_type || 'Casual').trim()
  const icsLeaveId = icsLeave.leave_id ?? icsLeave.id ?? null
  const result = await leaveRepo.createIcsLeaveInPortal(
    employeeId, typeId, typeName, startDate,
    icsLeave.end_date || startDate,
    icsLeave.reason || '',
    initialStatus,
    icsLeaveId
  )
  return result[0] || null
}

/**
 * Fetch ICS leaves for every employee in the HOD's department and sync them into the portal DB.
 * Called when the HOD loads their pending bucket so ICS leaves appear without the employee
 * having to visit their own leave page first.
 */
export async function syncDepartmentIcsLeaves(hodEmployeeId) {
  const eid = parseEmployeeId(String(hodEmployeeId || ''))
  if (eid == null) return

  const emp = await reqRepo.getEmployeeDept(eid)
  if (!emp?.department_id) return

  const employees = await leaveRepo.getActiveEmployeesByDepartment(emp.department_id, eid)
  if (!employees.length) return

  console.log(`[ICS sync] HOD ${hodEmployeeId} — syncing ${employees.length} dept employees`)
  const currentYear = new Date().getFullYear()

  await Promise.all(employees.map(async (e) => {
    const empCode = String(e.employee_code || '').trim()
    if (!empCode) return
    try {
      const response = await fetch(`${ICS_API_BASE_URL}/view-allocated-leaves-by-emp.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emp_id: parseInt(empCode, 10), year: currentYear }),
        signal: AbortSignal.timeout(8000)
      })
      if (!response.ok) {
        console.warn(`[ICS sync] ${empCode}: HTTP ${response.status}`)
        return
      }
      const data = await response.json()
      const leaves = data?.data?.leaves || []
      const pendingLeaves = leaves.filter(l => l.leave_type_id && l.start_date && (!l.leave_status || l.leave_status === 'Pending'))
      console.log(`[ICS sync] ${empCode}: ${leaves.length} total leaves, ${pendingLeaves.length} pending to sync`)
      await Promise.all(
        pendingLeaves.map(l =>
          syncIcsLeaveToPortal(empCode, l).catch(err =>
            console.error(`[ICS sync] ${empCode} leave sync error:`, err.message)
          )
        )
      )
    } catch (err) {
      console.error(`[ICS sync] ${empCode} fetch error:`, err.message)
    }
  }))
}

/**
 * Return ICS leave decisions (Approved / Rejected) for the ICS pull API.
 * Supports optional filters: emp_code, from_date, to_date, status.
 */
export async function getIcsLeaveDecisions(filters = {}) {
  const rows = await leaveRepo.getIcsLeaveDecisions(filters)
  return rows.map(r => ({
    portal_leave_id: r.portal_leave_id,
    emp_id: r.emp_id,
    emp_name: r.emp_name,
    leave_type: r.leave_type,
    start_date: r.start_date,
    end_date: r.end_date,
    total_days: r.total_days,
    status: r.status,
    reason: r.reason,
    decided_at: r.decided_at,
    requested_at: r.requested_at
  }))
}