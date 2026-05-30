import express from 'express'
import * as ctrl from '../controllers/autoPayroll.controller.js'
import { payrollExcelUpload } from '../utils/file.utils.js'

const router = express.Router()

// Periods
router.post('/periods', ctrl.createPeriod)
router.get('/periods', ctrl.listPeriods)
router.get('/periods/:id', ctrl.getPeriod)
router.delete('/periods/:id', ctrl.deletePeriod)

// Entries (variable allowances + deductions)
router.post('/periods/:id/entries', ctrl.upsertEntry)
router.post('/periods/:id/entries/upload', payrollExcelUpload.single('file'), ctrl.uploadEntries)
router.get('/periods/:id/entries', ctrl.listEntries)
router.delete('/entries/:entryId', ctrl.deleteEntry)

// Run + Slips
router.post('/periods/:id/run', ctrl.runPayroll)
router.get('/periods/:id/slips', ctrl.listSlips)
router.patch('/slips/:slipId', ctrl.updateSlip)
router.post('/periods/:id/publish', ctrl.publish)

export default router
