import * as repo from '../repositories/ted.repository.js'
import * as notifSvc from './notification.service.js'
import { generateQuizQuestions } from '../../config/aiQuiz.js'
import { encryptBuffer, decryptToBuffer } from '../utils/fileCrypto.js'
import { scoreQuiz, drawRandomQuestions } from '../utils/tedQuiz.utils.js'
import { getQueue, isBullMQEnabled } from '../../config/bullmq.js'

const QUIZ_SIZE = 5
const POOL_SIZE = 12

// ---------- session create / list / get ----------
export async function createSession({ title, startAt, endAt, audience, passThreshold, pdfBuffer, pdfFileRef, createdBy }) {
  if (!title || !String(title).trim()) return { error: 'Title is required', status: 400 }
  if (!startAt) return { error: 'Training start time is required', status: 400 }
  if (!endAt) return { error: 'Training end time is required', status: 400 }
  if (new Date(endAt) <= new Date(startAt)) return { error: 'End time must be after start time', status: 400 }
  const aud = audience === 'all_active' ? 'all_active' : 'dept_random'
  // Store the uploaded PDF encrypted at rest; the quiz is generated from it (Gemini multimodal).
  const presentationEnc = pdfBuffer && pdfBuffer.length ? encryptBuffer(pdfBuffer) : null
  const session = await repo.createSession({
    title: String(title).trim(),
    presentationFile: pdfFileRef || null,
    presentationEnc,
    startAt,
    endAt,
    audience: aud,
    passThreshold: passThreshold ?? 60,
    maxAttempts: null,
    createdBy
  })
  return { session }
}

export async function listSessions() { return { sessions: await repo.listSessions() } }

export async function getSession(id) {
  const session = await repo.getSessionById(id)
  if (!session) return { error: 'Session not found', status: 404 }
  const questions = await repo.listQuestions(id)
  return { session, questions }
}

// ---------- quiz generation / review ----------
export async function generateQuiz(sessionId) {
  const session = await repo.getSessionById(sessionId)
  if (!session) return { error: 'Session not found', status: 404 }
  if (!session.presentation_enc) {
    return { error: 'No PDF uploaded for this session. Upload a PDF or add questions manually.', status: 400 }
  }
  try {
    const pdfBuffer = decryptToBuffer(session.presentation_enc)
    const questions = await generateQuizQuestions({ pdfBase64: pdfBuffer.toString('base64') }, POOL_SIZE)
    if (!questions.length) return { error: 'AI returned no valid questions. Add questions manually.', status: 502 }
    await repo.replaceQuestionPool(sessionId, questions)
    return { questions: await repo.listQuestions(sessionId) }
  } catch (err) {
    console.error('[TED] generateQuiz failed:', err?.message)
    return { error: `AI generation failed: ${err?.message}. You can add questions manually.`, status: 502 }
  }
}

/** Decrypt + return the stored PDF for HR download. */
export async function getPresentationPdf(sessionId) {
  const session = await repo.getSessionById(sessionId)
  if (!session) return { error: 'Session not found', status: 404 }
  if (!session.presentation_enc) return { error: 'No PDF stored for this session', status: 404 }
  try {
    return { buffer: decryptToBuffer(session.presentation_enc), filename: session.presentation_file || `training-${sessionId}.pdf` }
  } catch (err) {
    console.error('[TED] PDF decrypt failed:', err?.message)
    return { error: 'Could not read the stored PDF', status: 500 }
  }
}

export async function saveQuestion(q) {
  if (!q?.question || !q?.option_a || !q?.option_b || !q?.option_c || !q?.option_d) {
    return { error: 'Question and all 4 options are required', status: 400 }
  }
  if (!['A', 'B', 'C', 'D'].includes(String(q.correct_option).toUpperCase())) {
    return { error: 'correct_option must be A, B, C, or D', status: 400 }
  }
  const saved = await repo.upsertQuestion({ ...q, correct_option: String(q.correct_option).toUpperCase() })
  return { question: saved }
}

// ---------- publish / reopen / selection ----------

/**
 * Assign the cycle:
 *  - QUIZ → every eligible employee (active, not HOD/CEO/Committee, not already passed) is assigned.
 *  - LIVE SESSION → 2 random eligible per department are additionally flagged as live attendees.
 * Returns { assignedIds, liveCount }.
 */
async function selectAndAssign(sessionId, cycleNo) {
  const eligible = await repo.getEligibleEmployeesByDepartment(sessionId)
  const assignedIds = eligible.map((e) => e.employee_id)
  // Quiz for everyone.
  for (const empId of assignedIds) await repo.upsertAssignment(sessionId, empId, cycleNo)
  // Live-session roster: 2 random per department.
  const byDept = new Map()
  for (const e of eligible) {
    if (!byDept.has(e.department_id)) byDept.set(e.department_id, [])
    byDept.get(e.department_id).push(e.employee_id)
  }
  const live = []
  for (const [, ids] of byDept) {
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]] }
    live.push(...ids.slice(0, 2))
  }
  if (live.length) await repo.markLiveAttendees(sessionId, live)
  return { assignedIds, liveCount: live.length }
}

