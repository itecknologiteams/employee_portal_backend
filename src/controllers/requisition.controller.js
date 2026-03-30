import * as requisitionService from '../services/requisition.service.js'
import * as requisitionEmailDiagnosticsService from '../services/requisitionEmailDiagnostics.service.js'

function sendResult(result, res, fallbackMessage) {
  if (result && result.error != null && result.status != null) {
    return res.status(result.status).json({ error: result.error })
  }
  if (result && Array.isArray(result) && result.length && result[0]?.error) {
    return res.status(500).json({ error: fallbackMessage })
  }
  return res.json(result)
}

export async function getHistory(req, res) {
  try {
    const result = await requisitionService.getHistory(req.params.employeeId, req.query)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('Requisition history error:', error)
    res.status(500).json({ error: 'Failed to fetch requisition history' })
  }
}

export async function getCategories(req, res) {
  try {
    const result = await requisitionService.getCategories()
    res.json(result)
  } catch (error) {
    console.error('Requisition categories error:', error)
    res.status(500).json({ error: 'Failed to fetch categories' })
  }
}

export async function getFlow(req, res) {
  try {
    const stages = await requisitionService.getFlowStages()
    res.json({ stages: stages || [] })
  } catch (error) {
    console.error('Requisition flow error:', error)
    res.status(500).json({ error: 'Failed to fetch flow' })
  }
}

export async function getTrackRecords(req, res) {
  try {
    const result = await requisitionService.getTrackRecords(req.query)
    res.json(result)
  } catch (error) {
    console.error('Track records (all) error:', error)
    res.status(500).json({ error: 'Failed to fetch track records' })
  }
}

export async function getTrackRecordsByEmployee(req, res) {
  try {
    const result = await requisitionService.getTrackRecordsByEmployee(req.params.employeeId, req.query)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('Track records (by employee) error:', error)
    res.status(500).json({ error: 'Failed to fetch track records' })
  }
}

export async function createRequisition(req, res) {
  try {
    const result = await requisitionService.createRequisition(req.body)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('Create requisition error:', error)
    res.status(500).json({ error: 'Failed to create requisition' })
  }
}

export async function getQueueStats(req, res) {
  try {
    const result = await requisitionService.getQueueStats()
    res.json(result)
  } catch (err) {
    console.error('Queue stats error:', err.message)
    res.status(500).json({ enabled: true, error: err.message, hint: 'Is Redis running and REDIS_HOST correct?' })
  }
}

export async function triggerReminderCheck(req, res) {
  try {
    const result = await requisitionService.triggerReminderCheck()
    if (!result.ok) return res.status(400).json(result)
    res.json(result)
  } catch (err) {
    console.error('Trigger reminder check error:', err.message)
    res.status(500).json({ ok: false, error: err.message })
  }
}

export async function cancelDelayedJobs(req, res) {
  try {
    const result = await requisitionService.cancelDelayedJobs()
    res.json(result)
  } catch (err) {
    console.error('Cancel delayed jobs error:', err.message)
    res.status(500).json({ ok: false, error: err.message })
  }
}

export async function testEmail(req, res) {
  try {
    const to = req.query.to
    const result = await requisitionService.sendTestEmail(to)
    if (result.error) return res.status(result.status).json({ ok: false, message: result.error })
    res.json(result)
  } catch (err) {
    console.error('Test email error:', err.message)
    res.status(500).json({ ok: false, error: err.message })
  }
}

export async function getDebug(req, res) {
  try {
    const result = await requisitionService.getDebug(req.params.employeeId)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(result)
  } catch (err) {
    console.error('Debug requisition error:', err)
    res.status(500).json({ error: err.message })
  }
}

/** GET /email-diagnostics?req=123 | ?ref=REF — SuperAdmin or requisition_email_diagnostics permission */
export async function getEmailDiagnostics(req, res) {
  try {
    const user = req.session?.user
    if (!user) return res.status(401).json({ error: 'Not authenticated' })
    const allowed =
      user.userType === 'SuperAdmin' ||
      (Array.isArray(user.permissions) && user.permissions.includes('requisition_email_diagnostics'))
    if (!allowed) return res.status(403).json({ error: 'Forbidden' })
    const idParam = req.query.req ?? req.query.reqId ?? req.query.id
    const ref = req.query.ref ?? req.query.referenceNo
    const raw = idParam != null && String(idParam).trim() !== '' ? idParam : ref
    if (raw == null || String(raw).trim() === '') {
      return res.status(400).json({ error: 'Provide req (requisition id) or ref (reference number)' })
    }
    const reqId = await requisitionEmailDiagnosticsService.resolveRequisitionId(String(raw).trim())
    if (!reqId) return res.status(404).json({ error: 'Requisition not found' })
    const result = await requisitionEmailDiagnosticsService.getRequisitionEmailDiagnostics(reqId)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(result)
  } catch (err) {
    console.error('getEmailDiagnostics error:', err)
    res.status(500).json({ error: 'Failed to load email diagnostics' })
  }
}

