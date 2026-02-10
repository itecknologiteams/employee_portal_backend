import { executeQuery } from '../../config/database.js'

export async function getFeedbackHistory(employeeId) {
  return executeQuery(
    `SELECT f.feedback_id AS id, f.employee_id, f.subject, f.category, f.message, f.rating, f.status, f.created_at
     FROM feedback f WHERE f.employee_id = $1 ORDER BY f.created_at DESC`,
    [employeeId]
  )
}

export async function submitFeedback(employeeId, subject, category, message, rating) {
  return executeQuery(
    `INSERT INTO feedback (employee_id, subject, category, message, rating)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING feedback_id AS id, created_at`,
    [employeeId, subject, category, message, rating]
  )
}

export async function getEmployeeById(employeeId) {
  return executeQuery(
    'SELECT employee_id, email FROM employees WHERE employee_id = $1',
    [employeeId]
  )
}

export async function getEmployeeEmail(employeeId) {
  return executeQuery('SELECT email FROM employees WHERE employee_id = $1', [employeeId])
}
