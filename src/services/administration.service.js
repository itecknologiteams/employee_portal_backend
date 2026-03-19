import bcrypt from 'bcryptjs'
import * as adminRepo from '../repositories/administration.repository.js'
import * as reqRepo from '../repositories/requisition.repository.js'

const PERMISSION_KEYS = [
  'dashboard', 'profile', 'profile_update_requests', 'salary_slip', 'view_salary_slips',
  'leave', 'leave_pending', 'feedback', 'feedback_history', 'feedback_records_hr',
  'requisition_create', 'requisition_can_add_items', 'requisition_history', 'requisition_acknowledgment',
  'requisition_pending', 'requisition_approved', 'requisition_reports',
  'tat_report', 'help_support', 'extensions', 'administration',
  'payroll', 'payroll_gross_salaries', 'payroll_other_allowances', 'payroll_deductions', 'payroll_incentives'
]

const ROLES_WITH_PERMISSIONS = ['Admin', 'Staff', 'User', 'Technician']

/** Technician default permissions (no requisition) — keep in sync with auth.service TECHNICIAN_PERMISSIONS */
const TECHNICIAN_ROLE_DEFAULTS = [
  'profile', 'profile_update_requests', 'salary_slip', 'leave', 'leave_pending',
  'feedback', 'feedback_history', 'help_support', 'extensions'
]

export async function listDepartments() {
  return adminRepo.listDepartments()
}

export async function createDepartment(name, description) {
  return adminRepo.createDepartment(name, description)
}

export async function updateDepartment(id, name, description) {
  const result = await adminRepo.updateDepartment(id, name, description)
  if (!result.length) return { notFound: true }
  return result[0]
}

export async function deleteDepartment(id) {
  return adminRepo.deleteDepartment(id)
}

export async function listDesignations() {
  return adminRepo.listDesignations()
}

/** Designations with optional search (by name) and pagination. */
export async function listDesignationsSearchPaginated(search, page = 1, limit = 10) {
  const searchTerm = (search && String(search).trim()) || ''
  const searchPattern = searchTerm ? `%${searchTerm}%` : '%'
  const safePage = Math.max(1, parseInt(page, 10) || 1)
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 10))
  const offset = (safePage - 1) * safeLimit
  const [data, total] = await Promise.all([
    adminRepo.listDesignationsSearchPaginated(searchPattern, safeLimit, offset),
    adminRepo.countDesignationsSearch(searchPattern)
  ])
  return {
    data,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit)
    }
  }
}

export async function createDesignation(name) {
  return adminRepo.createDesignation(name)
}

export async function updateDesignation(id, name) {
  const result = await adminRepo.updateDesignation(id, name)
  if (!result.length) return { notFound: true }
  return result[0]
}

export async function deleteDesignation(id) {
  return adminRepo.deleteDesignation(id)
}

export async function listEmployeeTypes() {
  return adminRepo.listEmployeeTypes()
}

export async function listEmployeeTypesPaginated(page = 1, limit = 10) {
  const safePage = Math.max(1, parseInt(page, 10) || 1)
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 10))
  const offset = (safePage - 1) * safeLimit
  const [data, total] = await Promise.all([
    adminRepo.listEmployeeTypesPaginated(safeLimit, offset),
    adminRepo.countEmployeeTypes()
  ])
  return {
    data,
    total,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit)
    }
  }
}

export async function createEmployeeType(name) {
  return adminRepo.createEmployeeType(name)
}

export async function updateEmployeeType(id, name) {
  const result = await adminRepo.updateEmployeeType(id, name)
  if (!result.length) return { notFound: true }
  return result[0]
}

export async function deleteEmployeeType(id) {
  return adminRepo.deleteEmployeeType(id)
}

export async function listStations() {
  return adminRepo.listStations()
}

export async function createStation(name) {
  return adminRepo.createStation(name)
}

export async function updateStation(id, name) {
  const result = await adminRepo.updateStation(id, name)
  if (!result.length) return { notFound: true }
  return result[0]
}

export async function deleteStation(id) {
  return adminRepo.deleteStation(id)
}

export async function listCities() {
  return adminRepo.listCities()
}

/** Cities with optional search (city name or station name) and pagination. */
export async function listCitiesSearchPaginated(search, page = 1, limit = 10) {
  const searchTerm = (search && String(search).trim()) || ''
  const searchPattern = searchTerm ? `%${searchTerm}%` : '%'
  const safePage = Math.max(1, parseInt(page, 10) || 1)
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 10))
  const offset = (safePage - 1) * safeLimit
  const [data, total] = await Promise.all([
    adminRepo.listCitiesSearchPaginated(searchPattern, safeLimit, offset),
    adminRepo.countCitiesSearch(searchPattern)
  ])
  return {
    data,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit)
    }
  }
}

