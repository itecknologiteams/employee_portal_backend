import * as historyService from '../services/employeeHistory.service.js'
import * as reqRepo from '../repositories/requisition.repository.js'

function actorId(req) {
  return req.session?.user?.employeeId || req.session?.user?.id || null
}

/**
 * Who may add/edit/delete employee history events: SuperAdmin, Admin, or HR.
 *
 * HR users are "HR" by PERMISSION/ROLE, not by employee_type — their session carries the HR
 * permission set (incl. 'profile_update_requests', the same permission that exposes the HR
 * "Profile Update Requests" section in the Administration page) but NOT the 'administration'
 * permission (that gates the Admin page only). So we authorize on those permissions, and keep
 * reqRepo.isHrMember() as a fallback for HR identified by employee_type / designation.
 */
async function isHrOrAdmin(req) {
  const u = req.session?.user
  // TEMP diagnostic (unconditional): print exactly what the session carries on every authz check.
  console.warn('[employeeHistory] authz check →', JSON.stringify({
    hasSession: !!req.session,
    hasUser: !!u,
    sessionID: req.sessionID || null,
    hasCookieHeader: !!req.headers?.cookie,
    userType: u?.userType ?? null,
    perms: Array.isArray(u?.permissions) ? u.permissions : null
  }))
  if (!u) return false
  // SuperAdmin match is case-insensitive — stored user_type casing varies ('SuperAdmin'/'superadmin'),
  // same as isSuperAdminEmployee() in requisition.service.
  if (String(u.userType || '').trim().toLowerCase() === 'superadmin') return true
  const perms = Array.isArray(u.permissions) ? u.permissions : []
  if (perms.includes('administration') || perms.includes('profile_update_requests')) return true
  const eid = actorId(req)
  if (eid != null && (await reqRepo.isHrMember(eid))) return true
  return false
}

export async function list(req, res) {
  try {
    const result = await historyService.listForEmployee(req.params.id, { recordType: req.query.type })
    if (result?.error) return res.status(result.status).json({ error: result.error })
    res.json(result)
  } catch (e) {
    console.error('history.list error:', e)
    res.status(500).json({ error: 'Failed to fetch history' })
  }
}

export async function getOne(req, res) {
  try {
    const result = await historyService.getOne(req.params.eventId)
    if (result?.error) return res.status(result.status).json({ error: result.error })
    res.json(result)
  } catch (e) {
    console.error('history.getOne error:', e)
    res.status(500).json({ error: 'Failed to fetch event' })
  }
}

export async function create(req, res) {
  try {
    if (!(await isHrOrAdmin(req))) {
      return res.status(403).json({ error: 'Only HR or SuperAdmin can add history events' })
    }
    const result = await historyService.createEvent(req.params.id, req.body, actorId(req))
    if (result?.error) return res.status(result.status).json({ error: result.error })
    res.status(201).json(result)
  } catch (e) {
    console.error('history.create error:', e)
    res.status(500).json({ error: 'Failed to create event' })
  }
}

/** Bulk import appraisal/confirmation events from an uploaded sheet (HR/Admin only). */
export async function bulkImport(req, res) {
  try {
    if (!(await isHrOrAdmin(req))) {
      return res.status(403).json({ error: 'Only HR or SuperAdmin can import history events' })
    }
    const mode = req.body?.mode === 'commit' ? 'commit' : 'validate'
    const result = await historyService.bulkImportHistory(req.body?.rows, { mode, createdBy: actorId(req) })
    if (result?.error) return res.status(result.status).json({ error: result.error })
    res.json(result)
  } catch (e) {
    console.error('history.bulkImport error:', e)
    res.status(500).json({ error: 'Failed to import history events' })
  }
}

export async function update(req, res) {
  try {
    if (!(await isHrOrAdmin(req))) {
      return res.status(403).json({ error: 'Only HR or SuperAdmin can edit history events' })
    }
    const result = await historyService.updateEvent(req.params.eventId, req.body, actorId(req))
    if (result?.error) return res.status(result.status).json({ error: result.error })
    res.json(result)
  } catch (e) {
    console.error('history.update error:', e)
    res.status(500).json({ error: 'Failed to update event' })
  }
}

export async function remove(req, res) {
  try {
    if (!(await isHrOrAdmin(req))) {
      return res.status(403).json({ error: 'Only HR or SuperAdmin can delete history events' })
    }
    const result = await historyService.deleteEvent(req.params.eventId, actorId(req))
    if (result?.error) return res.status(result.status).json({ error: result.error })
    res.json(result)
  } catch (e) {
    console.error('history.delete error:', e)
    res.status(500).json({ error: 'Failed to delete event' })
  }
}
