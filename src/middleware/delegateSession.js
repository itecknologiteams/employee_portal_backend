import * as repo from '../repositories/delegateAccess.repository.js'
import { computeStatus, isDelegateActionRequest } from '../utils/delegateAccess.js'

export default async function delegateSessionMiddleware(req, res, next) {
  const del = req.session?.user?.delegate
  if (!req.session?.user || req.session.user.userType !== 'DelegateAccess' || !del) return next()
  try {
    const link = await repo.getLinkById(del.linkId)
    if (!link || computeStatus(link) !== 'active') {
      return req.session.destroy(() => {
        if (req.path.startsWith('/api')) return res.status(401).json({ error: 'Delegate access ended' })
        res.redirect('/login')
      })
    }
    if (isDelegateActionRequest(req.method, req.path)) {
      await repo.touchLastUsed(link.id)
      await repo.logEvent({ linkId: link.id, eventType: 'action', detail: `${req.method} ${req.path}` })
    }
    next()
  } catch (e) {
    console.error('delegateSession middleware error:', e.message)
    next()
  }
}
