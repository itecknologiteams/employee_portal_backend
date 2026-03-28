/**
 * One-time CRM SSO tokens (Redis with in-memory fallback) and session revocation flags.
 */
import crypto from 'crypto'
import { getConnection } from './bullmq.js'

const CONSUME_PREFIX = 'sso:consume:'
const REVOKE_PREFIX = 'sso:revoked:'
const TTL_SEC = parseInt(process.env.CRM_SSO_TOKEN_TTL_SEC || '120', 10)
const REVOKE_TTL_SEC = parseInt(process.env.CRM_SSO_REVOKE_TTL_SEC || String(7 * 24 * 60 * 60), 10)

/** @type {Map<string, { employeeId: number, exp: number }>} */
const memoryConsume = new Map()
/** @type {Map<number, number>} employeeId -> revokedAt ms */
const memoryRevoked = new Map()
const REVOKE_TTL_MS = REVOKE_TTL_SEC * 1000

function pruneMemoryConsume() {
  const now = Date.now()
  for (const [k, v] of memoryConsume) {
    if (v.exp <= now) memoryConsume.delete(k)
  }
}

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

export async function revokeSsoSessionsForEmployee(employeeId) {
  const eid = parseInt(employeeId, 10)
  if (Number.isNaN(eid)) return
  try {
    const redis = getConnection()
    await redis.set(`${REVOKE_PREFIX}${eid}`, String(Date.now()), 'EX', REVOKE_TTL_SEC)
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

/** Call after successful password/SSO login so a prior CRM invalidate does not block re-entry. */
export async function clearSsoRevocationForEmployee(employeeId) {
  const eid = parseInt(employeeId, 10)
  if (Number.isNaN(eid)) return
  try {
    await getConnection().del(`${REVOKE_PREFIX}${eid}`)
  } catch (_) {}
  memoryRevoked.delete(eid)
}

export function getSsoTokenTtlSec() {
  return TTL_SEC
}
