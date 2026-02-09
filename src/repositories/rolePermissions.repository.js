import { executeQuery } from '../../config/database.js'

/** Returns 'SuperAdmin' if the employee is SuperAdmin, else null. */
export async function ensureSuperAdmin(employeeId) {
  if (!employeeId) return null
  const rows = await executeQuery(
    'SELECT user_type FROM users WHERE emp_id = $1',
    [employeeId]
  )
  if (rows.length === 0) return null
  return rows[0].user_type === 'SuperAdmin' ? rows[0].user_type : null
}

export async function getAllRolePermissions() {
  return executeQuery(
    'SELECT role_name, permission_key, allowed FROM role_permissions ORDER BY role_name, permission_key'
  )
}

export async function upsertRolePermission(roleName, permissionKey, allowed) {
  await executeQuery(
    `INSERT INTO role_permissions (role_name, permission_key, allowed)
     VALUES ($1, $2, $3)
     ON CONFLICT (role_name, permission_key) DO UPDATE SET allowed = $3`,
    [roleName, permissionKey, !!allowed]
  )
}
