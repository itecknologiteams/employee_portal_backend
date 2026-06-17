import * as profileService from '../services/profile.service.js'
import { getEmployeeIdByCode } from '../repositories/auth.repository.js'

export async function getProfile(req, res) {
  try {
    const { employeeCode } = req.params
    const employeeId = await getEmployeeIdByCode(employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const profile = await profileService.getProfile(employeeId)
    if (!profile) {
      return res.status(404).json({ error: 'Employee not found' })
    }
    res.json(profile)
  } catch (error) {
    console.error('Profile error:', error)
    res.status(500).json({ error: 'Failed to fetch profile' })
  }
}

export async function updateProfile(req, res) {
  try {
    const { employeeCode } = req.params
    const employeeId = await getEmployeeIdByCode(employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const data = req.body || {}
    const result = await profileService.updateProfile(employeeId, data)
    res.json(result)
  } catch (error) {
    console.error('Profile update error:', error)
    res.status(500).json({ error: 'Failed to submit profile update request' })
  }
}

/** GET /profile/:employeeCode/pending – employee's own pending request */
export async function getMyPendingProfileRequest(req, res) {
  try {
    const { employeeCode } = req.params
    const employeeId = await getEmployeeIdByCode(employeeCode)
    if (!employeeId) return res.status(404).json({ error: 'Employee not found' })
    const pending = await profileService.getMyPendingRequest(employeeId)
    if (!pending) return res.status(404).json({ message: 'No pending profile change request' })
    res.json(pending)
  } catch (error) {
    console.error('Pending profile request error:', error)
    res.status(500).json({ error: 'Failed to fetch pending request' })
  }
}

/** GET /profile/change-requests?hrEmployeeId= – HR: list all pending profile change requests */
export async function getChangeRequests(req, res) {
  try {
    const hrEmployeeId = req.query.hrEmployeeId || req.body?.hrEmployeeId
    if (!hrEmployeeId) {
      return res.status(400).json({ error: 'hrEmployeeId is required (query or body)' })
    }
    const result = await profileService.getHrPendingProfileRequests(hrEmployeeId)
    if (result.error) {
      return res.status(result.status || 403).json({ error: result.error })
    }
    res.json(result)
  } catch (error) {
    console.error('Change requests list error:', error)
    res.status(500).json({ error: 'Failed to fetch change requests' })
  }
}

/** GET /profile/hr-employee/:employeeId?hrEmployeeId= – HR: full employee record for editing */
export async function hrGetEmployee(req, res) {
  try {
    const hrEmployeeId = req.query.hrEmployeeId || req.body?.hrEmployeeId
    const { employeeId } = req.params
    if (!hrEmployeeId) return res.status(400).json({ error: 'hrEmployeeId is required' })
    const result = await profileService.hrGetEmployeeForEdit(hrEmployeeId, employeeId)
    if (result.error) return res.status(result.status || 403).json({ error: result.error })
    res.json(result.employee)
  } catch (error) {
    console.error('HR get employee error:', error)
    res.status(500).json({ error: 'Failed to fetch employee' })
  }
}

/** POST /profile/hr-update-employee – HR: correct an employee's details */
export async function hrUpdateEmployee(req, res) {
  try {
    const { hrEmployeeId, employeeId, ...fields } = req.body || {}
    if (!hrEmployeeId || !employeeId) {
      return res.status(400).json({ error: 'hrEmployeeId and employeeId are required' })
    }
    const result = await profileService.hrUpdateEmployee(hrEmployeeId, employeeId, fields)
    if (result.error) return res.status(result.status || 400).json({ error: result.error })
    res.json({ message: result.message })
  } catch (error) {
    console.error('HR update employee error:', error)
    res.status(500).json({ error: 'Failed to update employee' })
  }
}

/** POST /profile/change-requests/approve – HR: approve and apply */
export async function approveChangeRequest(req, res) {
  try {
    const { requestId, hrEmployeeId } = req.body || {}
    if (!requestId || !hrEmployeeId) {
      return res.status(400).json({ error: 'requestId and hrEmployeeId are required' })
    }
    const result = await profileService.hrApproveProfileRequest(Number(requestId), Number(hrEmployeeId))
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error })
    }
    res.json(result)
  } catch (error) {
    console.error('Approve change request error:', error)
    res.status(500).json({ error: 'Failed to approve request' })
  }
}

/** POST /profile/change-requests/reject – HR: reject */
export async function rejectChangeRequest(req, res) {
  try {
    const { requestId, hrEmployeeId } = req.body || {}
    if (!requestId || !hrEmployeeId) {
      return res.status(400).json({ error: 'requestId and hrEmployeeId are required' })
    }
    const result = await profileService.hrRejectProfileRequest(Number(requestId), Number(hrEmployeeId))
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error })
    }
    res.json(result)
  } catch (error) {
    console.error('Reject change request error:', error)
    res.status(500).json({ error: 'Failed to reject request' })
  }
}
