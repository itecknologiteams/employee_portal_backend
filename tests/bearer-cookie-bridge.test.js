import { test } from 'node:test'
import assert from 'node:assert/strict'
import signature from 'cookie-signature'
import cookie from 'cookie'
import { bridgeCookieHeader } from '../src/middleware/bearerCookieBridge.js'
import { SESSION_SECRET } from '../config/sessionSecret.js'

test('bridgeCookieHeader: no Authorization → no change', () => {
  assert.equal(bridgeCookieHeader('', ''), null)
  assert.equal(bridgeCookieHeader('other=1', 'Basic abc'), null)
})

test('bridgeCookieHeader: existing session cookie wins (no-op)', () => {
  assert.equal(bridgeCookieHeader('emp.portal.sid=s%3Aabc', 'Bearer s:xyz.sig'), null)
})

test('bridgeCookieHeader: injects the bearer token as the session cookie', () => {
  assert.equal(bridgeCookieHeader('', 'Bearer s:xyz.sig'), 'emp.portal.sid=s:xyz.sig')
  assert.equal(bridgeCookieHeader('foo=1', 'Bearer s:xyz.sig'), 'foo=1; emp.portal.sid=s:xyz.sig')
})

test('bridgeCookieHeader: empty bearer value → no change', () => {
  assert.equal(bridgeCookieHeader('', 'Bearer '), null)
})

test('round-trip: signed session id survives sign → bridge → express-session parse/unsign', () => {
  const sessionId = 'aBc123_-xyzUID' // shape of an express-session sid (uid-safe base64url)
  const bearer = 's:' + signature.sign(sessionId, SESSION_SECRET)
  // Middleware injects it into the Cookie header when no cookie is present
  const injected = bridgeCookieHeader('', `Bearer ${bearer}`)
  assert.equal(injected, `emp.portal.sid=${bearer}`)
  // express-session then parses the Cookie header and unsigns the value
  const parsed = cookie.parse(injected)['emp.portal.sid']
  assert.ok(parsed.startsWith('s:'))
  const recovered = signature.unsign(parsed.slice(2), SESSION_SECRET)
  assert.equal(recovered, sessionId)
})
