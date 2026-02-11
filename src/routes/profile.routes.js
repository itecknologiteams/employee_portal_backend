import express from 'express'
import * as profileController from '../controllers/profile.controller.js'

const router = express.Router()

// HR pending list – must be before /:employeeId so "change-requests" is not captured as employeeId
router.get('/change-requests', profileController.getChangeRequests)
router.post('/change-requests/approve', profileController.approveChangeRequest)
router.post('/change-requests/reject', profileController.rejectChangeRequest)

router.get('/:employeeId', profileController.getProfile)
router.put('/:employeeId', profileController.updateProfile)
router.get('/:employeeId/pending', profileController.getMyPendingProfileRequest)

export default router
