import * as rolePermissionsRepo from '../repositories/rolePermissions.repository.js'

const ROLES = ['Admin', 'Staff', 'User']
const PERMISSION_KEYS = [
  'dashboard',
  'profile',
  'salary_slip',
  'leave',
  'feedback',
  'requisition_create',
  'requisition_pending',
  'requisition_approved',
  'requisition_reports',
  'requisition_history',
  'tat_report',
  'extensions',
  'administration',
  'payroll'
]

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

function buildByRoleFromRows(rows) {
  const byRole = {}
  ROLES.forEach(r => { byRole[r] = {} })
  PERMISSION_KEYS.forEach(k => {
    ROLES.forEach(r => { byRole[r][k] = false })
  })
  rows.forEach(({ role_name, permission_key, allowed }) => {
    if (byRole[role_name] && PERMISSION_KEYS.includes(permission_key)) {
      byRole[role_name][permission_key] = !!allowed
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