export async function createCity(name, stationId) {
  return adminRepo.createCity(name, stationId)
}

export async function updateCity(id, name, stationId) {
  const result = await adminRepo.updateCity(id, name, stationId)
  if (!result.length) return { notFound: true }
  return result[0]
}

export async function deleteCity(id) {
  return adminRepo.deleteCity(id)
}

export async function listEmployees() {
  const rows = await adminRepo.listEmployees()
  const hodMap = await buildHodDepartmentIdsMap(rows.map((r) => r.id))
  return rows.map((r) => ({ ...r, hod_department_ids: hodMap[r.id] || [] }))
}

/** Build map employee_id -> [department_id] for HOD departments */
async function buildHodDepartmentIdsMap(employeeIds) {
  const map = {}
  if (!employeeIds.length) return map
  const rows = await adminRepo.getHodDepartmentIdsByEmployeeIds(employeeIds)
  for (const r of rows) {
    if (!map[r.employee_id]) map[r.employee_id] = []
    map[r.employee_id].push(r.department_id)
  }
  return map
}

/** Search + pagination + filters: departmentId, designationId, cityId, status (active|inactive). */
export async function listEmployeesSearchPaginated(search, page = 1, limit = 10, filters = {}) {
  const searchTerm = (search && String(search).trim()) || ''
  const searchPattern = searchTerm ? `%${searchTerm}%` : '%'
  const parseId = (v) => {
    if (v == null || v === '') return null
    const n = parseInt(v, 10)
    return Number.isInteger(n) ? n : null
  }
  const statusVal = (filters.status && String(filters.status).toLowerCase()) || ''
  const isActiveFilter = statusVal === 'active' ? true : statusVal === 'inactive' ? false : null
  const filterOptions = {
    departmentId: parseId(filters.departmentId),
    designationId: parseId(filters.designationId),
    cityId: parseId(filters.cityId),
    isActive: isActiveFilter
  }
  const safePage = Math.max(1, parseInt(page, 10) || 1)
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 10))
  const offset = (safePage - 1) * safeLimit
  const [data, total] = await Promise.all([
    adminRepo.listEmployeesSearchPaginated(searchPattern, safeLimit, offset, filterOptions),
    adminRepo.countEmployeesSearch(searchPattern, filterOptions)
  ])
  const hodMap = await buildHodDepartmentIdsMap(data.map((r) => r.id))
  const dataWithHod = data.map((r) => ({ ...r, hod_department_ids: hodMap[r.id] || [] }))
  return {
    data: dataWithHod,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit)
    }
  }
}

export async function createEmployee(body) {
  const {
    employeeCode, firstName, lastName, email, phone, departmentId,
    designationId, employeeTypeId, stationId, cityId, position,
    portalUsername, portalPassword, portalUserType, hodDepartmentIds
  } = body
  if (!firstName || !lastName || !email) {
    const err = new Error('First name, last name and email are required')
    err.status = 400
    throw err
  }
  let resolvedStationId = stationId || null
  if (cityId && !resolvedStationId) {
    resolvedStationId = await adminRepo.getStationIdByCityId(cityId)
  }
  const existing = await adminRepo.findEmployeeByEmail(email)
  if (existing.length > 0) {
    const err = new Error('Email already exists')
    err.status = 409
    throw err
  }
  const joinDate = new Date()
  const code = (employeeCode && String(employeeCode).trim()) || `EMP-${Date.now()}`
  const addressVal = body.address != null ? String(body.address).trim() : null
  const paramsFull = [
    code, firstName.trim(), lastName.trim(), email.trim(), phone?.trim() || null, addressVal || null,
    departmentId || null, designationId || null, employeeTypeId || null, resolvedStationId,
    cityId ?? null, position?.trim() || null, joinDate, true
  ]
  const paramsMinimal = [
    code, firstName.trim(), lastName.trim(), email.trim(), phone?.trim() || null, addressVal || null,
    departmentId || null, position?.trim() || null, joinDate, true
  ]
  let insertError
  try {
    await adminRepo.createEmployeeFull(paramsFull)
  } catch (err) {
    const missingColumn = err.code === '42703' || err.number === 207 || (err.message && /column.*does not exist|invalid column name/i.test(err.message))
    if (missingColumn) {
      try {
        await adminRepo.createEmployeeMinimal(paramsMinimal)
      } catch (err2) {
        insertError = err2
      }
    } else {
      insertError = err
    }
  }
  if (insertError) {
    const e = new Error(insertError.code === '23502' ? 'A required field is missing (e.g. employee code)' : insertError.message || 'Database error')
    e.status = 400
    throw e
  }
  const result = await adminRepo.getEmployeeByEmail(email)
  const newId = result[0].id
  await adminRepo.initLeaveBalanceForEmployee(newId)
  await adminRepo.updateEmployeePersonalDetails(newId, {
    address: body.address,
    dateOfBirth: body.dateOfBirth,
    fatherName: body.fatherName,
    gender: body.gender,
    maritalStatus: body.maritalStatus,
    cnicNumber: body.cnicNumber,
    emergencyContactNumber: body.emergencyContactNumber,
    personalCellNumber: body.personalCellNumber
  }).catch(() => {})
  const hodIds = Array.isArray(hodDepartmentIds) ? hodDepartmentIds.map((id) => parseInt(id, 10)).filter((n) => !Number.isNaN(n)) : []
  if (hodIds.length > 0) await adminRepo.setHodDepartments(newId, hodIds)
  if (portalUsername && portalUsername.trim() && portalPassword && portalUserType) {
    try {
      const uType = ['Admin', 'SuperAdmin', 'Staff', 'User', 'Technician', 'CRM User', 'Non-CRM User'].includes(portalUserType) ? portalUserType : 'User'
      if (uType === 'SuperAdmin') {
        const exists = await adminRepo.checkSuperAdminExists()
        if (exists) {
          const e = new Error('Only one SuperAdmin is allowed. Another user already has this role.')
          e.status = 400
          throw e
        }
      }
      const hash = await bcrypt.hash(portalPassword, 10)
      const forcePasswordChange = uType === 'Technician'
      await adminRepo.createUser(portalUsername.trim(), hash, uType, newId, forcePasswordChange)
    } catch (err) {
      if (err.status) throw err
      if (err.code === '23505' || err.number === 2627 || err.number === 2601) {
        const e = new Error('Employee created but username already exists. Edit employee to set a different username.')
        e.status = 409
        throw e
      }
      if (err.code !== '42P01' && err.number !== 208) throw err
    }
  }
  if (body.permissionOverrides && typeof body.permissionOverrides === 'object' && Object.keys(body.permissionOverrides).length > 0) {
    await applyPermissionOverrides(newId, body.permissionOverrides)
  }
  return { message: 'Employee added successfully', employee: result[0] }
}

