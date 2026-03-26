/**
 * Long-lived SSE auth tokens for Electron / clients without browser cookies.
 * Stored in Redis alongside BullMQ (same ioredis connection).
 */
import crypto from 'crypto'
import { getConnection } from './bullmq.js'

const PREFIX = 'notifstream:'
const TTL_SEC = parseInt(process.env.NOTIFICATION_STREAM_TOKEN_TTL_SEC || String(7 * 24 * 60 * 60), 10)

export async function issueNotificationStreamToken(employeeId) {
  const eid = parseInt(employeeId, 10)
  if (Number.isNaN(eid)) return null
  const token = crypto.randomBytes(32).toString('hex')
  try {
    const redis = getConnection()
    await redis.set(`${PREFIX}${token}`, String(eid), 'EX', TTL_SEC)
    return token
  } catch (e) {
    console.warn('issueNotificationStreamToken: Redis failed', e.message)
    return null
  }
}

export async function getEmployeeIdFromNotificationStreamToken(token) {
  if (!token || typeof token !== 'string') return null
  try {
    const redis = getConnection()
    const v = await redis.get(`${PREFIX}${token.trim()}`)
    if (!v) return null
    const n = parseInt(v, 10)
    return Number.isNaN(n) ? null : n
  } catch {
    return null
  }
}

export async function revokeNotificationStreamToken(token) {
  if (!token) return
  try {
    await getConnection().del(`${PREFIX}${token.trim()}`)
  } catch (_) {}
}
