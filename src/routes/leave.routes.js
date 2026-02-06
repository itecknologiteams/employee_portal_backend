import express from 'express'
import * as leaveController from '../controllers/leave.controller.js'

const router = express.Router()

router.get('/balance/:employeeId', leaveController.getLeaveBalance)
router.get('/requests/:employeeId', leaveController.getLeaveRequests)
router.post('/request', leaveController.createLeaveRequest)

export default router
