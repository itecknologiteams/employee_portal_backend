import * as notificationService from '../services/notification.service.js'
import { getVapidPublicKey } from '../../config/push.js'
import { registerSseClient } from '../../config/sse.js'
import { getEmployeeIdFromNotificationStreamToken } from '../../config/notificationStream.js'

function sessionEmployeeId(req) {
  const id = req.session?.user?.employeeId
  if (id == null) return null
  const n = parseInt(id, 10)
  return Number.isNaN(n) ? null : n
}

async function resolveStreamEmployeeId(req) {
  const fromSession = sessionEmployeeId(req)
  const token = typeof req.query.token === 'string' ? req.query.token.trim() : ''
  const fromToken = token ? await getEmployeeIdFromNotificationStreamToken(token) : null
  const qid = req.query.employeeId != null && req.query.employeeId !== ''
    ? parseInt(req.query.employeeId, 10)
    : null
  if (fromSession != null) {
    if (qid != null && !Number.isNaN(qid) && qid !== fromSession) return null
    return fromSession
  }
  if (fromToken != null) {
    if (qid != null && !Number.isNaN(qid) && qid !== fromToken) return null
    return fromToken
  }
  return null
}

export async function vapidPublicKey(req, res) {
  const key = getVapidPublicKey()
  if (!key) return res.status(503).json({ error: 'VAPID not configured' })
  res.json({ publicKey: key })
}

export async function stream(req, res) {
  try {
    const eid = await resolveStreamEmployeeId(req)
    if (eid == null) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    registerSseClient(eid, res)
  } catch (e) {
    console.error('notification stream error:', e)
    if (!res.headersSent) res.status(500).end()
  }
}

export async function list(req, res) {
  const eid = sessionEmployeeId(req)
  if (eid == null) return res.status(401).json({ error: 'Unauthorized' })
  const unreadOnly = req.query.unreadOnly === '1' || req.query.unreadOnly === 'true'
  const page = parseInt(req.query.page, 10) || 1
  const limit = parseInt(req.query.limit, 10) || 20
  try {
    const { rows, total } = await notificationService.listNotifications(eid, { unreadOnly, page, limit })
    res.json({ data: rows, pagination: { page, limit, total } })
  } catch (e) {
    console.error('notification list error:', e)
    res.status(500).json({ error: 'Failed to load notifications' })
  }
}

export async function unreadCount(req, res) {
  const eid = sessionEmployeeId(req)
  if (eid == null) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const count = await notificationService.getUnreadCount(eid)
    res.json({ count })
  } catch (e) {
    res.status(500).json({ error: 'Failed to get count' })
  }
}

export async function markRead(req, res) {
  const eid = sessionEmployeeId(req)
  if (eid == null) return res.status(401).json({ error: 'Unauthorized' })
  const id = parseInt(req.params.id, 10)
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' })
  try {
    const ok = await notificationService.markAsRead(id, eid)
    if (!ok) return res.status(404).json({ error: 'Not found' })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: 'Failed to update' })
  }
}

export async function markAllRead(req, res) {
  const eid = sessionEmployeeId(req)
  if (eid == null) return res.status(401).json({ error: 'Unauthorized' })
  try {
    await notificationService.markAllAsRead(eid)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: 'Failed to update' })
  }
}

export async function subscribe(req, res) {
  const eid = sessionEmployeeId(req)
  if (eid == null) return res.status(401).json({ error: 'Unauthorized' })
  const { subscription } = req.body || {}
  if (!subscription) return res.status(400).json({ error: 'subscription required' })
  try {
    await notificationService.savePushSubscription(eid, subscription, req.headers['user-agent'])
    res.json({ ok: true })
  } catch (e) {
    console.error('push subscribe error:', e)
    res.status(500).json({ error: 'Failed to save subscription' })
  }
}

export async function unsubscribe(req, res) {
  const eid = sessionEmployeeId(req)
  if (eid == null) return res.status(401).json({ error: 'Unauthorized' })
  try {
    await notificationService.removeAllPushSubscriptions(eid)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: 'Failed to remove subscriptions' })
  }
}
