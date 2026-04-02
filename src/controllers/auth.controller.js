import crypto from 'crypto'
import * as authService from '../services/auth.service.js'
import { issueNotificationStreamToken, revokeNotificationStreamToken } from '../../config/notificationStream.js'
import {
  issueSsoConsumeToken,
  consumeSsoToken,
  revokeSsoSessionsForEmployee,
  getSsoTokenTtlSec,
  clearSsoRevocationForEmployee,
  setSsoActiveForEmployee,
  getSsoStatus
} from '../../config/crmSso.js'
import { getEmployeeIdByCode } from '../repositories/auth.repository.js'

const REMEMBER_ME_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

function timingSafeEqualStr(a, b) {
  if (a == null || b == null) return false
  const ba = Buffer.from(String(a), 'utf8')
  const bb = Buffer.from(String(b), 'utf8')
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

function requireCrmSsoConfigured(req, res) {
  const secret = process.env.CRM_SSO_SECRET
  const minLen = process.env.NODE_ENV === 'development' ? 24 : 8
  if (!secret || String(secret).length < minLen) {
    res.status(503).json({ error: 'CRM SSO is not configured (set CRM_SSO_SECRET)' })
    return false
  }
  const got =
    req.headers['x-crm-sso-secret'] ||
    (typeof req.headers.authorization === 'string' && /^Bearer\s+(.+)$/i.exec(req.headers.authorization)?.[1])
  if (!timingSafeEqualStr(got, secret)) {
    res.status(401).json({ error: 'Unauthorized' })
    return false
  }
  return true
}

function portalPublicBase(req) {
  return (process.env.PORTAL_PUBLIC_URL || '').replace(/\/$/, '') || `${req.protocol}://${req.get('host')}`
}

/** Same-origin path only (prevents open redirects). */
function safeRedirectPath(baseUrl, redirect) {
  if (!redirect || typeof redirect !== 'string') return '/'
  try {
    const base = new URL(baseUrl)
    const u = new URL(redirect, baseUrl)
    if (u.origin !== base.origin) return '/'
    return u.pathname + u.search + u.hash || '/'
  } catch (_) {
    return '/'
  }
}

export async function login(req, res) {
  try {
    const { username, email, password, rememberMe } = req.body
    const loginId = username || email
    if (!loginId || !password) {
      return res.status(400).json({ error: 'Username/email and password are required' })
    }
    const result = await authService.login(loginId, password)
    if (result.error) {
      return res.status(result.status || 401).json({ error: result.error })
    }
    if (rememberMe) {
      req.session.cookie.maxAge = REMEMBER_ME_MAX_AGE_MS
    }
    req.session.user = {
      employeeId: result.employeeId,
      employeeCode: result.employeeCode || '',
      name: result.name,
      email: result.email,
      department: result.department,
      position: result.position,
      userType: result.userType,
      permissions: result.permissions || [],
      forcePasswordChange: result.forcePasswordChange === true
    }
    const streamToken = await issueNotificationStreamToken(result.employeeId)
    if (streamToken) req.session.notificationStreamToken = streamToken
    await new Promise((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()))
    })
    const payload = { ...result }
    if (streamToken) payload.notificationStreamToken = streamToken
    res.json(payload)
  } catch (error) {
    console.error('Login error:', error)
    res.status(500).json({ error: 'Failed to login. Please try again.' })
  }
}

/** GET /api/auth/me – return current session user or 401. Used by frontend to restore session. */
export async function me(req, res) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Not authenticated' })
  }
  res.json(req.session.user)
}

/** POST /api/auth/logout – destroy session. */
export async function logout(req, res) {
  const tok = req.session?.notificationStreamToken
  if (tok) revokeNotificationStreamToken(tok).catch(() => {})
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout session destroy error:', err)
      return res.status(500).json({ error: 'Logout failed' })
    }
    res.clearCookie('emp.portal.sid')
    res.json({ ok: true, message: 'Logged out' })
  })
}

export async function changePassword(req, res) {
  try {
    const { employeeCode, employeeId: legacyEmployeeId, currentPassword, newPassword } = req.body
    if ((!employeeCode && !legacyEmployeeId) || !currentPassword || !newPassword) {
      return res.status(400).json({ error: 'All fields are required' })
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' })
    }
    let resolvedId = legacyEmployeeId
    if (employeeCode) {
      resolvedId = await getEmployeeIdByCode(employeeCode)
      if (!resolvedId) return res.status(404).json({ error: 'Employee not found' })
    }
    const result = await authService.changePassword(resolvedId, currentPassword, newPassword)
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error })
    }
    res.json(result)
  } catch (error) {
    console.error('Change password error:', error)
    res.status(500).json({ error: 'Failed to change password' })
  }
}

