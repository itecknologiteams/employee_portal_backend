import express from 'express'
import * as requisitionController from '../controllers/requisition.controller.js'
import { quotationUpload, supportDocUpload } from '../utils/file.utils.js'

const router = express.Router()

// Literal paths first (before any :param routes) so they are never matched as :reqId
router.get('/categories', requisitionController.getCategories)
router.get('/flow', requisitionController.getFlow)
router.get('/queue-stats', requisitionController.getQueueStats)
router.post('/trigger-reminder-check', requisitionController.triggerReminderCheck)
router.get('/trigger-reminder-check', requisitionController.triggerReminderCheck)
router.post('/cancel-delayed-jobs', requisitionController.cancelDelayedJobs)
router.get('/test-email', requisitionController.testEmail)
router.get('/email-diagnostics', requisitionController.getEmailDiagnostics)

router.get('/history/:employeeCode', requisitionController.getHistory)
router.get('/track-records', requisitionController.getTrackRecords)
router.get('/track-records/:employeeCode', requisitionController.getTrackRecordsByEmployee)
router.post('/create', requisitionController.createRequisition)
router.get('/debug/:employeeCode', requisitionController.getDebug)
router.get('/report/all/:employeeCode', requisitionController.getReportAll)
router.get('/pending/count/:employeeCode', requisitionController.getPendingCount)
router.get('/pending/hod/:employeeCode', requisitionController.getPendingHod)
router.get('/approved-by-hod/:employeeCode', requisitionController.getApprovedByHod)
router.get('/approved-by-committee/:employeeCode', requisitionController.getApprovedByCommittee)
router.get('/approved-by-ceo/:employeeCode', requisitionController.getApprovedByCeo)
router.post('/approve/hod', requisitionController.approveHod)
router.get('/pending/hr/:employeeCode', requisitionController.getPendingHR)
router.post('/approve/hr', requisitionController.approveHR)
router.get('/pending/hr-check/', requisitionController.getPendingHRCheck)
router.post('/approve/hr-check', requisitionController.approveHRCheck)
router.get('/pending/admin/:employeeCode', requisitionController.getPendingAdmin)
router.post('/approve/admin', requisitionController.approveAdmin)
router.get('/pending/committee/:employeeCode', requisitionController.getPendingCommittee)
router.post('/approve/committee', requisitionController.approveCommittee)
router.get('/pending/ceo/:employeeCode', requisitionController.getPendingCeo)
router.post('/approve/ceo', requisitionController.approveCeo)
router.get('/pending/procurement/:employeeCode', requisitionController.getPendingProcurement)
router.post('/acknowledge/procurement', requisitionController.acknowledgeProcurement)
router.post('/reject/procurement', requisitionController.rejectProcurement)
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
router.post(
  '/support-docs/:reqId/upload',
  supportDocUpload.fields([
    { name: 'supportDoc1', maxCount: 1 },
    { name: 'supportDoc2', maxCount: 1 },
    { name: 'supportDoc3', maxCount: 1 }
  ]),
  requisitionController.uploadSupportDocs
)
router.put('/expected-handover/:reqId', requisitionController.setExpectedHandover)
router.post('/handover/finance', requisitionController.handoverFinance)
router.get('/pending/finance/:employeeCode', requisitionController.getPendingFinance)
router.post('/approve/finance', requisitionController.approveFinance)
router.get('/tat-report', requisitionController.getTatReport)
router.get('/tat/:reqId', requisitionController.getTat)
// HOD: update required-by date (must be before GET /:reqId)
router.put('/required-by-date/:reqId', requisitionController.updateRequiredByDate)
// HOD: edit items (description, size, brand, qty, cost, remarks) only while in HOD bucket
router.put('/:reqId/items', requisitionController.updateItemsByHod)
// HOD: add a single item (only while in HOD bucket)
router.post('/:reqId/items', requisitionController.addItemByHod)
// HOD: delete a single item (only while in HOD bucket, at least 1 item must remain)
router.delete('/:reqId/items/:itemId', requisitionController.deleteItemByHod)
// Procurement: mark requisition complete (must be before GET /:reqId)
router.post('/complete-purchase/:reqId', requisitionController.completePurchase)
router.get('/pending/admin-execution/:employeeCode', requisitionController.getPendingAdminExecution)
router.get('/pending/admin-acknowledge/:employeeCode', requisitionController.getPendingAdminAcknowledge)
router.post('/acknowledge/admin', requisitionController.acknowledgeAdminStage)
router.get('/pending/admin-handover/:employeeCode', requisitionController.getPendingAdminHandover)
router.post('/handover/admin', requisitionController.handoverByAdmin)
// List requisitions pending HOD acknowledgment (HOD only)
router.get('/pending/hod-acknowledge/:employeeCode', requisitionController.getPendingHodAcknowledge)
// HOD: acknowledge receipt of completed purchase
router.post('/acknowledge-receipt', requisitionController.acknowledgeReceipt)
// Creator: acknowledge to close ticket (after execution department)
router.get('/pending/creator-acknowledge/:employeeCode', requisitionController.getPendingCreatorAcknowledge)
router.post('/acknowledge-by-creator', requisitionController.acknowledgeByCreator)
// SuperAdmin: toggle hidden status (soft delete/restore)
router.post('/:reqId/hide', requisitionController.toggleHidden)

// SuperAdmin: get all requisitions including hidden ones (must be before GET /:reqId)
router.get('/admin/all', requisitionController.getAllRequisitionsForAdmin)

// ================= REVERT & REVIEW FEATURE ROUTES =================

// POST /requisition/revert - Revert a requisition back to HOD for review
router.post('/revert', requisitionController.revertForReview)

// POST /requisition/resubmit - Resubmit a requisition after HOD corrections (skips intermediate stages)
router.post('/resubmit', requisitionController.resubmitAfterRevert)

// GET /requisition/pending/hod-reverted/:employeeCode - Get requisitions reverted to HOD for correction
router.get('/pending/hod-reverted/:employeeCode', requisitionController.getPendingHodReverted)

// GET /requisition/my-reverted/:employeeCode - Get reverted requisitions for a specific employee (creator view)
router.get('/my-reverted/:employeeCode', requisitionController.getMyRevertedRequisitions)

router.get('/:reqId', requisitionController.getById)


export default router


