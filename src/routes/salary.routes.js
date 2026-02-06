import express from 'express'
import * as salaryController from '../controllers/salary.controller.js'

const router = express.Router()

router.get('/current/:employeeId', salaryController.getCurrentSalary)
router.get('/history/:employeeId', salaryController.getSalaryHistory)
router.get('/download/:salarySlipId', salaryController.downloadSalarySlip)

export default router
