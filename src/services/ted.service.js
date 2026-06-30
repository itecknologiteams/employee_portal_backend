import * as repo from '../repositories/ted.repository.js'
import * as notifSvc from './notification.service.js'
import { generateQuizQuestions } from '../../config/aiQuiz.js'
import { extractPresentationText } from '../utils/pptxText.js'
import { scoreQuiz, drawRandomQuestions } from '../utils/tedQuiz.utils.js'
import { getQueue, isBullMQEnabled } from '../../config/bullmq.js'

const QUIZ_SIZE = 5
const POOL_SIZE = 12

// ---------- session create / list / get ----------
export async function createSession({ title, startAt, endAt, passThreshold, pptxBuffer, pptxFileRef, createdBy }) {
  if (!title || !String(title).trim()) return { error: 'Title is required', status: 400 }
  if (!startAt) return { error: 'Training start time is required', status: 400 }
  if (!endAt) return { error: 'Training end time is required', status: 400 }
  if (new Date(endAt) <= new Date(startAt)) return { error: 'End time must be after start time', status: 400 }
  const presentationText = pptxBuffer ? await extractPresentationText(pptxBuffer) : ''
  const session = await repo.createSession({
    title: String(title).trim(),
    presentationFile: pptxFileRef || null,
    presentationText,
    startAt,
    endAt,
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
  if (!session.presentation_text || !session.presentation_text.trim()) {
    return { error: 'No presentation text extracted. Upload a text-based PPTX or add questions manually.', status: 400 }
  }
  try {
    const questions = await generateQuizQuestions(session.presentation_text, POOL_SIZE)
    if (!questions.length) return { error: 'AI returned no valid questions. Add questions manually.', status: 502 }
    await repo.replaceQuestionPool(sessionId, questions)
    return { questions: await repo.listQuestions(sessionId) }
  } catch (err) {
    console.error('[TED] generateQuiz failed:', err?.message)
    return { error: `AI generation failed: ${err?.message}. You can add questions manually.`, status: 502 }
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

/** Random 2 eligible employees per department → assignments for the given cycle. Returns picked ids. */
async function selectAndAssign(sessionId, cycleNo) {
  const eligible = await repo.getEligibleEmployeesByDepartment(sessionId)
  const byDept = new Map()
  for (const e of eligible) {
    if (!byDept.has(e.department_id)) byDept.set(e.department_id, [])
    byDept.get(e.department_id).push(e.employee_id)
  }
  const picked = []
  for (const [, ids] of byDept) {
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]] }
    picked.push(...ids.slice(0, 2))
  }
  for (const empId of picked) await repo.upsertAssignment(sessionId, empId, cycleNo)
  return picked
}

export async function publishSession(sessionId) {
  const session = await repo.getSessionById(sessionId)
  if (!session) return { error: 'Session not found', status: 404 }
  const activeCount = await repo.countActiveQuestions(sessionId)
  if (activeCount < QUIZ_SIZE) {
    return { error: `Need at least ${QUIZ_SIZE} active questions to publish (have ${activeCount}).`, status: 400 }
  }
  await repo.updateSessionStatus(sessionId, 'published')
  const assigned = await selectAndAssign(sessionId, session.cycle_no)
  for (const empId of assigned) {
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
  return { message: 'Session published', assignedCount: assigned.length }
}

export async function reopenSession(sessionId, startAt, endAt) {
  const session = await repo.getSessionById(sessionId)
  if (!session) return { error: 'Session not found', status: 404 }
  if (!startAt || !endAt) return { error: 'New start and end time are required', status: 400 }
  if (new Date(endAt) <= new Date(startAt)) return { error: 'End time must be after start time', status: 400 }
  const updated = await repo.reopenSession(sessionId, startAt, endAt)
  await repo.reactivateFailedAssignments(sessionId, updated.cycle_no)
  // top up to 2 per dept (passed employees are excluded by the eligibility query)
  await selectAndAssign(sessionId, updated.cycle_no)
  return { message: 'Session re-opened for retakes', cycle: updated.cycle_no }
}

export async function getAssignmentsDashboard(sessionId) {
  return { assignments: await repo.listAssignmentsForSession(sessionId) }
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
  if (!assignment || assignment.status === 'passed') return { error: 'No active quiz for you on this session', status: 403 }
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
  if (!assignment || assignment.status === 'passed') return { error: 'No active quiz for you', status: 403 }
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
  const now = new Date()
  return {
    trainings: rows.map((a) => ({
      sessionId: a.session_id, title: a.title, startAt: a.start_at, endAt: a.end_at,
      status: a.status, bestScore: a.best_score, passThreshold: a.pass_threshold,
      quizOpen: a.session_status === 'published' && a.current_cycle === a.session_cycle
        && a.status !== 'passed' && now >= new Date(a.end_at)
    }))
  }
}
