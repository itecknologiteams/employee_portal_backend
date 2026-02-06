import { executeQuery } from '../../config/database.js'

export async function getFeedbackHistory(employeeId) {
  return executeQuery(
    `SELECT f.feedback_id, f.subject, f.message, f.category, f.rating, f.status, f.created_at
     FROM feedback f WHERE f.employee_id = $1 ORDER BY f.created_at DESC`,
    [employeeId]
  )
}

export async function submitFeedback(employeeId, subject, category, message, rating) {
  return executeQuery(
    `INSERT INTO feedback (employee_id, subject, category, message, rating, status, created_at)
     VALUES ($1, $2, $3, $4, $5, 'Under Review', CURRENT_TIMESTAMP)
     RETURNING feedback_id`,
    [employeeId, subject, category || 'General', message, rating || null]
  )
}
