import bcrypt from 'bcryptjs'
import * as authRepo from '../repositories/auth.repository.js'
import { checkCrmLogin, getCrmEmployeeIdByUsername } from '../../config/crmDatabase.js'

const ALL_PERMISSION_KEYS = [
  'dashboard', 'profile', 'profile_update_requests', 'salary_slip', 'view_salary_slips',
  'leave', 'leave_pending', 'feedback', 'feedback_history', 'feedback_records_hr',
  'requisition_create', 'requisition_can_add_items', 'requisition_history', 'requisition_acknowledgment',
  'requisition_pending', 'requisition_approved', 'requisition_reports',
  'tat_report', 'help_support', 'extensions', 'administration',
  'payroll', 'payroll_gross_salaries', 'payroll_other_allowances', 'payroll_deductions', 'payroll_incentives'
]

const DEFAULT_USER_PERMISSIONS = [
  'profile', 'salary_slip', 'leave', 'feedback',
  'requisition_create', 'requisition_approved', 'requisition_history'
]

/** Technicians: profile, leave, feedback only — no requisition (add/create/history/pending/approved/reports). */
const TECHNICIAN_PERMISSIONS = [
  'profile', 'profile_update_requests', 'salary_slip', 'leave', 'leave_pending',
  'feedback', 'feedback_history', 'help_support', 'extensions'
]

function isTechnicianDesignation(desgName) {
  if (!desgName || typeof desgName !== 'string') return false
  return desgName.toLowerCase().includes('technician')
}

/** Resolve role used for permission set: explicit Technician user_type or designation contains "Technician". CRM/Non-CRM User use User permissions. */
async function resolveRoleForPermissions(employeeId, userType) {
  if (userType === 'Technician') return 'Technician'
  if (userType === 'CRM User' || userType === 'Non-CRM User') return 'User'
  if (!employeeId) return userType || 'User'
  try {
    const desg = await authRepo.getDesignationNameByEmployeeId(employeeId)
    if (isTechnicianDesignation(desg)) return 'Technician'
  } catch (_) {}
  return userType || 'User'
}

function isBcryptHash(value) {
  return typeof value === 'string' && /^\$2[aby]\$/.test(value)
}

async function getPermissionsForRole(roleName) {
  if (roleName === 'SuperAdmin') return [...ALL_PERMISSION_KEYS]
  if (roleName === 'Technician') return [...TECHNICIAN_PERMISSIONS]
  try {
    const rows = await authRepo.getRolePermissions(roleName)
    const list = rows.map(r => r.permission_key).filter(k => ALL_PERMISSION_KEYS.includes(k))
    if (roleName === 'User' && list.length === 0) return [...DEFAULT_USER_PERMISSIONS]
    return list
  } catch (err) {
    if (err.code === '42P01') return roleName === 'User' ? [...DEFAULT_USER_PERMISSIONS] : []
    throw err
  }
}

async function getEffectivePermissions(empId, roleName) {
  if (roleName === 'SuperAdmin') return [...ALL_PERMISSION_KEYS]
  // Technicians never get requisition via overrides — fixed set only
  if (roleName === 'Technician') return [...TECHNICIAN_PERMISSIONS]
  try {
    const overrideRows = await authRepo.getUserPermissionOverrides(empId)
    if (overrideRows.length > 0) {
      return overrideRows
        .filter(r => r.allowed)
        .map(r => r.permission_key)
        .filter(k => ALL_PERMISSION_KEYS.includes(k))
    }
  } catch (err) {
    if (err.code !== '42P01') throw err
  }
  return getPermissionsForRole(roleName)
}

/** Check if an employee has a specific permission (role + user overrides). */
export async function employeeHasPermission(empId, permissionKey) {
  if (!empId || !permissionKey) return false
  try {
    const userType = await authRepo.getUserTypeByEmployeeId(empId) || 'User'
    const role = await resolveRoleForPermissions(empId, userType)
    const perms = await getEffectivePermissions(empId, role)
    return Array.isArray(perms) && perms.includes(permissionKey)
  } catch (_) {
    return false
  }
}

