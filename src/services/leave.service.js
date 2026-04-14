import * as leaveRepo from '../repositories/leave.repository.js'
import * as reqRepo from '../repositories/requisition.repository.js'
import * as notifRepo from '../repositories/notification.repository.js'
import * as notifSvc from './notification.service.js'
import { getEmployeeIdByCode } from '../repositories/auth.repository.js'
import { EMAIL_FROM, getEmailTransport, isEmailConfigured } from '../../config/email.js'

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

export async function createLeaveRequest(data) {
  const { employeeId, leaveType, startDate, endDate, reason } = data

  // Normalize and validate leave type
  const normalizedType = getNormalizedLeaveType(leaveType)
  if (!isPortalRequestableLeaveType(leaveType)) {
    return {
      error:
        'Invalid leave type. Allowed types: Annual Leave, Marriage Leave, Maternity Leave, Paternal Leave, Pilgrimage Leave. Casual and sick leave are managed through the Attendance system.',
      status: 400
    }
  }

  const range = validateLeaveDateRange(startDate, endDate)
  if (range.error) return { error: range.error, status: range.status }
  const { days } = range

  const eid = parseEmployeeId(employeeId)
  if (eid != null) {
    const bal = await getLeaveBalance(eid)
    const balanceKey = getLeaveBalanceKey(leaveType)
    if (!balanceKey) {
      return { error: 'Could not determine leave balance type', status: 400 }
    }

    if (days > bal[balanceKey]) {
      return {
        error: `Insufficient ${normalizedType} balance. You have ${bal[balanceKey]} day(s) available; this request needs ${days} calendar day(s).`,
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
  const result = await leaveRepo.createLeaveRequest(employeeId, normalizedType, startDate, endDate, reason, initialStatus)
  const leaveRequestId = result[0].leave_request_id

  if (isEmailConfigured()) {
    const transport = getEmailTransport()
    if (transport) {
      try {
        const to = getLeaveNotificationEmail()
        const subject = `New Leave Request - ${normalizedType}`
        const body = [
          `Leave Request ID: ${leaveRequestId}`,
          `Employee ID: ${employeeId}`,
          `Leave Type: ${leaveType || '???'}`,
          `Start Date: ${startDate || '???'}`,
          `End Date: ${endDate || '???'}`,
          '',
          'Reason:',
          reason ? String(reason).trim() : '???'
        ].join('\n')
        console.log('???? [Leave] Sending to:', to, '| Subject:', subject)
        await transport.sendMail({
          from: EMAIL_FROM,
          to,
          subject,
          text: body
        })
        console.log('???? [Leave] SENT OK ???', to)
      } catch (err) {
        console.error('???? [Leave] FAILED ???', to, '| Error:', err.message)
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
          const subject = `Leave request forwarded to HR ??? pending your approval (ID: ${reqId})`
          const body = [
            'A leave request has been forwarded by HOD and is now in your HR bucket.',
            '',
            `Leave Request ID: ${reqId}`,
            `Employee ID: ${leave.employee_id}`,
            `Leave Type: ${leave.leave_type || '???'}`,
            `Start Date: ${leave.start_date || '???'}`,
            `End Date: ${leave.end_date || '???'}`,
            '',
            'Reason:',
            (leave.reason && String(leave.reason).trim()) || '???'
          ].join('\n')
          console.log('???? [Leave] HR notify: Sending to:', to, '| Subject:', subject)
          await transport.sendMail({ from: EMAIL_FROM, to, subject, text: body })
          console.log('???? [Leave] HR notify SENT OK ???', to)
        } catch (err) {
          console.error('???? [Leave] HR notify FAILED:', err.message)
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