export async function register(req, res) {
  try {
    const { employeeCode, firstName, lastName, email, password, phone, departmentId, position } = req.body
    if (!employeeCode || !firstName || !lastName || !email || !password) {
      return res.status(400).json({ error: 'Required fields are missing' })
    }
    const result = await authService.register({
      employeeCode, firstName, lastName, email, password, phone, departmentId, position
    })
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error })
    }
    res.status(201).json(result)
  } catch (error) {
    console.error('Registration error:', error)
    res.status(500).json({ error: 'Failed to register employee' })
  }
}

/**
 * POST /api/auth/sso/prepare — CRM backend only. Returns one-time token and iframe consume URL.
 * Body: { employeeCode?: string, employeeId?: number } (at least one required)
 */
export async function ssoPrepare(req, res) {
  try {
    if (!requireCrmSsoConfigured(req, res)) return
    const { employeeCode, employeeId } = req.body || {}
    if (
      (employeeCode == null || String(employeeCode).trim() === '') &&
      (employeeId == null || employeeId === '')
    ) {
      return res.status(400).json({ error: 'employeeCode or employeeId is required' })
    }
    const employee = await authService.resolveEmployeeForCrmSso({ employeeCode, employeeId })
    if (!employee) {
      return res.status(404).json({ error: 'No portal account for this employee' })
    }
    const result = await authService.sessionLoginPayloadFromEmployeeRow(employee)
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error })
    }
    const token = await issueSsoConsumeToken(result.employeeId)
    if (!token) {
      return res.status(500).json({ error: 'Could not issue SSO token' })
    }
    const base = portalPublicBase(req)
    const consumeUrl = `${base}/api/auth/sso/consume?token=${encodeURIComponent(token)}`
    res.json({
      token,
      expiresInSec: getSsoTokenTtlSec(),
      consumeUrl
    })
  } catch (error) {
    console.error('ssoPrepare error:', error)
    res.status(500).json({ error: 'SSO prepare failed' })
  }
}

/**
 * GET /api/auth/sso/consume?token=...&redirect=/optional/path — browser / iframe; sets session cookie.
 * Cookie is SameSite=None; Secure so it works inside cross-origin iframes (see app.js).
 */
export async function ssoConsume(req, res) {
  try {
    const token = req.query.token
    const employeeId = await consumeSsoToken(token)
    if (!employeeId) {
      return res.status(400).send('<!DOCTYPE html><html><body><p>Invalid or expired SSO link. Close this window and sign in again from CRM.</p></body></html>')
    }
    const employee = await authService.resolveEmployeeForCrmSso({ employeeId })
    if (!employee) {
      return res.status(404).send('<!DOCTYPE html><html><body><p>Portal account not found.</p></body></html>')
    }
    const result = await authService.sessionLoginPayloadFromEmployeeRow(employee)
    if (result.error) {
      return res.status(result.status || 400).send(`<!DOCTYPE html><html><body><p>${String(result.error)}</p></body></html>`)
    }
    req.session.user = {
      employeeId: result.employeeId,
      employeeCode: result.employeeCode || '',
      name: result.name,
      email: result.email,
      department: result.department,
      position: result.position,
      userType: result.userType,
      permissions: result.permissions || [],
      forcePasswordChange: result.forcePasswordChange === true
    }
    await setSsoActiveForEmployee(result.employeeId)
    await clearSsoRevocationForEmployee(result.employeeId)
    const streamToken = await issueNotificationStreamToken(result.employeeId)
    if (streamToken) req.session.notificationStreamToken = streamToken

    await new Promise((resolve, reject) => req.session.save((err) => err ? reject(err) : resolve()))

    const base = portalPublicBase(req)
    const target = safeRedirectPath(base, req.query.redirect)
    res.redirect(302, target)
  } catch (error) {
    console.error('ssoConsume error:', error)
    res.status(500).send('<!DOCTYPE html><html><body><p>SSO failed</p></body></html>')
  }
}

