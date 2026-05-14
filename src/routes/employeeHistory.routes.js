import express from 'express'
import * as ctrl from '../controllers/employeeHistory.controller.js'

const router = express.Router()

router.get('/employees/:id/history', ctrl.list)
router.post('/employees/:id/history', ctrl.create)
router.get('/employees/:id/history/:eventId', ctrl.getOne)
router.put('/employees/:id/history/:eventId', ctrl.update)
router.delete('/employees/:id/history/:eventId', ctrl.remove)

export default router
