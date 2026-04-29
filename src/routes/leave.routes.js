import express from 'express'
import * as leaveController from '../controllers/leave.controller.js'

const router = express.Router()

// Leave Types
router.get('/types', leaveController.getLeaveTypes)

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
router.get('/pending/hr/:employeeCode', leaveController.getPendingHr)
router.get('/pending/ceo/:employeeCode', leaveController.getPendingCeo)
router.get('/hr/list/:employeeCode', leaveController.getHrList)
router.put('/hr/balance/:employeeCode', leaveController.hrPutLeaveBalance)
router.post('/hr/deduction', leaveController.hrDeductLeave)
router.put('/hr/deduction/:deductionId', leaveController.hrEditDeduction)
router.get('/hr/deductions', leaveController.getHrDeductionLog)
router.post('/request', leaveController.createLeaveRequest)
router.put('/request/:leaveRequestId/status', leaveController.updateLeaveStatus)
router.post('/ics/receive', leaveController.receiveIcsLeaveRequest)
router.post('/ics/hod-action', leaveController.hodIcsAction)
router.get('/ics/decisions', leaveController.getIcsDecisions)

/** Proxy endpoint for external Attendance System API (casual/sick leaves) */
router.post('/external-leaves', leaveController.getExternalLeaves)

export default router