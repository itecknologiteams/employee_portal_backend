import { isEmployeeSsoRevoked } from '../../config/crmSso.js'
import { revokeNotificationStreamToken } from '../../config/notificationStream.js'

/**
 * If CRM called SSO invalidate, destroy portal session on next API request.
 */
export function ssoRevocationMiddleware(req, res, next) {
  if (!req.session?.user?.employeeId) return next()
  isEmployeeSsoRevoked(req.session.user.employeeId)
    .then((revoked) => {
      if (!revoked) return next()
      const tok = req.session?.notificationStreamToken
      if (tok) revokeNotificationStreamToken(tok).catch(() => {})
      req.session.destroy((err) => {
        if (err) console.error('ssoRevocation destroy:', err)
        res.clearCookie('emp.portal.sid')
        if (req.path.startsWith('/api')) {
          return res.status(401).json({ error: 'Session ended' })
        }
        next()
      })
    })
    .catch(() => next())
}
