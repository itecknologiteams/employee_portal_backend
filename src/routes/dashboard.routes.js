import express from 'express'
import * as dashboardController from '../controllers/dashboard.controller.js'

const router = express.Router()

router.get('/stats', dashboardController.getStats)
router.get('/activities', dashboardController.getActivities)

export default router
