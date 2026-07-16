import express from 'express'
import * as salaryController from '../controllers/salary.controller.js'

const router = express.Router()

// List all salary slips for employee (payroll + old + legacy). Id format: "p-123", "o-456", "s-789"
router.get('/slips/:employeeCode', salaryController.listSlips)

// List only old (imported) salary slips – for "Old salary slips" tab
router.get('/old-slips/:employeeCode', salaryController.listOldSlips)

// One old slip by numeric id. Query: ?employeeCode= required (for frontend GET /api/salary/old-slip/:id)
router.get('/old-slip/:id', salaryController.getOldSlip)

// Get one slip by id ("p-123", "o-456", "s-789"). Query: ?employeeCode= required
router.get('/slip/:id', salaryController.getSlip)

// Legacy: current month salary
router.get('/current/:employeeCode', salaryController.getCurrentSalary)

// Legacy: history (different shape)
router.get('/history/:employeeCode', salaryController.getSalaryHistory)

// Download: slip data. Query: ?employeeCode= required
router.get('/download/:salarySlipId', salaryController.downloadSalarySlip)

// Income tax certificate (FBR rule 42): totals for the latest fiscal year (Jul 1 – Jun 30)
router.get('/tax-certificate/:employeeCode', salaryController.getTaxCertificate)
// Eligibility: whether the employee has an NTN (gates the download button on the Salary Slip page)
router.get('/tax-certificate/:employeeCode/status', salaryController.getTaxCertificateStatus)
// Fiscal years with a stored certificate for this employee (powers the fiscal-year dropdown)
router.get('/tax-certificate/:employeeCode/fiscal-years', salaryController.getTaxCertificateFiscalYears)

// FPIN: status (has set?), set, verify – for salary slip view protection
router.get('/fpin/status/:employeeCode', salaryController.getFpinStatus)
router.post('/fpin/set', salaryController.setFpin)
router.post('/fpin/verify', salaryController.verifyFpin)
// FPIN reset: request OTP by email, then verify OTP + set new 4-digit PIN
router.post('/fpin/reset-request', salaryController.requestFpinReset)
router.post('/fpin/reset', salaryController.resetFpinWithCode)

// Upload old salary slips (import from SQL Server). Body: { slips: [...] }
router.post('/old-slips', salaryController.createOldSlips)

export default router
