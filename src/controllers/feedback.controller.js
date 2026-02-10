import * as feedbackService from '../services/feedback.service.js'

export async function getFeedbackHistory(req, res) {
  try {
    const employeeId = req.params.employeeId ?? req.params.employee_id
    const history = await feedbackService.getFeedbackHistory(employeeId)
    if (history?.error) {
      return res.status(history.status).json({ error: history.error })
    }
    return res.json(history)
  } catch (error) {
    console.error('Feedback history error:', error)
    return res.status(500).json({ error: 'Failed to fetch feedback history' })
  }
}

export async function submitFeedback(req, res) {
  try {
    debugger
    const result = await feedbackService.submitFeedback(req.body)
    if (result?.error) {
      return res.status(result.status).json({ error: result.error, details: result.details })
    }
    return res.status(201).json(result)
  } catch (error) {
    console.error('Submit feedback error:', error)
    return res.status(500).json({ error: 'Failed to submit feedback' })
  }
}