export async function updateEmployee(id, body) {
  const {
    employeeCode, firstName, lastName, email, phone, departmentId,
    designationId, employeeTypeId, stationId, cityId, position, isActive,
    portalUsername, portalPassword, portalUserType, hodDepartmentIds
  } = body
  if (!firstName || !lastName || !email) {
    const err = new Error('First name, last name and email are required')
    err.status = 400
    throw err
  }
  let resolvedStationId = stationId ?? null
  if (cityId && (resolvedStationId == null || resolvedStationId === '')) {
    resolvedStationId = await adminRepo.getStationIdByCityId(cityId)
  }
  await adminRepo.updateEmployee(id, {
    firstName, lastName, email, phone, departmentId, designationId, employeeTypeId,
    stationId: resolvedStationId, cityId: cityId ?? null, position, employeeCode, isActive,
    address: body.address,
    dateOfBirth: body.dateOfBirth,
    fatherName: body.fatherName,
    gender: body.gender,
    maritalStatus: body.maritalStatus,
    cnicNumber: body.cnicNumber,
    emergencyContactNumber: body.emergencyContactNumber,
    personalCellNumber: body.personalCellNumber
  })
  if (portalUsername !== undefined || portalPassword !== undefined || portalUserType !== undefined) {
    try {
      const existingUser = await adminRepo.findUserByEmpId(id)
        const uType = portalUserType && ['Admin', 'SuperAdmin', 'Staff', 'User', 'Technician', 'CRM User', 'Non-CRM User'].includes(portalUserType) ? portalUserType : 'User'
      if (uType === 'SuperAdmin') {
        const otherExists = await adminRepo.checkSuperAdminExists(id)
        if (otherExists) {
          const e = new Error('Only one SuperAdmin is allowed. Another user already has this role.')
          e.status = 400
          throw e
        }
      }
      if (existingUser.length > 0) {
        const uid = existingUser[0].user_id
        const forcePasswordChange = uType === 'Technician'
        if (portalUsername && portalUsername.trim()) {
          if (portalPassword && portalPassword.length >= 4) {
            const hash = await bcrypt.hash(portalPassword, 10)
            await adminRepo.updateUser(uid, portalUsername.trim(), hash, uType, forcePasswordChange)
          } else {
            await adminRepo.updateUser(uid, portalUsername.trim(), null, uType, forcePasswordChange)
          }
        } else {
          await adminRepo.updateUser(uid, existingUser[0].username, null, uType, forcePasswordChange)
        }
      } else if (portalUsername && portalUsername.trim() && portalPassword && portalPassword.length >= 4) {
        const hash = await bcrypt.hash(portalPassword, 10)
        const forcePasswordChange = uType === 'Technician'
        await adminRepo.createUser(portalUsername.trim(), hash, uType, id, forcePasswordChange)
      }
    } catch (err) {
      if (err.status) throw err
      if (err.code === '42P01') { /* ok */ } else if (err.code === '23505') {
        const e = new Error('Employee updated but username already in use')
        e.status = 409
        throw e
      } else throw err
    }
  }
  if (body.permissionOverrides !== undefined) {
    await adminRepo.deleteUserPermissionOverrides(id)
    if (body.permissionOverrides && typeof body.permissionOverrides === 'object' && Object.keys(body.permissionOverrides).length > 0) {
      await applyPermissionOverrides(id, body.permissionOverrides)
    }
  }
  if (hodDepartmentIds !== undefined) {
    const hodIds = Array.isArray(hodDepartmentIds) ? hodDepartmentIds.map((id) => parseInt(id, 10)).filter((n) => !Number.isNaN(n)) : []
    await adminRepo.setHodDepartments(id, hodIds)
  }
  const result = await adminRepo.getEmployeeById(id)
  if (!result.length) return { notFound: true }
  const hodIds = await adminRepo.getHodDepartmentIds(id)
  return { ...result[0], hod_department_ids: hodIds }
}

