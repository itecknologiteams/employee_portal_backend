import * as svc from '../services/delegateAccess.service.js'

function isSuperAdmin(req) { return req.session?.user?.userType === 'SuperAdmin' }
function portalBase(req) { return (process.env.PORTAL_PUBLIC_URL || '').replace(/\/$/, '') || `${req.protocol}://${req.get('host')}` }
function clientIp(req) { return (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().split(',')[0].trim() }

export async function create(req, res) {
  if (!isSuperAdmin(req)) return res.status(403).json({ error: 'Forbidden' })
  try {
    const { employeeId, pages, expiryDays, landingPage } = req.body
    const r = await svc.createLink({ employeeId, pages, expiryDays, landingPage, createdBy: req.session.user.employeeId, baseUrl: portalBase(req) })
    if (r.error) return res.status(r.status).json({ error: r.error })
    res.json(r)
  } catch (e) { console.error('Delegate create error:', e); res.status(500).json({ error: 'Failed to create link' }) }
}

export async function list(req, res) {
  if (!isSuperAdmin(req)) return res.status(403).json({ error: 'Forbidden' })
  try { res.json(await svc.listLinks()) } catch (e) { console.error('Delegate list error:', e); res.status(500).json({ error: 'Failed to list links' }) }
}

export async function revoke(req, res) {
  if (!isSuperAdmin(req)) return res.status(403).json({ error: 'Forbidden' })
  try {
    const r = await svc.revokeLink(req.params.id, req.session.user.employeeId)
    if (r.error) return res.status(r.status).json({ error: r.error })
    res.json({ message: 'Link revoked' })
  } catch (e) { console.error('Delegate revoke error:', e); res.status(500).json({ error: 'Failed to revoke' }) }
}

export async function resend(req, res) {
  if (!isSuperAdmin(req)) return res.status(403).json({ error: 'Forbidden' })
  try {
    const r = await svc.resendEmail(req.params.id, portalBase(req))
    if (r.error) return res.status(r.status).json({ error: r.error })
    res.json(r)
  } catch (e) { console.error('Delegate resend error:', e); res.status(500).json({ error: 'Failed to resend' }) }
}

export async function events(req, res) {
  if (!isSuperAdmin(req)) return res.status(403).json({ error: 'Forbidden' })
  try { res.json(await svc.listEvents(req.params.id)) } catch (e) { console.error('Delegate events error:', e); res.status(500).json({ error: 'Failed to load events' }) }
}

export async function open(req, res) {
  try {
    const { token } = req.body
    if (!token) return res.status(400).json({ error: 'token required' })
    const r = await svc.openLink({ rawToken: String(token).trim(), ip: clientIp(req), userAgent: req.headers['user-agent'] || '' })
    if (r.error) return res.status(r.status).json({ error: r.error })
    res.json(r)
  } catch (e) { console.error('Delegate open error:', e); res.status(500).json({ error: 'Failed to open link' }) }
}

export async function verify(req, res) {
  try {
    const { token, otp } = req.body
    if (!token || !otp) return res.status(400).json({ error: 'token and otp required' })
    const r = await svc.verifyOtp({ rawToken: String(token).trim(), otp, ip: clientIp(req), userAgent: req.headers['user-agent'] || '' })
    if (r.error) return res.status(r.status).json({ error: r.error })
    req.session.user = r.sessionUser
    req.session.cookie.maxAge = r.cookieMaxAgeMs
    await new Promise((resolve, reject) => req.session.save((err) => (err ? reject(err) : resolve())))
    res.json(r.sessionUser)
  } catch (e) { console.error('Delegate verify error:', e); res.status(500).json({ error: 'Failed to verify code' }) }
}
