import express from 'express'
import * as notificationController from '../controllers/notification.controller.js'

const router = express.Router()

router.get('/vapid-public-key', notificationController.vapidPublicKey)
router.get('/stream', notificationController.stream)
router.get('/unread-count', notificationController.unreadCount)
router.get('/', notificationController.list)
router.put('/read-all', notificationController.markAllRead)
router.put('/:id/read', notificationController.markRead)
router.post('/subscribe', notificationController.subscribe)
router.delete('/subscribe', notificationController.unsubscribe)

export default router