export async function deactivateEmployee(id) {
  const check = await adminRepo.deactivateEmployee(id)
  if (!check.length) return { notFound: true }
  return { message: 'Employee deactivated' }
}

export async function getSuperAdminStatus() {
  return adminRepo.getSuperAdminStatus()
}

export async function getRoleDefaults(role) {
  const roleDefaults = {}
  PERMISSION_KEYS.forEach(k => { roleDefaults[k] = false })
  if (role === 'SuperAdmin') {
    PERMISSION_KEYS.forEach(k => { roleDefaults[k] = true })
    return { roleDefaults }
  }
  if (role === 'Technician') {
    TECHNICIAN_ROLE_DEFAULTS.forEach(k => { if (PERMISSION_KEYS.includes(k)) roleDefaults[k] = true })
    return { roleDefaults }
  }
  // CRM User and Non-CRM User use same permissions as User (avoid conflicts)
  const roleForPermissions = (role === 'CRM User' || role === 'Non-CRM User') ? 'User' : role
  if (!ROLES_WITH_PERMISSIONS.includes(roleForPermissions)) {
    return { roleDefaults }
  }
  try {
    const rows = await adminRepo.getRolePermissions(roleForPermissions)
    rows.forEach(r => {
      if (PERMISSION_KEYS.includes(r.permission_key)) roleDefaults[r.permission_key] = r.allowed
    })
  } catch (err) {
    if (err.code === '42P01') return { roleDefaults }
    throw err
  }
  return { roleDefaults }
}

export async function getUserByEmployee(empId) {
  const user = await adminRepo.getUserByEmployee(empId)
  if (!user) return null
  let permissionOverrides = null
  let roleDefaults = {}
  try {
    const overrideRows = await adminRepo.getUserPermissionOverrides(empId)
    if (overrideRows.length > 0) {
      permissionOverrides = {}
      overrideRows.forEach(r => { permissionOverrides[r.permission_key] = r.allowed })
    }
    if (user.userType === 'Technician') {
      PERMISSION_KEYS.forEach(k => { roleDefaults[k] = false })
      TECHNICIAN_ROLE_DEFAULTS.forEach(k => { if (PERMISSION_KEYS.includes(k)) roleDefaults[k] = true })
    } else {
      const roleRows = await adminRepo.getRolePermissions(user.userType)
      PERMISSION_KEYS.forEach(k => { roleDefaults[k] = false })
      roleRows.forEach(r => {
        if (PERMISSION_KEYS.includes(r.permission_key)) roleDefaults[r.permission_key] = r.allowed
      })
    }
  } catch (err) {
    if (err.code !== '42P01') throw err
  }
  return {
    id: user.id,
    username: user.username,
    userType: user.userType,
    permissionOverrides,
    roleDefaults
  }
}

async function applyPermissionOverrides(empId, overrides) {
  if (!overrides || typeof overrides !== 'object' || Object.keys(overrides).length === 0) return
  for (const key of Object.keys(overrides)) {
    if (!PERMISSION_KEYS.includes(key)) continue
    await adminRepo.upsertUserPermission(empId, key, !!overrides[key])
  }
}

// ---------- Requisition Category Management (admin) ----------
export async function listRequisitionCategoriesAdmin() {
  return reqRepo.getAllRequisitionCategories()
}

export async function createRequisitionCategoryAdmin(name, flags = {}) {
  return reqRepo.createRequisitionCategory(name, flags)
}

export async function updateRequisitionCategoryAdmin(id, name, flags) {
  return reqRepo.updateRequisitionCategory(id, name, flags)
}

export async function deleteRequisitionCategoryAdmin(id) {
  return reqRepo.deleteRequisitionCategory(id)
}
