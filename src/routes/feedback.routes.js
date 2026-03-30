import express from 'express'
import * as feedbackController from '../controllers/feedback.controller.js'

const router = express.Router()

router.get('/', feedbackController.getAllFeedback)
router.get('/all', feedbackController.getAllFeedback)
router.get('/history/:employeeCode', feedbackController.getFeedbackHistory)
router.post('/', feedbackController.submitFeedback)
router.post('/submit', feedbackController.submitFeedback)

export default router
