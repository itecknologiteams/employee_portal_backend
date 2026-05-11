import * as requisitionService from '../services/requisition.service.js'
import * as requisitionEmailDiagnosticsService from '../services/requisitionEmailDiagnostics.service.js'
import * as reqRepo from '../repositories/requisition.repository.js'
import { getEmployeeIdByCode } from '../repositories/auth.repository.js'

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
    const employeeId = await getEmployeeIdByCode(req.params.employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const result = await requisitionService.getHistory(employeeId, req.query)
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
    const employeeId = await getEmployeeIdByCode(req.params.employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const result = await requisitionService.getTrackRecordsByEmployee(employeeId, req.query)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('Track records (by employee) error:', error)
    res.status(500).json({ error: 'Failed to fetch track records' })
  }
}

export async function createRequisition(req, res) {
  try {
    const body = { ...req.body }
    if (body.employeeCode && !body.employeeId) {
      const resolvedId = await getEmployeeIdByCode(body.employeeCode)
      if (!resolvedId) return res.status(404).json({ error: 'Employee not found' })
      body.employeeId = resolvedId
    }
    const result = await requisitionService.createRequisition(body)
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
    const employeeId = await getEmployeeIdByCode(req.params.employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const result = await requisitionService.getDebug(employeeId)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(result)
  } catch (err) {
    console.error('Debug requisition error:', err)
    res.status(500).json({ error: err.message })
  }
}

/** GET /email-diagnostics?req=123 | ?ref=REF ΓÇö SuperAdmin or requisition_email_diagnostics permission */
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
    const employeeId = await getEmployeeIdByCode(req.params.employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const result = await requisitionService.getReportAll(employeeId)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(Array.isArray(result) ? result : [])
  } catch (error) {
    console.error('Report all error:', error)
    res.status(500).json({ error: 'Failed to fetch report' })
  }
}