export async function getReportAll(req, res) {
  try {
    const result = await requisitionService.getReportAll(req.params.employeeId)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(Array.isArray(result) ? result : [])
  } catch (error) {
    console.error('Report all error:', error)
    res.status(500).json({ error: 'Failed to fetch report' })
  }
}

export async function getPendingCount(req, res) {
  try {
    const result = await requisitionService.getPendingCount(req.params.employeeId)
    res.json(result)
  } catch (error) {
    console.error('Pending count error:', error)
    res.status(500).json({ count: 0, error: 'Failed to fetch pending count' })
  }
}

export async function getPendingHod(req, res) {
  try {
    const result = await requisitionService.getPendingHod(req.params.employeeId)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(Array.isArray(result) ? result : [])
  } catch (error) {
    console.error('Pending HOD error:', error)
    res.status(500).json({ error: 'Failed to fetch pending requisitions' })
  }
}

export async function getApprovedByHod(req, res) {
  try {
    const result = await requisitionService.getApprovedByHod(req.params.employeeId)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(Array.isArray(result) ? result : [])
  } catch (error) {
    console.error('Approved by HOD error:', error)
    res.status(500).json({ error: 'Failed to fetch approved requisitions' })
  }
}

export async function approveHod(req, res) {
  try {
    const result = await requisitionService.approveHod(req.body)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json({ message: result.message, status: result.status })
  } catch (error) {
    console.error('HOD approve error:', error)
    res.status(500).json({ error: 'Failed to update approval' })
  }
}

export async function getPendingHR(req, res) {
  try {
    const result = await requisitionService.getPendingHR(req.params.employeeId)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(Array.isArray(result) ? result : [])
  } catch (error) {
    console.error('Pending HR error:', error)
    res.status(500).json({ error: 'Failed to fetch pending requisitions' })
  }
}

export async function approveHR(req, res) {
  try {
    const result = await requisitionService.approveHR(req.body)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json({ message: result.message, status: result.status })
  } catch (error) {
    console.error('HR approve error:', error)
    res.status(500).json({ error: 'Failed to update approval' })
  }
}

export async function getPendingAdmin(req, res) {
  try {
    const result = await requisitionService.getPendingAdmin(req.params.employeeId)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(Array.isArray(result) ? result : [])
  } catch (error) {
    console.error('Pending Admin error:', error)
    res.status(500).json({ error: 'Failed to fetch pending requisitions' })
  }
}

export async function approveAdmin(req, res) {
  try {
    const result = await requisitionService.approveAdmin(req.body)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json({ message: result.message, status: result.status })
  } catch (error) {
    console.error('Admin approve error:', error)
    res.status(500).json({ error: 'Failed to update approval' })
  }
}

export async function getPendingCommittee(req, res) {
  try {
    const result = await requisitionService.getPendingCommittee(req.params.employeeId)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(Array.isArray(result) ? result : [])
  } catch (error) {
    console.error('Pending Committee error:', error)
    res.status(500).json({ error: 'Failed to fetch pending requisitions' })
  }
}

export async function approveCommittee(req, res) {
  try {
    const result = await requisitionService.approveCommittee(req.body)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json({ message: result.message, status: result.status })
  } catch (error) {
    console.error('Committee approve error:', error)
    res.status(500).json({ error: 'Failed to update approval' })
  }
}

export async function getPendingCeo(req, res) {
  try {
    const result = await requisitionService.getPendingCeo(req.params.employeeId)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(Array.isArray(result) ? result : [])
  } catch (error) {
    console.error('Pending CEO error:', error)
    res.status(500).json({ error: 'Failed to fetch pending requisitions' })
  }
}

export async function approveCeo(req, res) {
  try {
    const result = await requisitionService.approveCeo(req.body)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json({ message: result.message, status: result.status })
  } catch (error) {
    console.error('CEO approve error:', error)
    res.status(500).json({ error: 'Failed to update approval' })
  }
}

export async function getPendingProcurement(req, res) {
  try {
    const result = await requisitionService.getPendingProcurement(req.params.employeeId)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(Array.isArray(result) ? result : [])
  } catch (error) {
    console.error('Pending Procurement error:', error)
    res.status(500).json({ error: 'Failed to fetch requisitions' })
  }
}

export async function acknowledgeProcurement(req, res) {
  try {
    const result = await requisitionService.acknowledgeProcurement(req.body)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json({ message: result.message, status: result.status })
  } catch (error) {
    console.error('Acknowledge procurement error:', error)
    res.status(500).json({ error: 'Failed to acknowledge' })
  }
}

export async function updateQuotations(req, res) {
  try {
    const result = await requisitionService.updateQuotations(req.params.reqId, req.body)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json({ message: result.message, status: result.status })
  } catch (error) {
    console.error('Quotations update error:', error)
    res.status(500).json({ error: 'Failed to update quotations' })
  }
}

