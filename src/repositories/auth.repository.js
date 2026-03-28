import { executeQuery } from '../../config/database.js'

export async function findUserByUsername(loginId) {
  return executeQuery(
    `SELECT u.user_id, u.username, u.password, u.hashed_password, u.force_password_change, u.user_type, u.emp_id,
        e.employee_id, e.first_name, e.last_name, e.email, e.is_active,
        d.department_name
     FROM users u
     JOIN employees e ON u.emp_id = e.employee_id
     LEFT JOIN departments d ON e.department_id = d.department_id
     WHERE u.username = $1`,
    [loginId]
  )
}

export async function findEmployeeByEmail(loginId) {
  return executeQuery(
    `SELECT e.employee_id, e.first_name, e.last_name, e.email, e.department_id,
        d.department_name, e.position, e.password_hash, e.password, e.is_active
     FROM employees e
     LEFT JOIN departments d ON e.department_id = d.department_id
     WHERE e.email = $1`,
    [loginId]
  )
}

/** Find portal employee by employee_code (e.g. CRM HR_Emp_ID) for CRM login match. */
export async function findEmployeeByEmployeeCode(employeeCode) {
  return executeQuery(
    `SELECT e.employee_id, e.first_name, e.last_name, e.email, e.department_id,
        d.department_name, e.position, e.is_active
     FROM employees e
     LEFT JOIN departments d ON e.department_id = d.department_id
     WHERE e.employee_code = $1`,
    [String(employeeCode).trim()]
  )
}

/** Same row shape as findEmployeeByEmployeeCode, keyed by portal employee_id (CRM SSO). */
export async function findEmployeeByEmployeeId(employeeId) {
  return executeQuery(
    `SELECT e.employee_id, e.first_name, e.last_name, e.email, e.department_id,
        d.department_name, e.position, e.is_active
     FROM employees e
     LEFT JOIN departments d ON e.department_id = d.department_id
     WHERE e.employee_id = $1`,
    [employeeId]
  )
}

/** Get user_type and force_password_change for an employee (from users table). */
export async function getUserTypeByEmployeeId(employeeId) {
  const rows = await executeQuery(
    'SELECT user_type FROM users WHERE emp_id = $1',
    [employeeId]
  )
  return rows[0]?.user_type ?? null
}

export async function getUserForcePasswordChange(employeeId) {
  const rows = await executeQuery(
    'SELECT force_password_change FROM users WHERE emp_id = $1',
    [employeeId]
  )
  return rows[0]?.force_password_change === true
}

/** Designation name for employee (e.g. to detect Technician). */
export async function getDesignationNameByEmployeeId(employeeId) {
  if (!employeeId) return null
  const rows = await executeQuery(
    `SELECT d.desg_name FROM employees e
     LEFT JOIN designation d ON e.designation_id = d.desg_id
     WHERE e.employee_id = $1`,
    [employeeId]
  )
  return rows[0]?.desg_name ?? null
}

export async function getEmployeeForPasswordChange(employeeId) {
  return executeQuery(
    'SELECT employee_id, password_hash, password FROM employees WHERE employee_id = $1',
    [employeeId]
  )
}

export async function getUserForPasswordChange(employeeId) {
  return executeQuery(
    'SELECT user_id, password, hashed_password FROM users WHERE emp_id = $1',
    [employeeId]
  )
}

/** Update hashed_password and optionally clear force_password_change. Plaintext is never stored. */
export async function updateUserPassword(userId, _plainPassword, hashedPassword, clearForceChange = false) {
  if (clearForceChange) {
    return executeQuery(
      'UPDATE users SET hashed_password = $1, force_password_change = false WHERE user_id = $2',
      [hashedPassword, userId]
    )
  }
  return executeQuery(
    'UPDATE users SET hashed_password = $1 WHERE user_id = $2',
    [hashedPassword, userId]
  )
}

export async function updatePassword(employeeId, hashedPassword) {
  return executeQuery(
    `UPDATE employees SET password_hash = $1, password_updated_at = CURRENT_TIMESTAMP WHERE employee_id = $2`,
    [hashedPassword, employeeId]
  )
}

export async function findEmployeeByEmailForRegister(email) {
  return executeQuery('SELECT employee_id FROM employees WHERE email = $1', [email])
}

export async function insertEmployee(employeeData) {
  const query = `
    INSERT INTO employees (
      employee_code, first_name, last_name, email, phone, department_id,
      position, password_hash, join_date, is_active
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_DATE, true)
    RETURNING employee_id, first_name, last_name, email
  `
  return executeQuery(query, employeeData)
}

export async function initLeaveBalance(employeeId) {
  return executeQuery(
    'INSERT INTO leave_balance (employee_id, annual_leave, sick_leave, personal_leave) VALUES ($1, 15, 10, 5)',
    [employeeId]
  )
}

export async function getRolePermissions(roleName) {
  return executeQuery(
    'SELECT permission_key FROM role_permissions WHERE role_name = $1 AND allowed = true',
    [roleName]
  )
}

export async function getUserPermissionOverrides(empId) {
  return executeQuery(
    'SELECT permission_key, allowed FROM user_permissions WHERE emp_id = $1',
    [empId]
  )
}
