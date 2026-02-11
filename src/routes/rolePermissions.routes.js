import express from 'express'
import * as rolePermissionsController from '../controllers/rolePermissions.controller.js'

const router = express.Router()

// GET / – list role permissions (SuperAdmin only). Query: ?employeeId=
router.get('/', rolePermissionsController.getRolePermissions)

// PUT / – update role permissions (SuperAdmin only).
// Body: { employeeId, permissions: { Admin: { dashboard: true, salary_slip: true, ... }, Staff: {...}, User: {...} } }
// Permission keys can be snake_case (salary_slip) or camelCase (salarySlip). Send full matrix so toggles persist after redirect.
router.put('/', rolePermissionsController.putRolePermissions)

export default router