export async function publishSession(sessionId) {
  const session = await repo.getSessionById(sessionId)
  if (!session) return { error: 'Session not found', status: 404 }
  const activeCount = await repo.countActiveQuestions(sessionId)
  if (activeCount < QUIZ_SIZE) {
    return { error: `Need at least ${QUIZ_SIZE} active questions to publish (have ${activeCount}).`, status: 400 }
  }
  await repo.updateSessionStatus(sessionId, 'published')
  const { assignedIds, liveCount } = await selectAndAssign(sessionId, session.cycle_no)
  for (const empId of assignedIds) {
    notifSvc.notifySafe(notifSvc.notify({
      recipientEmployeeId: empId, type: 'ted_assigned',
      title: 'Training assigned', body: `You are assigned to training: ${session.title}. Quiz unlocks after the session time.`,
      url: '/my-trainings', relatedEntityType: 'ted_session', relatedEntityId: sessionId
    }))
  }
  // Best-effort: schedule a quiz-unlock notification at end_at (correctness does not depend on it).
  if (isBullMQEnabled()) {
    try {
      const delay = Math.max(0, new Date(session.end_at).getTime() - Date.now())
      await getQueue().add('ted-quiz-unlock', { sessionId, cycleNo: session.cycle_no }, { delay })
    } catch (e) { console.error('[TED] unlock job enqueue failed:', e?.message) }
  }
  return { message: 'Session published', assignedCount: assignedIds.length, liveCount }
}

export async function reopenSession(sessionId, startAt, endAt) {
  const session = await repo.getSessionById(sessionId)
  if (!session) return { error: 'Session not found', status: 404 }
  if (!startAt || !endAt) return { error: 'New start and end time are required', status: 400 }
  if (new Date(endAt) <= new Date(startAt)) return { error: 'End time must be after start time', status: 400 }
  const updated = await repo.reopenSession(sessionId, startAt, endAt)
  // Re-open is ONLY for retakes: reactivate the employees who failed (status→assigned for the new
  // cycle). It does NOT pull in new people — the cohort is fixed at publish time.
  await repo.reactivateFailedAssignments(sessionId, updated.cycle_no)
  return { message: 'Session re-opened for retakes', cycle: updated.cycle_no }
}

/** Per-training statistics: counts, per-employee rows, attempt history, and the training's leaderboard. */
export async function getSessionStats(sessionId) {
  const session = await repo.getSessionById(sessionId)
  if (!session) return { error: 'Session not found', status: 404 }
  const assignments = await repo.listAssignmentsForSession(sessionId)
  const attempts = await repo.listAttemptsForSession(sessionId)
  const counts = {
    assigned: assignments.length,
    passed: assignments.filter((a) => a.status === 'passed').length,
    failed: assignments.filter((a) => a.status === 'failed').length,
    pending: assignments.filter((a) => a.status === 'assigned').length,
    liveAttendees: assignments.filter((a) => a.live_attendee).length
  }
  const liveAttendees = assignments
    .filter((a) => a.live_attendee)
    .map((a) => ({
      employeeId: a.employee_id, name: `${a.first_name || ''} ${a.last_name || ''}`.trim(),
      employeeCode: a.employee_code, department: a.department_name, status: a.status, bestScore: a.best_score
    }))
  // Leaderboard for this training: by best score (passed first), then name.
  const leaderboard = assignments
    .filter((a) => a.best_score != null)
    .map((a) => ({
      employeeId: a.employee_id, name: `${a.first_name || ''} ${a.last_name || ''}`.trim(),
      employeeCode: a.employee_code, department: a.department_name,
      bestScore: Number(a.best_score), status: a.status
    }))
    .sort((x, y) => (y.status === 'passed') - (x.status === 'passed') || y.bestScore - x.bestScore)
  return {
    session: { id: session.id, title: session.title, status: session.status, cycle_no: session.cycle_no },
    counts, assignments, leaderboard, liveAttendees, attempts
  }
}

export async function getGlobalLeaderboard() {
  const rows = await repo.getGlobalLeaderboard(100)
  return {
    leaderboard: rows.map((r, i) => ({
      rank: i + 1, employeeId: r.employee_id, name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
      employeeCode: r.employee_code, department: r.department_name,
      avgScore: r.avg_score != null ? Number(r.avg_score) : null,
      passed: Number(r.passed), assigned: Number(r.assigned)
    }))
  }
}

// ---------- employee quiz ----------
function quizUnlocked(session) {
  // Quiz opens only AFTER the training END time.
  return session.status === 'published' && new Date() >= new Date(session.end_at)
}

/** Draw 5 questions for this employee's attempt. Seed = assignmentId:cycle so a re-fetch within the
 *  same cycle is stable, and each new cycle differs. correct_option is never sent to the client. */
