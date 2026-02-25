import express from 'express'
import * as payrollController from '../controllers/payroll.controller.js'
import { payrollExcelUpload } from '../utils/file.utils.js'

const router = express.Router()

// ---------- Employee search (must be before /periods/:id) ----------
router.get('/employees', payrollController.searchEmployees)

// ---------- Gross salaries (upload route first so /upload is matched before :id-style) ----------
router.get('/gross-salaries', payrollController.listGrossSalaries)
router.post('/gross-salaries/upload', payrollExcelUpload.single('file'), payrollController.uploadGrossSalaries)
router.post('/gross-salaries', payrollController.addGrossSalary)

// ---------- Payroll periods ----------
router.get('/periods', payrollController.listPeriods)
router.post('/periods', payrollController.createPeriod)
router.get('/periods/:id', payrollController.getPeriodById)
router.delete('/periods/:id', payrollController.deletePeriod)
router.get('/periods/:id/overrides', payrollController.getOverrides)
router.put('/periods/:id/overrides', payrollController.saveOverrides)
router.post('/periods/:id/run', payrollController.runPayroll)
router.post('/periods/:id/close', payrollController.closePeriod)
router.get('/periods/:id/slips', payrollController.listSlips)

// ---------- Designation allowances ----------
router.get('/designation-allowances', payrollController.listDesignationAllowances)
router.put('/designation-allowances', payrollController.saveDesignationAllowances)

// ---------- Salary structures ----------
router.get('/salary-structures', payrollController.listSalaryStructures)
router.get('/salary-structures/:employeeId', payrollController.getSalaryStructureByEmployee)
router.post('/salary-structures', payrollController.saveSalaryStructure)

export default router