export async function getPendingCount(req, res) {
  try {
    const employeeId = await getEmployeeIdByCode(req.params.employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const result = await requisitionService.getPendingCount(employeeId)
    res.json(result)
  } catch (error) {
    console.error('Pending count error:', error)
    res.status(500).json({ count: 0, error: 'Failed to fetch pending count' })
  }
}

export async function getPendingHod(req, res) {
  try {
    const employeeId = await getEmployeeIdByCode(req.params.employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const result = await requisitionService.getPendingHod(employeeId)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(Array.isArray(result) ? result : [])
  } catch (error) {
    console.error('Pending HOD error:', error)
    res.status(500).json({ error: 'Failed to fetch pending requisitions' })
  }
}

export async function getApprovedByHod(req, res) {
  try {
    const employeeId = await getEmployeeIdByCode(req.params.employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const result = await requisitionService.getApprovedByHod(employeeId)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(Array.isArray(result) ? result : [])
  } catch (error) {
    console.error('Approved by HOD error:', error)
    res.status(500).json({ error: 'Failed to fetch approved requisitions' })
  }
}

export async function getApprovedByCommittee(req, res) {
  try {
    const employeeId = await getEmployeeIdByCode(req.params.employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const result = await requisitionService.getApprovedByCommittee(employeeId)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(Array.isArray(result) ? result : [])
  } catch (error) {
    console.error('Approved by Committee error:', error)
    res.status(500).json({ error: 'Failed to fetch approved requisitions' })
  }
}

export async function getApprovedByCeo(req, res) {
  try {
    const employeeId = await getEmployeeIdByCode(req.params.employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const result = await requisitionService.getApprovedByCeo(employeeId)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(Array.isArray(result) ? result : [])
  } catch (error) {
    console.error('Approved by CEO error:', error)
    res.status(500).json({ error: 'Failed to fetch approved requisitions' })
  }
}

export async function getApprovedByAdmin(req, res) {
  try {
    const employeeId = await getEmployeeIdByCode(req.params.employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const result = await requisitionService.getApprovedByAdmin(employeeId)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(Array.isArray(result) ? result : [])
  } catch (error) {
    console.error('Approved by Admin error:', error)
    res.status(500).json({ error: 'Failed to fetch approved requisitions' })
  }
}

export async function getApprovedByProcurement(req, res) {
  try {
    const employeeId = await getEmployeeIdByCode(req.params.employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const result = await requisitionService.getApprovedByProcurement(employeeId)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(Array.isArray(result) ? result : [])
  } catch (error) {
    console.error('Approved by Procurement error:', error)
    res.status(500).json({ error: 'Failed to fetch approved requisitions' })
  }
}

export async function getApprovedByFinance(req, res) {
  try {
    const employeeId = await getEmployeeIdByCode(req.params.employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const result = await requisitionService.getApprovedByFinance(employeeId)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(Array.isArray(result) ? result : [])
  } catch (error) {
    console.error('Approved by Finance error:', error)
    res.status(500).json({ error: 'Failed to fetch approved requisitions' })
  }
}

export async function getApprovedByHR(req, res) {
  try {
    const employeeId = await getEmployeeIdByCode(req.params.employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const result = await requisitionService.getApprovedByHr(employeeId)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(Array.isArray(result) ? result : [])
  } catch (error) {
    console.error('Approved by HR error:', error)
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
    const employeeId = await getEmployeeIdByCode(req.params.employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const result = await requisitionService.getPendingHR(employeeId)
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

export async function getPendingHRCheck(req, res) {
  try {
    const result = await requisitionService.getPendingHRCheck(req.query.empCode)
    if (result?.error) return res.status(result.status).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('getPendingHRCheck error:', error)
    res.status(500).json({ error: 'Failed to fetch HR check pending list' })
  }
}

export async function approveHRCheck(req, res) {
  try {
    const result = await requisitionService.approveHRCheck(req.body)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json({ message: result.message, status: result.status })
  } catch (error) {
    console.error('HR Check approve error:', error)
    res.status(500).json({ error: 'Failed to update approval' })
  }
}

export async function getPendingAdmin(req, res) {
  try {
    const employeeId = await getEmployeeIdByCode(req.params.employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const result = await requisitionService.getPendingAdmin(employeeId)
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
    const employeeId = await getEmployeeIdByCode(req.params.employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const result = await requisitionService.getPendingCommittee(employeeId)
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
    const employeeId = await getEmployeeIdByCode(req.params.employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const result = await requisitionService.getPendingCeo(employeeId)
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
    const employeeId = await getEmployeeIdByCode(req.params.employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const result = await requisitionService.getPendingProcurement(employeeId)
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

export async function rejectProcurement(req, res) {
  try {
    const result = await requisitionService.rejectProcurement(req.body)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json({ message: result.message, status: result.status })
  } catch (error) {
    console.error('Reject procurement error:', error)
    res.status(500).json({ error: 'Failed to reject' })
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
    const updatedByEmployeeCode = req.body.updatedByEmployeeCode
    const result = await requisitionService.uploadQuotations(req.params.reqId, req.files || {}, updatedByEmployeeId, updatedByEmployeeCode)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('Quotation upload error:', error)
    res.status(500).json({ error: 'Failed to upload quotations' })
  }
}

export async function uploadSupportDocs(req, res) {
  try {
    const result = await requisitionService.uploadSupportDocs(
      req.params.reqId, req.files || {},
      req.body.updatedByEmployeeId, req.body.updatedByEmployeeCode
    )
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('Support docs upload error:', error)
    res.status(500).json({ error: 'Failed to upload supporting documents' })
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

export async function deleteItemByHod(req, res) {
  try {
    const result = await requisitionService.deleteItemByHod(req.params.reqId, req.params.itemId)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('Delete item by HOD error:', error)
    res.status(500).json({ error: 'Failed to delete item' })
  }
}

export async function addItemByHod(req, res) {
  try {
    const result = await requisitionService.addItemByHod(req.params.reqId, req.body)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('Add item by HOD error:', error)
    res.status(500).json({ error: 'Failed to add item' })
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

export async function getPendingAdminAcknowledge(req, res) {
  try {
    const employeeId = await getEmployeeIdByCode(req.params.employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const result = await requisitionService.getPendingAdminAcknowledge(employeeId)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(Array.isArray(result) ? result : [])
  } catch (error) {
    console.error('Pending Admin Acknowledge error:', error)
    res.status(500).json({ error: 'Failed to fetch' })
  }
}

export async function acknowledgeAdminStage(req, res) {
  try {
    const result = await requisitionService.acknowledgeAdminStage(req.body)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json({ message: result.message, status: result.status })
  } catch (error) {
    console.error('Admin acknowledge error:', error)
    res.status(500).json({ error: 'Failed to acknowledge' })
  }
}

export async function getPendingAdminHandover(req, res) {
  try {
    const employeeId = await getEmployeeIdByCode(req.params.employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const result = await requisitionService.getPendingAdminHandover(employeeId)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(Array.isArray(result) ? result : [])
  } catch (error) {
    console.error('Pending Admin Handover error:', error)
    res.status(500).json({ error: 'Failed to fetch' })
  }
}

export async function handoverByAdmin(req, res) {
  try {
    const result = await requisitionService.handoverByAdmin(req.body)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json({ message: result.message, status: result.status })
  } catch (error) {
    console.error('Admin handover error:', error)
    res.status(500).json({ error: 'Failed to hand over' })
  }
}

export async function getPendingAdminExecution(req, res) {
  try {
    const employeeId = await getEmployeeIdByCode(req.params.employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const result = await requisitionService.getPendingAdminExecution(employeeId)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(Array.isArray(result) ? result : [])
  } catch (error) {
    console.error('Pending Admin Execution error:', error)
    res.status(500).json({ error: 'Failed to fetch' })
  }
}

export async function getPendingHodAcknowledge(req, res) {
  try {
    const employeeId = await getEmployeeIdByCode(req.params.employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const result = await requisitionService.getPendingHodAcknowledge(employeeId)
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
    const employeeId = await getEmployeeIdByCode(req.params.employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const result = await requisitionService.getPendingCreatorAcknowledge(employeeId)
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
    const employeeId = await getEmployeeIdByCode(req.params.employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const result = await requisitionService.getPendingFinance(employeeId)
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

/** Toggle hidden status of a requisition (soft delete/restore). POST /requisitions/:reqId/hide */
export async function toggleHidden(req, res) {
  try {
    const { reqId } = req.params
    const { isHidden } = req.body
    const actorEmployeeId = req.employee?.employeeId ?? req.employeeId ?? req.user?.employeeId ?? req.user?.id

    if (typeof isHidden !== 'boolean') {
      return res.status(400).json({ error: 'isHidden (boolean) is required in body' })
    }

    const result = await requisitionService.toggleRequisitionHiddenService(parseInt(reqId, 10), isHidden, actorEmployeeId)
    res.json({ success: true, data: result })
  } catch (error) {
    console.error('Toggle hidden error:', error)
    const statusCode = error.message?.includes('Only SuperAdmin') ? 403 : 500
    res.status(statusCode).json({ error: error.message || 'Failed to toggle hidden status' })
  }
}

/** SuperAdmin: Get all requisitions including hidden ones. GET /requisitions/admin/all */
export async function getAllRequisitionsForAdmin(req, res) {
  try {
    const actorEmployeeId = req.employee?.employeeId ?? req.employeeId ?? req.user?.employeeId ?? req.user?.id

    // Check if user is SuperAdmin or has can_hide_requisitions permission
    const isSuperAdmin = await reqRepo.employeeHasPermission(actorEmployeeId, 'can_hide_requisitions')
      || await reqRepo.isSuperAdmin(actorEmployeeId)
    if (!isSuperAdmin) {
      return res.status(403).json({ error: 'Only SuperAdmin can access all requisitions including hidden' })
    }

    const result = await requisitionService.getTrackRecords(req.query, true)
    res.json(result)
  } catch (error) {
    console.error('Get all requisitions for admin error:', error)
    res.status(500).json({ error: error.message || 'Failed to fetch requisitions' })
  }
}


/** ================= REVERT & REVIEW FEATURE CONTROLLERS ================= */

/**
 * POST /requisition/revert
 * Revert a requisition back to HOD for review/corrections.
 */
export async function revertForReview(req, res) {
  try {
    const result = await requisitionService.revertForReview(req.body)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('Revert for review error:', error)
    res.status(500).json({ error: error.message || 'Failed to revert requisition' })
  }
}

/**
 * POST /requisition/resubmit
 * Resubmit a requisition after HOD has made corrections.
 * This skips intermediate stages and returns directly to the stage that triggered the revert.
 */
export async function resubmitAfterRevert(req, res) {
  try {
    const result = await requisitionService.resubmitAfterRevert(req.body)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('Resubmit after revert error:', error)
    res.status(500).json({ error: error.message || 'Failed to resubmit requisition' })
  }
}

/**
 * GET /requisition/pending/hod-reverted
 * Get requisitions that have been reverted to HOD for correction.
 * Accessible only by HOD users.
 */
export async function getPendingHodReverted(req, res) {
  try {
    const employeeCode = req.params.employeeCode || req.query.employeeCode
    const employeeId = await getEmployeeIdByCode(employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })

    const result = await requisitionService.getPendingHodReverted(employeeId)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('Get pending HOD reverted error:', error)
    res.status(500).json({ error: 'Failed to fetch reverted requisitions' })
  }
}

/**
 * GET /requisition/my-reverted/:employeeCode
 * Get reverted requisitions for a specific employee (creator view).
 */
export async function getMyRevertedRequisitions(req, res) {
  try {
    const employeeId = await getEmployeeIdByCode(req.params.employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })

    const result = await requisitionService.getMyRevertedRequisitions(employeeId)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(result)
  } catch (error) {
    console.error('Get my reverted requisitions error:', error)
    res.status(500).json({ error: 'Failed to fetch reverted requisitions' })
  }
}
