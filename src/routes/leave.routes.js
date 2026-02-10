import express from 'express'
import * as leaveController from '../controllers/leave.controller.js'

const router = express.Router()

router.get('/balance/:employeeId', leaveController.getLeaveBalance)
router.get('/requests/:employeeId', leaveController.getLeaveRequests)
router.get('/pending/hod/:employeeId', leaveController.getPendingHod)
router.get('/hr/list/:employeeId', leaveController.getHrList)
router.get('/hr/pending/:employeeId', leaveController.getPendingHr)
router.post('/request', leaveController.createLeaveRequest)
router.put('/request/:leaveRequestId/status', leaveController.updateLeaveStatus)

export default router
