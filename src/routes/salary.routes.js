import express from 'express'
import * as salaryController from '../controllers/salary.controller.js'

const router = express.Router()

// List all salary slips for employee (payroll + old + legacy). Id format: "p-123", "o-456", "s-789"
router.get('/slips/:employeeId', salaryController.listSlips)

// List only old (imported) salary slips – for "Old salary slips" tab
router.get('/old-slips/:employeeId', salaryController.listOldSlips)

// One old slip by numeric id. Query: ?employeeId= required (for frontend GET /api/salary/old-slip/:id)
router.get('/old-slip/:id', salaryController.getOldSlip)

// Get one slip by id ("p-123", "o-456", "s-789"). Query: ?employeeId= required
router.get('/slip/:id', salaryController.getSlip)

// Legacy: current month salary
router.get('/current/:employeeId', salaryController.getCurrentSalary)

// Legacy: history (different shape)
router.get('/history/:employeeId', salaryController.getSalaryHistory)

// Download: slip data. Query: ?employeeId= required
router.get('/download/:salarySlipId', salaryController.downloadSalarySlip)

// FPIN: status (has set?), set, verify – for salary slip view protection
router.get('/fpin/status/:employeeId', salaryController.getFpinStatus)
router.post('/fpin/set', salaryController.setFpin)
router.post('/fpin/verify', salaryController.verifyFpin)

// Upload old salary slips (import from SQL Server). Body: { slips: [...] }
router.post('/old-slips', salaryController.createOldSlips)

export default router
