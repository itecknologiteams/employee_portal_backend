import { getConnection } from '../../config/bullmq.js'
import { configureWebPush, isWebPushConfigured, webpush } from '../../config/push.js'
import * as notifRepo from '../repositories/notification.repository.js'

configureWebPush()

function dedupeIds(ids) {
  return [...new Set((ids || []).map((id) => parseInt(id, 10)).filter((n) => !Number.isNaN(n)))]
}

/**
 * Create notification row, publish to Redis for SSE, send Web Push.
 */
export async function notify({
  recipientEmployeeId,
  type,
  title,
  body,
  url,
  relatedEntityType,
  relatedEntityId
}) {
  const eid = parseInt(recipientEmployeeId, 10)
  if (Number.isNaN(eid)) return null
  let row
  try {
    row = await notifRepo.insertNotification({
      recipientEmployeeId: eid,
      type,
      title,
      body,
      url,
      relatedEntityType,
      relatedEntityId
    })
  } catch (err) {
    console.error('notify: insert failed', err.message)
    return null
  }
  if (!row) return null

  const payload = JSON.stringify({
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    url: row.url,
    relatedEntityType: row.related_entity_type,
    relatedEntityId: row.related_entity_id,
    createdAt: row.created_at
  })
  try {
    await getConnection().publish(`notifications:${eid}`, payload)
  } catch (e) {
    console.warn('notify: Redis publish failed', e.message)
  }

  await sendWebPushToEmployee(eid, {
    title: row.title,
    body: row.body || '',
    url: row.url || '/',
    tag: `notif-${row.id}`,
    data: { url: row.url || '/', notificationId: row.id }
  }).catch(() => {})

  return row
}

export async function notifyMany(employeeIds, payload) {
  const ids = dedupeIds(employeeIds)
  const out = []
  for (const eid of ids) {
    const r = await notify({ ...payload, recipientEmployeeId: eid })
    if (r) out.push(r)
  }
  return out
}

/**
 * Resolve approvers for a requisition bucket (same roles as email worker).
 */
export async function getEmployeeIdsForRequisitionBucket(bucket, departmentId) {
  let ids = []
  if (bucket === 'hod') ids = await notifRepo.getHodEmployeeIdsForDepartment(departmentId)
  else if (bucket === 'hr') ids = await notifRepo.getHrEmployeeIds()
  else if (bucket === 'committee') ids = await notifRepo.getEmployeeIdsByRoleType('Committee')
  else if (bucket === 'ceo') ids = await notifRepo.getEmployeeIdsByRoleType('CEO')
  else if (bucket === 'procurement') ids = await notifRepo.getEmployeeIdsByRoleType('Procurement')
  else if (bucket === 'finance') ids = await notifRepo.getEmployeeIdsByRoleType('Finance')
  else if (bucket === 'admin') ids = await notifRepo.getAdminEmployeeIds()
  return dedupeIds(ids)
}

export async function notifyBucketApprovers(bucket, departmentId, { type, title, body, url, relatedEntityType, relatedEntityId }) {
  const ids = await getEmployeeIdsForRequisitionBucket(bucket, departmentId)
  if (ids.length === 0) return []
  return notifyMany(ids, { type, title, body, url, relatedEntityType, relatedEntityId })
}

async function sendWebPushToEmployee(employeeId, { title, body, url, tag, data }) {
  if (!isWebPushConfigured()) return
  const subs = await notifRepo.getPushSubscriptionsForEmployee(employeeId)
  for (const raw of subs) {
    const sub = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!sub) continue
    const payload = JSON.stringify({ title, body, url: url || '/', tag, data: data || {} })
    try {
      await webpush.sendNotification(sub, payload)
    } catch (err) {
      const code = err.statusCode
      if (code === 410 || code === 404) {
        const endpoint = sub.endpoint
        if (endpoint) await notifRepo.deletePushSubscriptionByEndpoint(employeeId, endpoint)
      }
    }
  }
}

export async function listNotifications(employeeId, query) {
  return notifRepo.listNotifications(employeeId, query)
}

export async function getUnreadCount(employeeId) {
  return notifRepo.getUnreadCount(employeeId)
}

export async function markAsRead(notificationId, employeeId) {
  return notifRepo.markAsRead(notificationId, employeeId)
}

export async function markAllAsRead(employeeId) {
  await notifRepo.markAllAsRead(employeeId)
}

export async function savePushSubscription(employeeId, subscription, userAgent) {
  await notifRepo.savePushSubscription(employeeId, subscription, userAgent)
}

export async function removeAllPushSubscriptions(employeeId) {
  await notifRepo.deletePushSubscriptionsForEmployee(employeeId)
}

/** Fire-and-forget safe wrapper */
export function notifySafe(promise) {
  return promise.catch((e) => console.warn('notifySafe:', e?.message))
}
