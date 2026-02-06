import * as feedbackRepo from '../repositories/feedback.repository.js'

export async function getFeedbackHistory(employeeId) {
  const result = await feedbackRepo.getFeedbackHistory(employeeId)
  return result.map(f => ({
    id: f.feedback_id,
    subject: f.subject,
    message: f.message,
    category: f.category,
    rating: f.rating,
    status: f.status || 'Under Review',
    date: f.created_at
  }))
}

export async function submitFeedback(data) {
  const { employeeId, subject, category, message, rating } = data
  const result = await feedbackRepo.submitFeedback(employeeId, subject, category, message, rating)
  return {
    message: 'Feedback submitted successfully',
    feedbackId: result[0].feedback_id
  }
}
