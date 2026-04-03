import express from 'express'
import * as authController from '../controllers/auth.controller.js'

const router = express.Router()

router.post('/login', authController.login)
router.post('/sso/session', authController.ssoSession)
router.post('/sso/prepare', authController.ssoPrepare)
router.get('/sso/consume', authController.ssoConsume)
router.post('/sso/invalidate', authController.ssoInvalidate)
router.get('/sso/status', authController.ssoStatus)
router.get('/me', authController.me)
router.get('/debug-session', authController.debugSession)
router.post('/logout', authController.logout)
router.post('/change-password', authController.changePassword)
router.post('/register', authController.register)

export default router