export async function getQuizForEmployee(sessionId, employeeId) {
  const session = await repo.getSessionById(sessionId)
  if (!session) return { error: 'Session not found', status: 404 }
  const assignment = await repo.getAssignment(sessionId, employeeId)
  // Only an 'assigned' assignment may attempt. After an attempt it becomes passed/failed and is
  // blocked until HR re-opens (which sets failed ones back to 'assigned') — retake model B.
  if (!assignment || assignment.status !== 'assigned') return { error: 'No active quiz for you on this session', status: 403 }
  if (assignment.current_cycle !== session.cycle_no) return { error: 'Quiz not open for the current cycle', status: 403 }
  if (!quizUnlocked(session)) return { error: 'Quiz unlocks after the training session time', status: 403 }
  const pool = await repo.listQuestions(sessionId, true)
  const drawn = drawRandomQuestions(pool, QUIZ_SIZE, `${assignment.id}:${session.cycle_no}`)
  const questions = drawn.map((q) => ({
    id: q.id, question: q.question, options: { A: q.option_a, B: q.option_b, C: q.option_c, D: q.option_d }
  }))
  return { sessionTitle: session.title, questionIds: drawn.map((q) => q.id), questions }
}

export async function submitQuiz(sessionId, employeeId, answers) {
  const session = await repo.getSessionById(sessionId)
  if (!session) return { error: 'Session not found', status: 404 }
  const assignment = await repo.getAssignment(sessionId, employeeId)
  if (!assignment || assignment.status !== 'assigned') return { error: 'No active quiz for you', status: 403 }
  if (assignment.current_cycle !== session.cycle_no) return { error: 'Quiz not open for the current cycle', status: 403 }
  if (!quizUnlocked(session)) return { error: 'Quiz unlocks after the training session time', status: 403 }
  // re-derive the SAME drawn set server-side (same seed) → scoring is tamper-proof
  const pool = await repo.listQuestions(sessionId, true)
  const drawn = drawRandomQuestions(pool, QUIZ_SIZE, `${assignment.id}:${session.cycle_no}`)
  const result = scoreQuiz(drawn, answers, session.pass_threshold)
  await repo.insertAttempt({
    assignmentId: assignment.id, cycleNo: session.cycle_no,
    questionIds: drawn.map((q) => q.id), answers, score: result.score, passed: result.passed
  })
  await repo.setAssignmentResult(assignment.id, result.passed ? 'passed' : 'failed', result.score)
  notifSvc.notifySafe(notifSvc.notify({
    recipientEmployeeId: employeeId, type: result.passed ? 'ted_passed' : 'ted_failed',
    title: result.passed ? 'Training passed' : 'Training not passed',
    body: result.passed ? `You passed "${session.title}" (${result.score}%).`
                        : `You scored ${result.score}% on "${session.title}". You will retake when HR re-opens it.`,
    url: '/my-trainings', relatedEntityType: 'ted_session', relatedEntityId: sessionId
  }))
  return { score: result.score, passed: result.passed, correct: result.correct, total: result.total }
}

export async function myTrainings(employeeId) {
  const rows = await repo.listAssignmentsForEmployee(employeeId)
  const attempts = await repo.listAttemptsForEmployee(employeeId)
  const now = new Date()
  const trainings = rows.map((a) => {
    const inCurrentCycle = a.session_status === 'published' && a.current_cycle === a.session_cycle && a.status !== 'passed'
    const myAttempts = attempts.filter((t) => t.session_id === a.session_id)
    return {
      sessionId: a.session_id, title: a.title, startAt: a.start_at, endAt: a.end_at,
      status: a.status, bestScore: a.best_score != null ? Number(a.best_score) : null,
      passThreshold: a.pass_threshold, attemptCount: myAttempts.length,
      // Quiz takeable now (after end time, current cycle, still assigned).
      quizOpen: inCurrentCycle && a.status === 'assigned' && now >= new Date(a.end_at),
      // Upcoming = assigned, training end time still in the future → countdown target = endAt.
      upcoming: inCurrentCycle && a.status === 'assigned' && now < new Date(a.end_at)
    }
  })
  const attempted = trainings.filter((t) => t.bestScore != null)
  const averageScore = attempted.length
    ? Math.round((attempted.reduce((s, t) => s + t.bestScore, 0) / attempted.length) * 100) / 100
    : null
  return {
    summary: {
      totalAssigned: trainings.length,
      averageScore,
      passedCount: trainings.filter((t) => t.status === 'passed').length,
      improvementCount: trainings.filter((t) => t.status !== 'passed' && t.bestScore != null).length
    },
    trainings,
    upcoming: trainings.filter((t) => t.upcoming),
    history: attempts.map((t) => ({
      sessionId: t.session_id, title: t.title, score: Number(t.score), passed: t.passed,
      cycle: t.cycle_no, attemptedAt: t.attempted_at
    }))
  }
}
