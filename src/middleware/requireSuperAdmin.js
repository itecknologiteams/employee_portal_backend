import * as authRepo from '../repositories/auth.repository.js'

/** Pure decision: given the resolved employeeId and the DB user_type, decide the outcome. */
export function evaluateSuperAdmin(employeeId, userType) {
  if (!employeeId) return { ok: false, status: 401 }
  if (userType !== 'SuperAdmin') return { ok: false, status: 403 }
  return { ok: true, status: 200 }
}

/**
 * Route guard: requires an authenticated session whose user is the SuperAdmin.
 * Verifies the role against the DB (users.user_type), not the session value.
 */
export function requireSuperAdmin() {
  return async (req, res, next) => {
    const employeeId = req.session?.user?.employeeId
    if (!employeeId) return res.status(401).json({ error: 'Authentication required' })
    try {
      const userType = await authRepo.getUserTypeByEmployeeId(employeeId)
      const verdict = evaluateSuperAdmin(employeeId, userType)
      if (!verdict.ok) return res.status(verdict.status).json({ error: 'SuperAdmin access required' })
      req.authEmployeeId = employeeId
      next()
    } catch (err) {
      console.error('SuperAdmin check failed:', err?.message)
      res.status(500).json({ error: 'SuperAdmin check failed' })
    }
  }
}
