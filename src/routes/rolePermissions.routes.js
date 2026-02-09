import express from 'express'
import * as rolePermissionsController from '../controllers/rolePermissions.controller.js'

const router = express.Router()

// GET / – list role permissions (SuperAdmin only). Query: ?employeeId=
router.get('/', rolePermissionsController.getRolePermissions)

// PUT / – update role permissions (SuperAdmin only). Body: { employeeId, permissions: { Admin: {...}, Staff: {...}, User: {...} } }
router.put('/', rolePermissionsController.putRolePermissions)

export default router
