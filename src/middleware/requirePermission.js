import { employeeHasPermission } from '../services/auth.service.js'

/**
 * Route guard: requires an authenticated session whose employee holds the given permission key.
 * 401 if not logged in, 403 if logged in without the permission. On success the resolved
 * employee id is attached as req.authEmployeeId for handlers to use.
 * @param {string} permissionKey e.g. 'payroll' (see config/permissions.js PERMISSION_KEYS)
 */
export function requirePermission(permissionKey) {
  return async (req, res, next) => {
    const employeeId = req.session?.user?.employeeId
    if (!employeeId) return res.status(401).json({ error: 'Authentication required' })
    try {
      const ok = await employeeHasPermission(employeeId, permissionKey)
      if (!ok) return res.status(403).json({ error: 'You do not have permission to access this resource' })
      req.authEmployeeId = employeeId
      next()
    } catch (err) {
      console.error('Permission check failed:', err?.message)
      res.status(500).json({ error: 'Permission check failed' })
    }
  }
}