/**
 * Portal login: users.username (portal credentials) then employees.email + password_hash.
 * Used when CRM is disabled or when CRM login fails (non-CRM technicians use portal credentials from employees/users).
 */
async function loginWithPortalCredentials(loginId, password) {
  try {
    const userRows = await authRepo.findUserByUsername(loginId)
    if (userRows.length > 0) {
      const row = userRows[0]
      if (!row.is_active) {
        return { error: 'Account is deactivated. Please contact HR.', status: 403 }
      }
      const hashToCheck = row.hashed_password
      if (!isBcryptHash(hashToCheck)) {
        return { error: 'Account password is not set up correctly. Please contact HR.', status: 401 }
      }
      const valid = await bcrypt.compare(password, hashToCheck)
      if (valid) {
        const role = await resolveRoleForPermissions(row.emp_id, row.user_type)
        const permissions = await getEffectivePermissions(row.emp_id, role)
        const isTechnician = role === 'Technician'
        const forcePasswordChange = isTechnician && (row.force_password_change === true)
        return {
          employeeId: row.emp_id,
          name: `${row.first_name || ''} ${row.last_name || ''}`.trim(),
          email: row.email,
          department: row.department_name || '',
          position: '',
          userType: isTechnician ? 'Technician' : row.user_type,
          permissions,
          forcePasswordChange: !!forcePasswordChange
        }
      }
    }
  } catch (err) {
    const tableMissing = err.code === '42P01' || err.number === 208 || (err.message && err.message.includes('Invalid object name'))
    if (!tableMissing) throw err
  }

  const result = await authRepo.findEmployeeByEmail(loginId)
  if (result.length === 0) {
    return { error: 'Invalid username/email or password', status: 401 }
  }
  const employee = result[0]
  if (!employee.is_active) {
    return { error: 'Account is deactivated. Please contact HR.', status: 403 }
  }
  if (!isBcryptHash(employee.password_hash)) {
    return { error: 'Invalid username/email or password', status: 401 }
  }
  const isValidPassword = await bcrypt.compare(password, employee.password_hash)
  if (!isValidPassword) {
    return { error: 'Invalid username/email or password', status: 401 }
  }
  const userType = await authRepo.getUserTypeByEmployeeId(employee.employee_id) || 'User'
  const role = await resolveRoleForPermissions(employee.employee_id, userType)
  const permissions = await getEffectivePermissions(employee.employee_id, role)
  const isTechnician = role === 'Technician'
  const forcePasswordChange = isTechnician && (await authRepo.getUserForcePasswordChange(employee.employee_id))
  return {
    employeeId: employee.employee_id,
    name: `${employee.first_name || ''} ${employee.last_name || ''}`.trim(),
    email: employee.email,
    department: employee.department_name || employee.department_id,
    position: employee.position,
    userType: isTechnician ? 'Technician' : userType,
    permissions,
    forcePasswordChange: !!forcePasswordChange
  }
}