/**
 * POST /api/auth/sso/invalidate — CRM backend: mark user sessions invalid (portal logs out on next request).
 * Body: { employeeId?: number, employeeCode?: string }
 */
export async function ssoInvalidate(req, res) {
  try {
    if (!requireCrmSsoConfigured(req, res)) return
    const { employeeCode, employeeId } = req.body || {}
    let eid = employeeId != null && employeeId !== '' ? parseInt(employeeId, 10) : NaN
    if (Number.isNaN(eid) && employeeCode != null && String(employeeCode).trim() !== '') {
      const employee = await authService.resolveEmployeeForCrmSso({ employeeCode })
      if (!employee) {
        return res.status(404).json({ error: 'No portal account for this employee' })
      }
      eid = employee.employee_id
    }
    if (Number.isNaN(eid)) {
      return res.status(400).json({ error: 'employeeId or employeeCode is required' })
    }
    await revokeSsoSessionsForEmployee(eid)
    res.json({ ok: true, employeeId: eid, ssoStatus: 'revoked' })
  } catch (error) {
    console.error('ssoInvalidate error:', error)
    res.status(500).json({ error: 'SSO invalidate failed' })
  }
}

/**
 * POST /api/auth/sso/session — Unified CRM endpoint.
 * Body: { employeeCode: string, isActive: boolean }
 *   isActive: true  → login  (issues SSO token + consumeUrl for browser redirect)
 *   isActive: false → logout (revokes session; portal login blocked until re-auth)
 */
export async function ssoSession(req, res) {
  try {
    if (!requireCrmSsoConfigured(req, res)) return

    const { employeeCode, isActive } = req.body || {}

    if (!employeeCode || String(employeeCode).trim() === '') {
      return res.status(400).json({ error: 'employeeCode is required' })
    }
    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive must be true or false' })
    }

    const employee = await authService.resolveEmployeeForCrmSso({ employeeCode: String(employeeCode).trim() })
    if (!employee) {
      return res.status(404).json({ error: 'No portal account for this employee' })
    }

    // ── isActive: false → LOGOUT ──────────────────────────────────────────────
    if (!isActive) {
      await revokeSsoSessionsForEmployee(employee.employee_id)
      return res.json({
        ok: true,
        employeeCode: String(employeeCode).trim(),
        isActive: false,
        ssoStatus: 'revoked',
        message: 'Session revoked. Portal login blocked until CRM re-authenticates.'
      })
    }

    // ── isActive: true → LOGIN ────────────────────────────────────────────────
    const result = await authService.sessionLoginPayloadFromEmployeeRow(employee)
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error })
    }

    const token = await issueSsoConsumeToken(result.employeeId)
    if (!token) {
      return res.status(500).json({ error: 'Could not issue SSO token' })
    }

    const base = portalPublicBase(req)
    const consumeUrl = `${base}/api/auth/sso/consume?token=${encodeURIComponent(token)}`

    return res.json({
      ok: true,
      employeeCode: String(employeeCode).trim(),
      isActive: true,
      ssoStatus: 'pending',
      token,
      expiresInSec: getSsoTokenTtlSec(),
      consumeUrl,
      message: 'Redirect browser to consumeUrl to complete login.'
    })
  } catch (error) {
    console.error('ssoSession error:', error)
    res.status(500).json({ error: 'SSO session operation failed' })
  }
}

/**
 * GET /api/auth/sso/status?employeeCode=10001 — CRM backend: check current SSO status for an employee.
 * Returns: { employeeCode, status: "active" | "revoked" | "unknown" }
 */
export async function ssoStatus(req, res) {
  try {
    if (!requireCrmSsoConfigured(req, res)) return
    const rawCode = req.query.employeeCode
    if (!rawCode || String(rawCode).trim() === '') {
      return res.status(400).json({ error: 'employeeCode query param is required' })
    }
    const employee = await authService.resolveEmployeeForCrmSso({ employeeCode: String(rawCode).trim() })
    if (!employee) {
      return res.status(404).json({ error: 'No portal account for this employee' })
    }
    const status = await getSsoStatus(employee.employee_id)
    res.json({
      employeeCode: rawCode.trim(),
      employeeId: employee.employee_id,
      status
    })
  } catch (error) {
    console.error('ssoStatus error:', error)
    res.status(500).json({ error: 'SSO status check failed' })
  }
}
