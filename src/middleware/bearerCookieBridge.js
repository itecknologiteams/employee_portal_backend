/**
 * Cross-site iframe auth bridge.
 *
 * A cross-site iframe parent (e.g. the CRM at a raw IP, http://192.168.20.244) makes the
 * emp session cookie third-party, which browsers block — so inside that iframe the SPA
 * cannot rely on the cookie. Instead it sends an `Authorization: Bearer <token>` header,
 * where <token> is the signed session id handed out by GET /api/auth/sso/consume.
 *
 * This middleware runs BEFORE express-session and, when there is a Bearer token but no
 * session cookie, injects the token as the `emp.portal.sid` cookie so express-session
 * parses + unsigns it exactly as a real cookie. Result: req.session loads normally and
 * every downstream route works unchanged. The normal cookie path (standalone / same-site
 * iot.itecknologi.com) is untouched — if a session cookie is already present, we no-op.
 */

const COOKIE_NAME = 'emp.portal.sid'

/**
 * Pure core: given the incoming Cookie header and Authorization header, return the Cookie
 * header value express-session should see, or null if nothing should change.
 * @param {string} cookieHeader raw req.headers.cookie ('' if none)
 * @param {string} authHeader raw req.headers.authorization ('' if none)
 * @returns {string|null}
 */
export function bridgeCookieHeader(cookieHeader, authHeader) {
  const cookie = cookieHeader || ''
  const auth = authHeader || ''
  if (!auth.startsWith('Bearer ')) return null
  // Respect an existing session cookie — the normal (first-party) path wins.
  if (cookie.includes(`${COOKIE_NAME}=`)) return null
  const token = auth.slice('Bearer '.length).trim()
  if (!token) return null
  return cookie ? `${cookie}; ${COOKIE_NAME}=${token}` : `${COOKIE_NAME}=${token}`
}

export function bearerCookieBridge(req, res, next) {
  const bridged = bridgeCookieHeader(req.headers.cookie, req.headers.authorization)
  if (bridged != null) req.headers.cookie = bridged
  next()
}
