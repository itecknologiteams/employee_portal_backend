import * as tedService from '../services/ted.service.js'

function actorId(req) { return req.session?.user?.employeeId || req.session?.user?.id || null }

// Managing training sessions is gated by the 'manage_trainings' permission (toggled per role in
// Role Permissions; OFF by default for everyone). SuperAdmin is always allowed (system override).
async function canManageTed(req) {
  const u = req.session?.user
  if (!u) return false
  if (String(u.userType || '').trim().toLowerCase() === 'superadmin') return true
  return Array.isArray(u.permissions) && u.permissions.includes('manage_trainings')
}

const send = (res, result) => result?.error ? res.status(result.status || 400).json({ error: result.error }) : res.json(result)

// ---- HR ----
export async function createSession(req, res) {
  try {
    if (!(await canManageTed(req))) return res.status(403).json({ error: 'Only HR can create training sessions' })
    const pptxBuffer = req.file?.buffer || null
    const pptxFileRef = req.file ? req.file.originalname : null
    const result = await tedService.createSession({
      title: req.body.title, startAt: req.body.startAt, endAt: req.body.endAt, passThreshold: req.body.passThreshold,
      pptxBuffer, pptxFileRef, createdBy: actorId(req)
    })
    send(res, result)
  } catch (e) { console.error('ted.createSession', e); res.status(500).json({ error: 'Failed to create session' }) }
}

export async function listSessions(req, res) {
  try {
    if (!(await canManageTed(req))) return res.status(403).json({ error: 'Forbidden' })
    send(res, await tedService.listSessions())
  } catch (e) { console.error('ted.listSessions', e); res.status(500).json({ error: 'Failed' }) }
}

export async function getSession(req, res) {
  try {
    if (!(await canManageTed(req))) return res.status(403).json({ error: 'Forbidden' })
    send(res, await tedService.getSession(parseInt(req.params.id, 10)))
  } catch (e) { console.error('ted.getSession', e); res.status(500).json({ error: 'Failed' }) }
}

export async function generateQuiz(req, res) {
  try {
    if (!(await canManageTed(req))) return res.status(403).json({ error: 'Forbidden' })
    send(res, await tedService.generateQuiz(parseInt(req.params.id, 10)))
  } catch (e) { console.error('ted.generateQuiz', e); res.status(500).json({ error: 'Failed' }) }
}

export async function saveQuestion(req, res) {
  try {
    if (!(await canManageTed(req))) return res.status(403).json({ error: 'Forbidden' })
    send(res, await tedService.saveQuestion({ ...req.body, session_id: parseInt(req.params.id, 10) }))
  } catch (e) { console.error('ted.saveQuestion', e); res.status(500).json({ error: 'Failed' }) }
}

export async function publishSession(req, res) {
  try {
    if (!(await canManageTed(req))) return res.status(403).json({ error: 'Forbidden' })
    send(res, await tedService.publishSession(parseInt(req.params.id, 10)))
  } catch (e) { console.error('ted.publishSession', e); res.status(500).json({ error: 'Failed' }) }
}

export async function reopenSession(req, res) {
  try {
    if (!(await canManageTed(req))) return res.status(403).json({ error: 'Forbidden' })
    send(res, await tedService.reopenSession(parseInt(req.params.id, 10), req.body.startAt, req.body.endAt))
  } catch (e) { console.error('ted.reopenSession', e); res.status(500).json({ error: 'Failed' }) }
}

export async function assignmentsDashboard(req, res) {
  try {
    if (!(await canManageTed(req))) return res.status(403).json({ error: 'Forbidden' })
    send(res, await tedService.getAssignmentsDashboard(parseInt(req.params.id, 10)))
  } catch (e) { console.error('ted.assignments', e); res.status(500).json({ error: 'Failed' }) }
}

// ---- Employee (own data) ----
export async function myTrainings(req, res) {
  try {
    const eid = actorId(req)
    if (eid == null) return res.status(401).json({ error: 'Not logged in' })
    send(res, await tedService.myTrainings(eid))
  } catch (e) { console.error('ted.myTrainings', e); res.status(500).json({ error: 'Failed' }) }
}

export async function getQuiz(req, res) {
  try {
    const eid = actorId(req)
    if (eid == null) return res.status(401).json({ error: 'Not logged in' })
    send(res, await tedService.getQuizForEmployee(parseInt(req.params.id, 10), eid))
  } catch (e) { console.error('ted.getQuiz', e); res.status(500).json({ error: 'Failed' }) }
}

export async function submitQuiz(req, res) {
  try {
    const eid = actorId(req)
    if (eid == null) return res.status(401).json({ error: 'Not logged in' })
    send(res, await tedService.submitQuiz(parseInt(req.params.id, 10), eid, req.body.answers || {}))
  } catch (e) { console.error('ted.submitQuiz', e); res.status(500).json({ error: 'Failed' }) }
}
