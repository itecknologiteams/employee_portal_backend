import express from 'express'
import * as cardsController from '../controllers/cards.controller.js'
import { cardsProfileUpload } from '../utils/file.utils.js'

const router = express.Router()

// Public – list & single card (QR scan)
router.get('/technicians', cardsController.listTechnicians)
router.get('/:employeeId', cardsController.getTechnicianCard)

// Upload profile image (before :id routes so /upload-profile is literal)
router.post('/upload-profile', cardsProfileUpload.single('profileImage'), cardsController.uploadProfileImage)

// CRUD – create & update (order matters: specific before :id)
router.post('/', cardsController.createEmployee)
router.put('/:employeeId', cardsController.updateEmployee)

export default router
