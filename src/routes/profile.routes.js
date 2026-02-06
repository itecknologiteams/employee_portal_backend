import express from 'express'
import * as profileController from '../controllers/profile.controller.js'

const router = express.Router()

router.get('/:employeeId', profileController.getProfile)
router.put('/:employeeId', profileController.updateProfile)

export default router
