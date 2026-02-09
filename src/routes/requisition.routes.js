import express from 'express'
import * as requisitionController from '../controllers/requisition.controller.js'
import { quotationUpload } from '../utils/file.utils.js'

const router = express.Router()

router.get('/history/:employeeId', requisitionController.getHistory)
router.get('/track-records', requisitionController.getTrackRecords)
router.get('/track-records/:employeeId', requisitionController.getTrackRecordsByEmployee)
router.post('/create', requisitionController.createRequisition)
router.get('/queue-stats', requisitionController.getQueueStats)
router.post('/cancel-delayed-jobs', requisitionController.cancelDelayedJobs)
router.get('/test-email', requisitionController.testEmail)
router.get('/debug/:employeeId', requisitionController.getDebug)
router.get('/report/all/:employeeId', requisitionController.getReportAll)
router.get('/pending/hod/:employeeId', requisitionController.getPendingHod)
router.get('/approved-by-hod/:employeeId', requisitionController.getApprovedByHod)
router.post('/approve/hod', requisitionController.approveHod)
router.get('/pending/committee/:employeeId', requisitionController.getPendingCommittee)
router.post('/approve/committee', requisitionController.approveCommittee)
router.get('/pending/ceo/:employeeId', requisitionController.getPendingCeo)
router.post('/approve/ceo', requisitionController.approveCeo)
router.get('/pending/procurement/:employeeId', requisitionController.getPendingProcurement)
router.post('/acknowledge/procurement', requisitionController.acknowledgeProcurement)
router.put('/quotations/:reqId', requisitionController.updateQuotations)
router.post(
  '/quotations/:reqId/upload',
  quotationUpload.fields([
    { name: 'quotation1', maxCount: 1 },
    { name: 'quotation2', maxCount: 1 },
    { name: 'quotation3', maxCount: 1 }
  ]),
  requisitionController.uploadQuotations
)
router.put('/expected-handover/:reqId', requisitionController.setExpectedHandover)
router.post('/handover/finance', requisitionController.handoverFinance)
router.get('/pending/finance/:employeeId', requisitionController.getPendingFinance)
router.post('/approve/finance', requisitionController.approveFinance)
router.get('/tat-report', requisitionController.getTatReport)
router.get('/tat/:reqId', requisitionController.getTat)
// HOD: update required-by date (must be before GET /:reqId)
router.put('/required-by-date/:reqId', requisitionController.updateRequiredByDate)
// Procurement: mark requisition complete (must be before GET /:reqId)
router.post('/complete-purchase/:reqId', requisitionController.completePurchase)
// List requisitions pending HOD acknowledgment (HOD only)
router.get('/pending/hod-acknowledge/:employeeId', requisitionController.getPendingHodAcknowledge)
// HOD: acknowledge receipt of completed purchase
router.post('/acknowledge-receipt', requisitionController.acknowledgeReceipt)
router.get('/:reqId', requisitionController.getById)

export default router
