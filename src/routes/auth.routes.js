import express from 'express'
import * as authController from '../controllers/auth.controller.js'

const router = express.Router()

router.post('/login', authController.login)
router.get('/me', authController.me)
router.post('/logout', authController.logout)
router.post('/change-password', authController.changePassword)
router.post('/register', authController.register)

export default router
