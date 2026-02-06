import * as feedbackService from '../services/feedback.service.js'

export async function getFeedbackHistory(req, res) {
  try {
    const { employeeId } = req.params
    const history = await feedbackService.getFeedbackHistory(employeeId)
    res.json(history)
  } catch (error) {
    console.error('Feedback history error:', error)
    res.status(500).json({ error: 'Failed to fetch feedback history' })
  }
}

export async function submitFeedback(req, res) {
  try {
    const { employeeId, subject, category, message, rating } = req.body
    const result = await feedbackService.submitFeedback({
      employeeId, subject, category, message, rating
    })
    res.json(result)
  } catch (error) {
    console.error('Submit feedback error:', error)
    res.status(500).json({ error: 'Failed to submit feedback' })
  }
}
