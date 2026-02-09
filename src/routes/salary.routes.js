import express from 'express'
import * as salaryController from '../controllers/salary.controller.js'

const router = express.Router()

// List all salary slips for employee (payroll + legacy). Id format: "p-123" or "s-456"
router.get('/slips/:employeeId', salaryController.listSlips)

// Get one slip by id. Query: ?employeeId= required
router.get('/slip/:id', salaryController.getSlip)

// Legacy: current month salary
router.get('/current/:employeeId', salaryController.getCurrentSalary)

// Legacy: history (different shape)
router.get('/history/:employeeId', salaryController.getSalaryHistory)

// Download: slip data. Query: ?employeeId= required
router.get('/download/:salarySlipId', salaryController.downloadSalarySlip)

export default router
