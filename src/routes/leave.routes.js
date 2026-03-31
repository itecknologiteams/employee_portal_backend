import express from 'express'
import * as leaveController from '../controllers/leave.controller.js'

const router = express.Router()

router.get('/balance/:employeeCode', leaveController.getLeaveBalance)
router.get('/requests/:employeeCode', leaveController.getLeaveRequests)
router.get('/pending/hod/:employeeCode', leaveController.getPendingHod)
router.get('/hr/list/:employeeCode', leaveController.getHrList)
router.get('/hr/pending/:employeeCode', leaveController.getPendingHr)
router.put('/hr/balance/:employeeCode', leaveController.hrPutLeaveBalance)
router.post('/request', leaveController.createLeaveRequest)
router.put('/request/:leaveRequestId/status', leaveController.updateLeaveStatus)

export default router
