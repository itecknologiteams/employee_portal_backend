import express from 'express'
import * as dashboardController from '../controllers/dashboard.controller.js'

const router = express.Router()

router.get('/stats/:employeeCode', dashboardController.getStats)
router.get('/stats', dashboardController.getStats)
router.get('/activities/:employeeCode', dashboardController.getActivities)
router.get('/activities', dashboardController.getActivities)

export default router
