import * as rolePermissionsService from '../services/rolePermissions.service.js'

/** GET / – List all role permissions. SuperAdmin only. Query: employeeId */
export async function getRolePermissions(req, res) {
  try {
    const employeeId = req.query.employeeId
    const isSuperAdmin = await rolePermissionsService.ensureSuperAdmin(employeeId)
    if (!isSuperAdmin) {
      return res.status(403).json({ error: 'Only SuperAdmin can view role permissions.' })
    }
    const result = await rolePermissionsService.getPermissions()
    res.json(result)
  } catch (err) {
    if (err.code === '42P01') {
      return res.status(503).json({ error: 'Role permissions are not set up. Run the role_permissions migration.' })
    }
    console.error('GET role-permissions error:', err)
    res.status(500).json({ error: 'Failed to load role permissions' })
  }
}

/** PUT / – Update role permissions. SuperAdmin only. Body: { employeeId, permissions: { Admin: {...}, Staff: {...}, User: {...} } } */
export async function putRolePermissions(req, res) {
  try {
    const { employeeId, permissions } = req.body
    const isSuperAdmin = await rolePermissionsService.ensureSuperAdmin(employeeId)
    if (!isSuperAdmin) {
      return res.status(403).json({ error: 'Only SuperAdmin can update role permissions.' })
    }
    const result = await rolePermissionsService.savePermissions(permissions)
    if (result.error) {
      return res.status(400).json({ error: result.error })
    }
    res.json(result)
  } catch (err) {
    if (err.code === '42P01') {
      return res.status(503).json({ error: 'Role permissions are not set up. Run the role_permissions migration.' })
    }
    console.error('PUT role-permissions error:', err)
    res.status(500).json({ error: 'Failed to save role permissions' })
  }
}
