import * as historyService from '../services/employeeHistory.service.js'

function actorId(req) {
  return req.session?.user?.employeeId || req.session?.user?.id || null
}

function isHrOrAdmin(req) {
  const u = req.session?.user
  if (!u) return false
  if (u.userType === 'SuperAdmin') return true
  return Array.isArray(u.permissions) && u.permissions.includes('administration')
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
    if (!isHrOrAdmin(req)) {
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

export async function update(req, res) {
  try {
    if (!isHrOrAdmin(req)) {
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
    if (!isHrOrAdmin(req)) {
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
