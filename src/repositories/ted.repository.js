import { executeQuery } from '../../config/database.js'

// ---------- sessions ----------
export async function createSession({ title, presentationFile, presentationText, startAt, endAt, passThreshold, maxAttempts, createdBy }) {
  const rows = await executeQuery(
    `INSERT INTO ted_session (title, presentation_file, presentation_text, start_at, end_at, pass_threshold, max_attempts, created_by)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,60),$7,$8) RETURNING *`,
    [title, presentationFile || null, presentationText || null, startAt || null, endAt, passThreshold ?? null, maxAttempts ?? null, createdBy ?? null]
  )
  return rows[0]
}

export async function getSessionById(id) {
  const rows = await executeQuery(`SELECT * FROM ted_session WHERE id = $1`, [id])
  return rows[0] || null
}

export async function listSessions() {
  return executeQuery(`SELECT * FROM ted_session ORDER BY created_at DESC`)
}

export async function updateSessionStatus(id, status) {
  await executeQuery(`UPDATE ted_session SET status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id, status])
}

export async function reopenSession(id, startAt, endAt) {
  const rows = await executeQuery(
    `UPDATE ted_session SET cycle_no = cycle_no + 1, status = 'published', start_at = $2, end_at = $3, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 RETURNING *`,
    [id, startAt || null, endAt]
  )
  return rows[0] || null
}

// ---------- question pool ----------
export async function replaceQuestionPool(sessionId, questions) {
  // Used after AI generation: clear AI questions, insert fresh. HR-added (source='hr') are preserved.
  await executeQuery(`DELETE FROM ted_question_pool WHERE session_id = $1 AND source = 'ai'`, [sessionId])
  for (const q of questions) {
    await executeQuery(
      `INSERT INTO ted_question_pool (session_id, question, option_a, option_b, option_c, option_d, correct_option, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'ai')`,
      [sessionId, q.question, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_option]
    )
  }
}

export async function listQuestions(sessionId, activeOnly = false) {
  const clause = activeOnly ? 'AND is_active = TRUE' : ''
  return executeQuery(`SELECT * FROM ted_question_pool WHERE session_id = $1 ${clause} ORDER BY id ASC`, [sessionId])
}

export async function upsertQuestion(q) {
  if (q.id) {
    const rows = await executeQuery(
      `UPDATE ted_question_pool SET question=$2, option_a=$3, option_b=$4, option_c=$5, option_d=$6, correct_option=$7, is_active=$8
       WHERE id=$1 RETURNING *`,
      [q.id, q.question, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_option, q.is_active !== false]
    )
    return rows[0]
  }
  const rows = await executeQuery(
    `INSERT INTO ted_question_pool (session_id, question, option_a, option_b, option_c, option_d, correct_option, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'hr') RETURNING *`,
    [q.session_id, q.question, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_option]
  )
  return rows[0]
}

export async function countActiveQuestions(sessionId) {
  const r = await executeQuery(`SELECT COUNT(*)::int AS c FROM ted_question_pool WHERE session_id=$1 AND is_active=TRUE`, [sessionId])
  return r[0]?.c ?? 0
}

// ---------- selection / assignments / attempts ----------

/**
 * Eligible employees per department for a session: active, NOT HOD/CEO/Committee, and NOT already
 * passed this session. Returns rows {employee_id, department_id}. HOD = present in
 * employee_hod_departments OR employee_type/designation 'HOD'. CEO/Committee = employee_type/designation.
 */
export async function getEligibleEmployeesByDepartment(sessionId) {
  return executeQuery(
    `SELECT e.employee_id, e.department_id
       FROM employees e
       LEFT JOIN employee_type et ON e.employee_type_id = et.emp_type_id
       LEFT JOIN designation d ON e.designation_id = d.desg_id
      WHERE e.is_active = TRUE
        AND e.department_id IS NOT NULL
        AND COALESCE(et.emp_type_name,'') NOT IN ('HOD','CEO','Committee')
        AND COALESCE(d.desg_name,'') NOT IN ('HOD','CEO','Committee')
        AND e.employee_id NOT IN (SELECT employee_id FROM employee_hod_departments)
        AND e.employee_id NOT IN (
          SELECT employee_id FROM ted_assignment WHERE session_id = $1 AND status = 'passed'
        )`,
    [sessionId]
  )
}

export async function upsertAssignment(sessionId, employeeId, cycleNo) {
  await executeQuery(
    `INSERT INTO ted_assignment (session_id, employee_id, status, current_cycle)
     VALUES ($1,$2,'assigned',$3)
     ON CONFLICT (session_id, employee_id)
     DO UPDATE SET status='assigned', current_cycle=$3, updated_at=CURRENT_TIMESTAMP`,
    [sessionId, employeeId, cycleNo]
  )
}

export async function reactivateFailedAssignments(sessionId, cycleNo) {
  await executeQuery(
    `UPDATE ted_assignment SET status='assigned', current_cycle=$2, updated_at=CURRENT_TIMESTAMP
     WHERE session_id=$1 AND status='failed'`,
    [sessionId, cycleNo]
  )
}

export async function getAssignment(sessionId, employeeId) {
  const rows = await executeQuery(
    `SELECT * FROM ted_assignment WHERE session_id=$1 AND employee_id=$2`, [sessionId, employeeId]
  )
  return rows[0] || null
}

export async function listAssignmentsForSession(sessionId) {
  return executeQuery(
    `SELECT a.*, e.first_name, e.last_name, e.employee_code, dep.department_name
       FROM ted_assignment a
       JOIN employees e ON e.employee_id = a.employee_id
       LEFT JOIN departments dep ON dep.department_id = e.department_id
      WHERE a.session_id = $1 ORDER BY dep.department_name, e.first_name`,
    [sessionId]
  )
}

export async function listAssignmentsForEmployee(employeeId) {
  return executeQuery(
    `SELECT a.*, s.title, s.start_at, s.end_at, s.status AS session_status, s.cycle_no AS session_cycle, s.pass_threshold
       FROM ted_assignment a JOIN ted_session s ON s.id = a.session_id
      WHERE a.employee_id = $1 ORDER BY s.end_at DESC`,
    [employeeId]
  )
}

export async function setAssignmentResult(assignmentId, status, bestScore) {
  await executeQuery(
    `UPDATE ted_assignment SET status=$2,
       best_score = GREATEST(COALESCE(best_score,0), $3), updated_at=CURRENT_TIMESTAMP
     WHERE id=$1`,
    [assignmentId, status, bestScore]
  )
}

export async function insertAttempt({ assignmentId, cycleNo, questionIds, answers, score, passed }) {
  const rows = await executeQuery(
    `INSERT INTO ted_attempt (assignment_id, cycle_no, question_ids, answers, score, passed)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [assignmentId, cycleNo, questionIds, JSON.stringify(answers), score, passed]
  )
  return rows[0]
}

export async function getQuestionsByIds(ids) {
  if (!ids || !ids.length) return []
  return executeQuery(`SELECT * FROM ted_question_pool WHERE id = ANY($1)`, [ids])
}