export async function uploadQuotations(req, res) {
  try {
    const updatedByEmployeeId = req.body.updatedByEmployeeId
    const result = await requisitionService.uploadQuotations(req.params.reqId, req.files || {}, updatedByEmployeeId)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('Quotation upload error:', error)
    res.status(500).json({ error: 'Failed to upload quotations' })
  }
}

export async function setExpectedHandover(req, res) {
  try {
    const result = await requisitionService.setExpectedHandover(req.params.reqId, req.body)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('Expected handover date error:', error)
    res.status(500).json({ error: 'Failed to update expected handover date' })
  }
}

export async function updateItemsByHod(req, res) {
  try {
    const result = await requisitionService.updateItemsByHod(req.params.reqId, req.body)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('Update items by HOD error:', error)
    res.status(500).json({ error: 'Failed to update items' })
  }
}

export async function updateRequiredByDate(req, res) {
  try {
    const result = await requisitionService.updateRequiredByDate(req.params.reqId, req.body)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('Required by date update error:', error)
    res.status(500).json({ error: 'Failed to update required by date' })
  }
}

export async function completePurchase(req, res) {
  try {
    const result = await requisitionService.completePurchase(req.params.reqId, req.body)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('Complete purchase error:', error)
    res.status(500).json({ error: 'Failed to mark complete' })
  }
}

export async function getPendingAdminExecution(req, res) {
  try {
    const result = await requisitionService.getPendingAdminExecution(req.params.employeeId)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(Array.isArray(result) ? result : [])
  } catch (error) {
    console.error('Pending Admin Execution error:', error)
    res.status(500).json({ error: 'Failed to fetch' })
  }
}

export async function getPendingHodAcknowledge(req, res) {
  try {
    const result = await requisitionService.getPendingHodAcknowledge(req.params.employeeId)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(Array.isArray(result) ? result : [])
  } catch (error) {
    if (error.code === '42703') return res.json([])
    console.error('Pending HOD acknowledge error:', error)
    res.status(500).json({ error: 'Failed to fetch' })
  }
}

export async function acknowledgeReceipt(req, res) {
  try {
    const result = await requisitionService.acknowledgeReceipt(req.body)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(result)
  } catch (error) {
    if (error.code === '42703') return res.status(500).json({ error: 'Database migration required: run requisition-complete-hod-ack.sql' })
    console.error('Acknowledge receipt error:', error)
    res.status(500).json({ error: 'Failed to acknowledge receipt' })
  }
}

export async function getPendingCreatorAcknowledge(req, res) {
  try {
    const result = await requisitionService.getPendingCreatorAcknowledge(req.params.employeeId)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(Array.isArray(result) ? result : [])
  } catch (error) {
    console.error('Pending creator acknowledge error:', error)
    res.status(500).json({ error: 'Failed to fetch requisitions' })
  }
}

export async function acknowledgeByCreator(req, res) {
  try {
    const result = await requisitionService.acknowledgeByCreator(req.body)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json({ message: result.message, status: result.status })
  } catch (error) {
    console.error('Acknowledge by creator error:', error)
    res.status(500).json({ error: 'Failed to acknowledge' })
  }
}

export async function handoverFinance(req, res) {
  try {
    const result = await requisitionService.handoverFinance(req.body)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json({ message: result.message, status: result.status })
  } catch (error) {
    console.error('Handover finance error:', error)
    res.status(500).json({ error: 'Failed to hand over' })
  }
}

export async function getPendingFinance(req, res) {
  try {
    const result = await requisitionService.getPendingFinance(req.params.employeeId)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(Array.isArray(result) ? result : [])
  } catch (error) {
    console.error('Pending Finance error:', error)
    res.status(500).json({ error: 'Failed to fetch requisitions' })
  }
}

export async function approveFinance(req, res) {
  try {
    const result = await requisitionService.approveFinance(req.body)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json({ message: result.message, status: result.status })
  } catch (error) {
    console.error('Finance approve error:', error)
    res.status(500).json({ error: 'Failed to approve' })
  }
}

export async function getTatReport(req, res) {
  try {
    const result = await requisitionService.getTatReport(req.query)
    res.json(result)
  } catch (error) {
    console.error('TAT report error:', error)
    res.status(500).json({ error: 'Failed to fetch TAT report' })
  }
}

export async function getTat(req, res) {
  try {
    const result = await requisitionService.getTat(req.params.reqId)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('TAT error:', error)
    res.status(500).json({ error: 'Failed to fetch TAT' })
  }
}

export async function getById(req, res) {
  const reqId = req.params.reqId
  const id = parseInt(reqId, 10)
  if (!reqId || Number.isNaN(id) || id < 1) {
    return res.status(404).json({ error: 'Requisition not found' })
  }
  try {
    const result = await requisitionService.getById(id)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('Get requisition error:', error)
    res.status(500).json({ error: 'Failed to fetch requisition' })
  }
}
