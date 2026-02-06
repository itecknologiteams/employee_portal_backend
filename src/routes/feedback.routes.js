import express from 'express'
import * as feedbackController from '../controllers/feedback.controller.js'

const router = express.Router()

router.get('/history/:employeeId', feedbackController.getFeedbackHistory)
router.post('/submit', feedbackController.submitFeedback)

export default router
