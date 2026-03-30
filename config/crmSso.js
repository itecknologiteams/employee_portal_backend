/**
 * One-time CRM SSO tokens (Redis with in-memory fallback), session revocation flags,
 * and SSO active-status tracking (active / revoked / unknown).
 *
 * Status lifecycle:
 *   ssoConsume  → sets sso:active  (employee is SSO-enrolled and logged in)
 *   ssoInvalidate → sets sso:revoked (CRM logged them out; portal login blocked)
 *   ssoConsume again → clears sso:revoked, refreshes sso:active (CRM re-authorized)
 */
import crypto from 'crypto'
import { getConnection } from './bullmq.js'

const CONSUME_PREFIX = 'sso:consume:'
const REVOKE_PREFIX  = 'sso:revoked:'
const ACTIVE_PREFIX  = 'sso:active:'

const TTL_SEC        = parseInt(process.env.CRM_SSO_TOKEN_TTL_SEC  || '120', 10)
const REVOKE_TTL_SEC = parseInt(process.env.CRM_SSO_REVOKE_TTL_SEC || String(7 * 24 * 60 * 60), 10)
const ACTIVE_TTL_SEC = REVOKE_TTL_SEC   // same window as revoke

/** @type {Map<string, { employeeId: number, exp: number }>} */
const memoryConsume = new Map()
/** @type {Map<number, number>} employeeId -> revokedAt ms */
const memoryRevoked = new Map()
/** @type {Map<number, number>} employeeId -> activatedAt ms */
const memoryActive  = new Map()

const REVOKE_TTL_MS = REVOKE_TTL_SEC * 1000
const ACTIVE_TTL_MS = ACTIVE_TTL_SEC * 1000

function pruneMemoryConsume() {
  const now = Date.now()
  for (const [k, v] of memoryConsume) {
    if (v.exp <= now) memoryConsume.delete(k)
  }
}

// ─── One-time consume tokens ──────────────────────────────────────────────────

export async function issueSsoConsumeToken(employeeId) {
  const eid = parseInt(employeeId, 10)
  if (Number.isNaN(eid)) return null
  const token = crypto.randomBytes(32).toString('hex')
  try {
    const redis = getConnection()
    await redis.set(`${CONSUME_PREFIX}${token}`, String(eid), 'EX', TTL_SEC)
    return token
  } catch (e) {
    console.warn('issueSsoConsumeToken: Redis failed, using memory', e.message)
    pruneMemoryConsume()
    memoryConsume.set(token, { employeeId: eid, exp: Date.now() + TTL_SEC * 1000 })
    return token
  }
}

/** Validates and deletes token; returns employeeId or null. */
export async function consumeSsoToken(token) {
  if (!token || typeof token !== 'string') return null
  const t = token.trim()
  try {
    const redis = getConnection()
    const key = `${CONSUME_PREFIX}${t}`
    const v = await redis.get(key)
    if (v) {
      await redis.del(key)
      const n = parseInt(v, 10)
      return Number.isNaN(n) ? null : n
    }
  } catch (_) {}
  pruneMemoryConsume()
  const entry = memoryConsume.get(t)
  if (entry && entry.exp > Date.now()) {
    memoryConsume.delete(t)
    return entry.employeeId
  }
  return null
}

// ─── Revocation (CRM logout → block portal access) ───────────────────────────

export async function revokeSsoSessionsForEmployee(employeeId) {
  const eid = parseInt(employeeId, 10)
  if (Number.isNaN(eid)) return
  const now = String(Date.now())
  try {
    const redis = getConnection()
    await redis.set(`${REVOKE_PREFIX}${eid}`, now, 'EX', REVOKE_TTL_SEC)
  } catch (e) {
    console.warn('revokeSsoSessionsForEmployee: Redis failed, using memory', e.message)
    memoryRevoked.set(eid, Date.now())
  }
}

export async function isEmployeeSsoRevoked(employeeId) {
  const eid = parseInt(employeeId, 10)
  if (Number.isNaN(eid)) return false
  try {
    const redis = getConnection()
    const v = await redis.get(`${REVOKE_PREFIX}${eid}`)
    if (v) return true
  } catch (_) {}
  const at = memoryRevoked.get(eid)
  if (!at) return false
  if (Date.now() - at > REVOKE_TTL_MS) {
    memoryRevoked.delete(eid)
    return false
  }
  return true
}

/** Called only on SSO re-login (ssoConsume), NOT on manual portal login. */
export async function clearSsoRevocationForEmployee(employeeId) {
  const eid = parseInt(employeeId, 10)
  if (Number.isNaN(eid)) return
  try {
    await getConnection().del(`${REVOKE_PREFIX}${eid}`)
  } catch (_) {}
  memoryRevoked.delete(eid)
}

// ─── Active-status tracking (SSO-enrolled flag) ───────────────────────────────

/** Mark employee as SSO-enrolled and currently active (called on ssoConsume). */
export async function setSsoActiveForEmployee(employeeId) {
  const eid = parseInt(employeeId, 10)
  if (Number.isNaN(eid)) return
  const now = String(Date.now())
  try {
    const redis = getConnection()
    await redis.set(`${ACTIVE_PREFIX}${eid}`, now, 'EX', ACTIVE_TTL_SEC)
  } catch (e) {
    console.warn('setSsoActiveForEmployee: Redis failed, using memory', e.message)
    memoryActive.set(eid, Date.now())
  }
}

/**
 * Returns true if the employee has previously logged in via SSO (is SSO-enrolled)
 * AND their session has since been revoked by CRM.
 * Used to block manual portal login for SSO-enrolled employees.
 */
export async function isSsoEnrolledAndRevoked(employeeId) {
  const eid = parseInt(employeeId, 10)
  if (Number.isNaN(eid)) return false

  let enrolled = false
  try {
    const redis = getConnection()
    const v = await redis.get(`${ACTIVE_PREFIX}${eid}`)
    enrolled = !!v
  } catch (_) {
    const at = memoryActive.get(eid)
    enrolled = !!at && (Date.now() - at <= ACTIVE_TTL_MS)
  }

  if (!enrolled) return false
  return isEmployeeSsoRevoked(eid)
}

/**
 * Returns the current SSO status string for an employee:
 *   "active"  — SSO login done, not revoked
 *   "revoked" — CRM invalidated; portal login blocked
 *   "unknown" — no SSO interaction recorded (non-SSO employee)
 */
export async function getSsoStatus(employeeId) {
  const eid = parseInt(employeeId, 10)
  if (Number.isNaN(eid)) return 'unknown'

  const revoked = await isEmployeeSsoRevoked(eid)
  if (revoked) return 'revoked'

  try {
    const redis = getConnection()
    const v = await redis.get(`${ACTIVE_PREFIX}${eid}`)
    if (v) return 'active'
  } catch (_) {
    const at = memoryActive.get(eid)
    if (at && Date.now() - at <= ACTIVE_TTL_MS) return 'active'
  }

  return 'unknown'
}

export function getSsoTokenTtlSec() {
  return TTL_SEC
}
