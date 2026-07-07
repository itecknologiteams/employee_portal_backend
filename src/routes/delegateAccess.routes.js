import express from 'express'
import * as ctrl from '../controllers/delegateAccess.controller.js'

const router = express.Router()

// Public (token-authenticated) entry
router.post('/open', ctrl.open)
router.post('/verify', ctrl.verify)

// SuperAdmin management
router.get('/', ctrl.list)
router.post('/', ctrl.create)
router.delete('/:id', ctrl.revoke)
router.post('/:id/resend', ctrl.resend)
router.get('/:id/events', ctrl.events)

export default router
