import express from 'express'
import * as profileController from '../controllers/profile.controller.js'

const router = express.Router()

// HR pending list – must be before /:employeeId so "change-requests" is not captured as employeeId
router.get('/change-requests', profileController.getChangeRequests)
router.post('/change-requests/approve', profileController.approveChangeRequest)
router.post('/change-requests/reject', profileController.rejectChangeRequest)

// HR: edit/correct an employee's full record (must be before the /:employeeCode catch-all)
router.post('/hr-update-employee', profileController.hrUpdateEmployee)
router.get('/hr-employee/:employeeId', profileController.hrGetEmployee)

router.get('/:employeeCode', profileController.getProfile)
router.put('/:employeeCode', profileController.updateProfile)
router.get('/:employeeCode/pending', profileController.getMyPendingProfileRequest)

export default router