export async function login(loginId, password) {
  const useCrm = !!process.env.CRM_HOST

  if (useCrm) {
    try {
      const crm = await checkCrmLogin(loginId, password)
      if (crm.valid && crm.crmEmployeeId) {
        let portalEmployees = await authRepo.findEmployeeByEmployeeCode(crm.crmEmployeeId)
        if (portalEmployees.length === 0) {
          const resolvedId = await getCrmEmployeeIdByUsername(loginId)
          if (resolvedId) {
            portalEmployees = await authRepo.findEmployeeByEmployeeCode(resolvedId)
          }
        }
        if (portalEmployees.length > 0) {
          const employee = portalEmployees[0]
          if (!employee.is_active) {
            return { error: 'Account is deactivated. Please contact HR.', status: 403 }
          }
          const userType = await authRepo.getUserTypeByEmployeeId(employee.employee_id) || 'User'
          const role = await resolveRoleForPermissions(employee.employee_id, userType)
          const permissions = await getEffectivePermissions(employee.employee_id, role)
          const isTechnician = role === 'Technician'
          const forcePasswordChange = isTechnician && (await authRepo.getUserForcePasswordChange(employee.employee_id))
          return {
            employeeId: employee.employee_id,
            name: `${employee.first_name || ''} ${employee.last_name || ''}`.trim(),
            email: employee.email || '',
            department: employee.department_name || employee.department_id || '',
            position: employee.position || '',
            userType: isTechnician ? 'Technician' : userType,
            permissions,
            forcePasswordChange: !!forcePasswordChange
          }
        }
        return { error: 'No portal account linked to this CRM user. Contact HR to set employee_code.', status: 401 }
      }
      // CRM invalid or no row (user not in CRM / wrong CRM password) → try portal (non-CRM technicians)
    } catch (err) {
      console.error('CRM login error:', err.message)
      // CRM unreachable: allow portal fallback so non-CRM users can still sign in
      if (process.env.CRM_FALLBACK_PORTAL === '0' || process.env.CRM_FALLBACK_PORTAL === 'false') {
        return { error: 'Login service temporarily unavailable. Try again later.', status: 503 }
      }
    }
  }

  return loginWithPortalCredentials(loginId, password)
}

export async function changePassword(employeeId, currentPassword, newPassword) {
  const userRows = await authRepo.getUserForPasswordChange(employeeId)

  if (userRows.length > 0) {
    const user = userRows[0]
    const hashToCheck = user.hashed_password
    if (!isBcryptHash(hashToCheck)) {
      return { error: 'Account password is not set up correctly. Please contact HR.', status: 401 }
    }
    const userValid = await bcrypt.compare(currentPassword, hashToCheck)
    if (userValid) {
      const saltRounds = 10
      const hashedPassword = await bcrypt.hash(newPassword, saltRounds)
      await authRepo.updateUserPassword(user.user_id, newPassword, hashedPassword, true)
      await authRepo.updatePassword(employeeId, hashedPassword)
      return { message: 'Password changed successfully', forcePasswordChange: false }
    }
  }

  const verifyResult = await authRepo.getEmployeeForPasswordChange(employeeId)
  if (verifyResult.length === 0) {
    return { error: 'Employee not found', status: 404 }
  }
  const employee = verifyResult[0]
  if (!isBcryptHash(employee.password_hash)) {
    return { error: 'Current password is incorrect', status: 401 }
  }
  const isValidPassword = await bcrypt.compare(currentPassword, employee.password_hash)
  if (!isValidPassword) {
    return { error: 'Current password is incorrect', status: 401 }
  }
  const saltRounds = 10
  const hashedPassword = await bcrypt.hash(newPassword, saltRounds)
  await authRepo.updatePassword(employeeId, hashedPassword)
  if (userRows.length > 0) {
    await authRepo.updateUserPassword(userRows[0].user_id, newPassword, hashedPassword, true)
  }
  return { message: 'Password changed successfully', forcePasswordChange: false }
}

export async function register(data) {
  const { employeeCode, firstName, lastName, email, password, phone, departmentId, position } = data
  const existing = await authRepo.findEmployeeByEmailForRegister(email)
  if (existing.length > 0) {
    return { error: 'Email already exists', status: 409 }
  }
  const saltRounds = 10
  const hashedPassword = await bcrypt.hash(password, saltRounds)
  const result = await authRepo.insertEmployee([
    employeeCode, firstName, lastName, email, phone || null,
    departmentId || null, position || null, hashedPassword
  ])
  if (result.length > 0) {
    await authRepo.initLeaveBalance(result[0].employee_id)
  }
  return {
    message: 'Employee registered successfully',
    employee: {
      employeeId: result[0].employee_id,
      name: `${result[0].first_name} ${result[0].last_name}`,
      email: result[0].email
    }
  }
}
