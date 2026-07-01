import * as rolePermissionsRepo from '../repositories/rolePermissions.repository.js'
import { PERMISSION_KEYS } from '../../config/permissions.js'

const ROLES = ['Admin', 'Staff', 'User', 'Technician']

/** Permission key in camelCase (e.g. salary_slip -> salarySlip) for frontend compatibility. */
function toCamelCase(key) {
  return key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}

/** Get allowed value from payload: accept both snake_case and camelCase keys so frontend can send either. */
function getAllowedFromPerms(perms, key) {
  if (perms == null || typeof perms !== 'object') return false
  if (key in perms) return !!perms[key]
  const camel = toCamelCase(key)
  return !!perms[camel]
}

/** True if payload has this key (snake or camel) so we can do merge semantics and not overwrite missing keys. */
function permKeyPresentInPayload(perms, key) {
  if (perms == null || typeof perms !== 'object') return false
  return key in perms || toCamelCase(key) in perms
}

/** Match DB role name to canonical ROLES (case-insensitive) so Technician is always returned correctly. */
function matchRoleName(roleName) {
  if (!roleName || typeof roleName !== 'string') return null
  const lower = roleName.trim().toLowerCase()
  return ROLES.find((r) => r.toLowerCase() === lower) || null
}

function buildByRoleFromRows(rows) {
  const byRole = {}
  ROLES.forEach(r => { byRole[r] = {} })
  PERMISSION_KEYS.forEach(k => {
    ROLES.forEach(r => { byRole[r][k] = false })
  })
  rows.forEach((row) => {
    const roleName = row.role_name ?? row.roleName ?? row.role
    const permissionKey = row.permission_key ?? row.permissionKey ?? row.permission
    const allowed = row.allowed === true || row.allowed === 'true'
    const role = matchRoleName(roleName)
    if (role && byRole[role] && PERMISSION_KEYS.includes(permissionKey)) {
      byRole[role][permissionKey] = !!allowed
    }
  })
  return byRole
}

export async function ensureSuperAdmin(employeeId) {
  return rolePermissionsRepo.ensureSuperAdmin(employeeId)
}

export async function getPermissions() {
  const rows = await rolePermissionsRepo.getAllRolePermissions()
  return { permissions: buildByRoleFromRows(rows) }
}

export async function savePermissions(permissions) {
  if (!permissions || typeof permissions !== 'object') {
    return { error: 'Invalid permissions payload.' }
  }
  for (const role of ROLES) {
    const perms = permissions[role]
    if (!perms || typeof perms !== 'object') continue
    for (const key of PERMISSION_KEYS) {
      if (!permKeyPresentInPayload(perms, key)) continue
      const allowed = getAllowedFromPerms(perms, key)
      await rolePermissionsRepo.upsertRolePermission(role, key, allowed)
    }
  }
  const rows = await rolePermissionsRepo.getAllRolePermissions()
  return { permissions: buildByRoleFromRows(rows) }
}
