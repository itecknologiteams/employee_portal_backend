import express from 'express'
import * as payrollController from '../controllers/payrollDb.controller.js'
import { requirePermission } from '../middleware/requirePermission.js'
import { payrollExcelUpload } from '../utils/file.utils.js'

const router = express.Router()

// All payroll-DB operations require the 'payroll' permission (HR/payroll staff only).
router.use(requirePermission('payroll'))

// Allowance / Deduction sheets (shared template; ?type=allowance|deduction)
router.get('/element-sheet/template', payrollController.downloadElementSheetTemplate)
router.post('/periods/:payrollId/element-sheet', payrollExcelUpload.single('file'), payrollController.uploadElementSheet)

// Salary-structure sync (portal employee_salary_structure -> payroll element template)
router.post('/structure/sync/:employeeCode', payrollController.syncStructure)
router.post('/structure/sync-all', payrollController.syncAllStructures)

// Loan/Advance: manual (re)sync of a Finance-approved requisition into the payroll DB
router.post('/loan/sync/:reqId', payrollController.syncLoan)
router.get('/loans/:employeeCode', payrollController.getLoans)

// Payroll periods + period-wide slip generation (HR payroll run)
router.get('/periods', payrollController.listPeriods)
router.get('/periods/:payrollId/slips', payrollController.listPeriodSlips)
router.post('/periods/:payrollId/generate-all', payrollController.generateAllForPeriod)

// Payroll slips (element-normalized)
router.post('/slip/generate', payrollController.generateSlip)
router.get('/slip/:employeeCode/:payrollId', payrollController.getSlip)
router.get('/slips/:employeeCode', payrollController.listSlips)

export default router
