import { executeQuery } from '../../config/database.js'

export async function createLink({ tokenHash, employeeId, pages, landingPage, expiresAt, createdBy }) {
  const rows = await executeQuery(
    `INSERT INTO delegate_access_link (token_hash, employee_id, pages, landing_page, expires_at, created_by)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6) RETURNING *`,
    [tokenHash, employeeId, JSON.stringify(pages), landingPage, expiresAt, createdBy]
  )
  return rows[0] || null
}

export async function findByTokenHash(tokenHash) {
  const rows = await executeQuery(
    `SELECT l.*, e.first_name, e.last_name, e.employee_code, e.email
     FROM delegate_access_link l JOIN employees e ON e.employee_id = l.employee_id
     WHERE l.token_hash = $1`, [tokenHash])
  return rows[0] || null
}

export async function getLinkById(id) {
  const rows = await executeQuery(
    `SELECT l.*, e.first_name, e.last_name, e.employee_code, e.email
     FROM delegate_access_link l JOIN employees e ON e.employee_id = l.employee_id
     WHERE l.id = $1`, [id])
  return rows[0] || null
}

export async function listLinks() {
  return executeQuery(
    `SELECT l.*, e.first_name, e.last_name, e.employee_code
     FROM delegate_access_link l JOIN employees e ON e.employee_id = l.employee_id
     ORDER BY l.created_at DESC`)
}

export async function revokeLink(id, revokedBy) {
  const rows = await executeQuery(
    `UPDATE delegate_access_link SET revoked_at = NOW(), revoked_by = $2
     WHERE id = $1 AND revoked_at IS NULL RETURNING *`, [id, revokedBy])
  return rows[0] || null
}

export async function updateTokenHash(id, tokenHash) {
  await executeQuery(`UPDATE delegate_access_link SET token_hash = $2 WHERE id = $1`, [id, tokenHash])
}

export async function touchLastUsed(id) {
  await executeQuery(`UPDATE delegate_access_link SET last_used_at = NOW() WHERE id = $1`, [id])
}

export async function logEvent({ linkId, eventType, ip = null, userAgent = null, detail = null }) {
  await executeQuery(
    `INSERT INTO delegate_access_event (link_id, event_type, ip, user_agent, detail)
     VALUES ($1, $2, $3, $4, $5)`, [linkId, eventType, ip, userAgent, detail])
}

export async function listEvents(linkId) {
  return executeQuery(`SELECT * FROM delegate_access_event WHERE link_id = $1 ORDER BY created_at DESC`, [linkId])
}
