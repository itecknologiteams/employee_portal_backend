import { executeQuery } from '../../config/database.js'

export async function insertNotification({
  recipientEmployeeId,
  type,
  title,
  body,
  url,
  relatedEntityType,
  relatedEntityId
}) {
  const rows = await executeQuery(
    `INSERT INTO notifications (recipient_employee_id, type, title, body, url, related_entity_type, related_entity_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, recipient_employee_id, type, title, body, url, is_read, related_entity_type, related_entity_id, created_at`,
    [
      recipientEmployeeId,
      type,
      title,
      body ?? null,
      url ?? null,
      relatedEntityType ?? null,
      relatedEntityId != null ? parseInt(relatedEntityId, 10) : null
    ]
  )
  return rows[0] || null
}

export async function listNotifications(employeeId, { unreadOnly = false, page = 1, limit = 20 } = {}) {
  const off = (Math.max(1, page) - 1) * Math.min(100, Math.max(1, limit))
  const lim = Math.min(100, Math.max(1, limit))
  const params = [employeeId]
  let where = 'WHERE recipient_employee_id = $1'
  if (unreadOnly) where += ' AND is_read = false'
  const countRows = await executeQuery(`SELECT COUNT(*)::int AS c FROM notifications ${where}`, params)
  const total = countRows[0]?.c ?? 0
  params.push(lim, off)
  const rows = await executeQuery(
    `SELECT id, recipient_employee_id, type, title, body, url, is_read, related_entity_type, related_entity_id, created_at
     FROM notifications ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  )
  return { rows: rows || [], total }
}

export async function getUnreadCount(employeeId) {
  const rows = await executeQuery(
    `SELECT COUNT(*)::int AS c FROM notifications WHERE recipient_employee_id = $1 AND is_read = false`,
    [employeeId]
  )
  return rows[0]?.c ?? 0
}

export async function markAsRead(notificationId, employeeId) {
  const rows = await executeQuery(
    `UPDATE notifications SET is_read = true WHERE id = $1 AND recipient_employee_id = $2 RETURNING id`,
    [notificationId, employeeId]
  )
  return rows.length > 0
}

export async function markAllAsRead(employeeId) {
  await executeQuery(
    `UPDATE notifications SET is_read = true WHERE recipient_employee_id = $1 AND is_read = false`,
    [employeeId]
  )
}

export async function savePushSubscription(employeeId, subscription, userAgent) {
  const sub = typeof subscription === 'string' ? JSON.parse(subscription) : subscription
  const subJson = JSON.stringify(sub)
  try {
    await executeQuery(
      `DELETE FROM push_subscriptions WHERE employee_id = $1 AND md5(subscription::text) = md5($2::text)`,
      [employeeId, subJson]
    )
    await executeQuery(
      `INSERT INTO push_subscriptions (employee_id, subscription, user_agent) VALUES ($1, $2::jsonb, $3)`,
      [employeeId, subJson, userAgent ?? null]
    )
  } catch (err) {
    // If subscription already exists (unique digest index), treat as success.
    if (err?.code === '23505') return
    throw err
  }
}

export async function deletePushSubscriptionsForEmployee(employeeId) {
  await executeQuery('DELETE FROM push_subscriptions WHERE employee_id = $1', [employeeId])
}

export async function deletePushSubscriptionByEndpoint(employeeId, endpoint) {
  if (!endpoint) return
  await executeQuery(
    `DELETE FROM push_subscriptions WHERE employee_id = $1 AND subscription->>'endpoint' = $2`,
    [employeeId, endpoint]
  )
}

export async function getPushSubscriptionsForEmployee(employeeId) {
  const rows = await executeQuery(
    'SELECT subscription FROM push_subscriptions WHERE employee_id = $1',
    [employeeId]
  )
  return (rows || []).map((r) => r.subscription)
}

/** HODs for a department (portal employees). */
export async function getHodEmployeeIdsForDepartment(departmentId) {
  if (departmentId == null) return []
  try {
    const rows = await executeQuery(
      `SELECT e.employee_id FROM employees e
       LEFT JOIN employee_type et ON e.employee_type_id = et.emp_type_id AND et.emp_type_name = 'HOD'
       LEFT JOIN designation desg ON e.designation_id = desg.desg_id AND desg.desg_name = 'HOD'
       WHERE e.department_id = $1 AND e.is_active = true
         AND (et.emp_type_id IS NOT NULL OR desg.desg_id IS NOT NULL)`,
      [departmentId]
    )
    return [...new Set((rows || []).map((r) => r.employee_id).filter((id) => id != null))]
  } catch (err) {
    if (err.code === '42P01') return []
    throw err
  }
}

/** Email addresses for active employees of a given role type/designation (e.g. 'CEO'). */
export async function getEmployeeEmailsByRoleType(roleName) {
  if (!roleName) return []
  try {
    const rows = await executeQuery(
      `SELECT DISTINCT e.email FROM employees e
       LEFT JOIN employee_type et ON e.employee_type_id = et.emp_type_id AND et.emp_type_name = $1
       LEFT JOIN designation desg ON e.designation_id = desg.desg_id AND desg.desg_name = $1
       WHERE e.is_active = true AND e.email IS NOT NULL AND TRIM(e.email) <> ''
         AND (et.emp_type_id IS NOT NULL OR desg.desg_id IS NOT NULL)`,
      [roleName]
    )
    return [...new Set((rows || []).map((r) => String(r.email).trim()).filter(Boolean))]
  } catch (err) {
    if (err.code === '42P01') return []
    throw err
  }
}

/** Committee, CEO, HR, Procurement, Finance by type/designation name. */
export async function getEmployeeIdsByRoleType(roleName) {
  if (!roleName) return []
  try {
    const rows = await executeQuery(
      `SELECT DISTINCT e.employee_id FROM employees e
       LEFT JOIN employee_type et ON e.employee_type_id = et.emp_type_id AND et.emp_type_name = $1
       LEFT JOIN designation desg ON e.designation_id = desg.desg_id AND desg.desg_name = $1
       WHERE e.is_active = true
         AND (et.emp_type_id IS NOT NULL OR desg.desg_id IS NOT NULL)`,
      [roleName]
    )
    return [...new Set((rows || []).map((r) => r.employee_id).filter((id) => id != null))]
  } catch (err) {
    if (err.code === '42P01') return []
    throw err
  }
}

export async function getAdminEmployeeIds() {
  try {
    const rows = await executeQuery(
      `SELECT DISTINCT e.employee_id FROM employees e
       LEFT JOIN employee_type et ON e.employee_type_id = et.emp_type_id AND et.emp_type_name ILIKE '%Admin%'
       LEFT JOIN designation desg ON e.designation_id = desg.desg_id AND desg.desg_name ILIKE '%Admin%'
       WHERE e.is_active = true AND (et.emp_type_id IS NOT NULL OR desg.desg_id IS NOT NULL)`
    )
    return [...new Set((rows || []).map((r) => r.employee_id).filter((id) => id != null))]
  } catch (err) {
    if (err.code === '42P01') return []
    throw err
  }
}

export async function getHrEmployeeIds() {
  try {
    const rows = await executeQuery(
      `SELECT DISTINCT e.employee_id FROM employees e
       LEFT JOIN employee_type et ON e.employee_type_id = et.emp_type_id AND et.emp_type_name = 'HR'
       LEFT JOIN designation desg ON e.designation_id = desg.desg_id AND (desg.desg_name ILIKE '%HR%' OR desg.desg_name = 'Human Resource')
       LEFT JOIN users u ON e.employee_id = u.emp_id
       WHERE e.is_active = true
         AND (et.emp_type_id IS NOT NULL OR desg.desg_id IS NOT NULL OR u.user_type IN ('Admin', 'Staff'))`
    )
    return [...new Set((rows || []).map((r) => r.employee_id).filter((id) => id != null))]
  } catch (err) {
    if (err.code === '42P01') {
      try {
        const rows = await executeQuery(
          `SELECT e.employee_id FROM employees e
           INNER JOIN employee_type et ON e.employee_type_id = et.emp_type_id AND et.emp_type_name = 'HR'
           WHERE e.is_active = true`
        )
        return (rows || []).map((r) => r.employee_id)
      } catch (_) {
        return []
      }
    }
    throw err
  }
}

export async function getRequisitionCreatorId(reqId) {
  const rows = await executeQuery('SELECT req_emp_id FROM requisition WHERE req_id = $1', [reqId])
  return rows[0]?.req_emp_id != null ? parseInt(rows[0].req_emp_id, 10) : null
}

export async function getRequisitionRef(reqId) {
  const rows = await executeQuery('SELECT req_reference_no FROM requisition WHERE req_id = $1', [reqId])
  return rows[0]?.req_reference_no || null
}
