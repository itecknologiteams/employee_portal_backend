import express from 'express'
import * as extensionsController from '../controllers/extensions.controller.js'

const router = express.Router()

router.get('/list', extensionsController.getList)

export default router
