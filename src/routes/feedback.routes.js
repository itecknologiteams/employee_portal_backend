import express from 'express'
import * as feedbackController from '../controllers/feedback.controller.js'

const router = express.Router()

router.get('/history/:employeeId', feedbackController.getFeedbackHistory)
router.get('/history/:employee_id', feedbackController.getFeedbackHistory)
router.post('/', feedbackController.submitFeedback)
router.post('/submit', feedbackController.submitFeedback)

export default router
