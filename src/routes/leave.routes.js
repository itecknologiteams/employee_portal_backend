import express from 'express'
import * as leaveController from '../controllers/leave.controller.js'

const router = express.Router()

router.get('/balance/:employeeCode', leaveController.getLeaveBalance)
router.get('/balance-with-code/:employeeCode', leaveController.getLeaveBalanceWithCode)
router.get('/calculate-annual-leave/:employeeCode', leaveController.calculateAnnualLeave)
router.get('/hr/rollover-eligibility/:employeeCode', leaveController.checkRolloverEligibility)
router.post('/hr/rollover-annual-leave/:employeeCode', leaveController.hrRolloverAnnualLeave)
router.post('/hr/bulk-rollover', leaveController.hrBulkRollover)
router.get('/hr/all-balances', leaveController.getAllLeaveBalances)
router.post('/hr/bulk-import', leaveController.hrBulkImportBalances)
router.post('/hr/allocate-all', leaveController.allocateAllEmployees)
router.post('/hr/import-carried-forward', leaveController.importCarriedForward)
router.get('/requests/:employeeCode', leaveController.getLeaveRequests)
router.get('/pending/hod/:employeeCode', leaveController.getPendingHod)
router.get('/hr/list/:employeeCode', leaveController.getHrList)
router.get('/hr/pending/:employeeCode', leaveController.getPendingHr)
router.put('/hr/balance/:employeeCode', leaveController.hrPutLeaveBalance)
router.post('/hr/deduction', leaveController.hrDeductLeave)
router.put('/hr/deduction/:deductionId', leaveController.hrEditDeduction)
router.get('/hr/deductions', leaveController.getHrDeductionLog)
router.post('/request', leaveController.createLeaveRequest)
router.put('/request/:leaveRequestId/status', leaveController.updateLeaveStatus)

export default router
