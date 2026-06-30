import express from 'express'
import multer from 'multer'
import * as ctrl from '../controllers/ted.controller.js'

const router = express.Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } })

// HR
router.post('/sessions', upload.single('presentation'), ctrl.createSession)
router.get('/sessions', ctrl.listSessions)
router.get('/sessions/:id', ctrl.getSession)
router.post('/sessions/:id/generate-quiz', ctrl.generateQuiz)
router.post('/sessions/:id/questions', ctrl.saveQuestion)
router.post('/sessions/:id/publish', ctrl.publishSession)
router.post('/sessions/:id/reopen', ctrl.reopenSession)
router.get('/sessions/:id/assignments', ctrl.assignmentsDashboard)

// Employee
router.get('/my-trainings', ctrl.myTrainings)
router.get('/sessions/:id/quiz', ctrl.getQuiz)
router.post('/sessions/:id/quiz/submit', ctrl.submitQuiz)

export default router
