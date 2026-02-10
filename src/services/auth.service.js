import bcrypt from 'bcryptjs'
import * as authRepo from '../repositories/auth.repository.js'

const ALL_PERMISSION_KEYS = [
  'dashboard', 'profile', 'salary_slip', 'leave', 'feedback',
  'requisition_create', 'requisition_pending', 'requisition_approved',
  'requisition_reports', 'requisition_history', 'tat_report',
  'extensions', 'administration', 'payroll'
]

const DEFAULT_USER_PERMISSIONS = [
  'profile', 'salary_slip', 'leave', 'feedback',
  'requisition_create', 'requisition_approved', 'requisition_history'
]

async function getPermissionsForRole(roleName) {
  if (roleName === 'SuperAdmin') return [...ALL_PERMISSION_KEYS]
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
  debugger
  if (roleName === 'SuperAdmin') return [...ALL_PERMISSION_KEYS]
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

export async function login(loginId, password) {
  try {
    const userRows = await authRepo.findUserByUsername(loginId)
    if (userRows.length > 0) {
      const row = userRows[0]
      if (!row.is_active) {
        return { error: 'Account is deactivated. Please contact HR.', status: 403 }
      }
      const valid = row.password.startsWith('$2a$')
        ? await bcrypt.compare(password, row.password)
        : (row.password === password)
      if (valid) {
        const permissions = await getEffectivePermissions(row.emp_id, row.user_type)
        return {
          employeeId: row.emp_id,
          name: `${row.first_name || ''} ${row.last_name || ''}`.trim(),
          email: row.email,
          department: row.department_name || '',
          position: '',
          userType: row.user_type,
          permissions
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
  let isValidPassword = false
  if (employee.password_hash && employee.password_hash.startsWith('$2a$')) {
    isValidPassword = await bcrypt.compare(password, employee.password_hash)
  } else if (employee.password_hash) {
    isValidPassword = (employee.password_hash === password)
  } else if (employee.password) {
    isValidPassword = (employee.password === password)
  }
  if (!isValidPassword) {
    return { error: 'Invalid username/email or password', status: 401 }
  }
  const permissions = await getEffectivePermissions(employee.employee_id, 'User')
  return {
    employeeId: employee.employee_id,
    name: `${employee.first_name || ''} ${employee.last_name || ''}`.trim(),
    email: employee.email,
    department: employee.department_name || employee.department_id,
    position: employee.position,
    userType: 'User',
    permissions
  }
}

export async function changePassword(employeeId, currentPassword, newPassword) {
  const verifyResult = await authRepo.getEmployeeForPasswordChange(employeeId)
  if (verifyResult.length === 0) {
    return { error: 'Employee not found', status: 404 }
  }
  const employee = verifyResult[0]
  let isValidPassword = false
  if (employee.password_hash && employee.password_hash.startsWith('$2a$')) {
    isValidPassword = await bcrypt.compare(currentPassword, employee.password_hash)
  } else {
    isValidPassword = (employee.password_hash === currentPassword || employee.password === currentPassword)
  }
  if (!isValidPassword) {
    return { error: 'Current password is incorrect', status: 401 }
  }
  const saltRounds = 10
  const hashedPassword = await bcrypt.hash(newPassword, saltRounds)
  await authRepo.updatePassword(employeeId, hashedPassword)
  return { message: 'Password changed successfully' }
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
