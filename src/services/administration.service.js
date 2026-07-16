import bcrypt from 'bcryptjs'
import * as adminRepo from '../repositories/administration.repository.js'
import * as reqRepo from '../repositories/requisition.repository.js'
import * as historyService from './employeeHistory.service.js'
import { PERMISSION_KEYS } from '../../config/permissions.js'
import XLSX from 'xlsx'
import * as salaryRepo from '../repositories/salary.repository.js'

const ROLES_WITH_PERMISSIONS = ['Admin', 'Staff', 'User', 'Technician']

/** Smallest department id = canonical employees.department_id for legacy joins */
function primaryDepartmentIdFromIds(ids) {
  const clean = [...new Set((ids || []).map((id) => parseInt(id, 10)).filter((n) => !Number.isNaN(n)))]
  if (clean.length === 0) return null
  clean.sort((a, b) => a - b)
  return clean[0]
}

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
  const safeLimit = Math.min(1000, Math.max(1, parseInt(limit, 10) || 10))
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
  const safeLimit = Math.min(1000, Math.max(1, parseInt(limit, 10) || 10))
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
  const safeLimit = Math.min(1000, Math.max(1, parseInt(limit, 10) || 10))
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
  const memRows = await adminRepo.getMembershipDepartmentRowsByEmployeeIds(data.map((r) => r.id))
  const namesByEmp = {}
  const idsByEmp = {}
  for (const row of memRows) {
    const eid = row.employee_id
    if (!namesByEmp[eid]) namesByEmp[eid] = []
    namesByEmp[eid].push(row.department_name)
    if (!idsByEmp[eid]) idsByEmp[eid] = []
    idsByEmp[eid].push(row.department_id)
  }
  const dataWithHod = data.map((r) => {
    const hod_department_ids = hodMap[r.id] || []
    const memNames = namesByEmp[r.id]
    if (memNames && memNames.length) {
      const department_name = [...new Set(memNames)].sort().join(', ')
      const department_ids = idsByEmp[r.id] || []
      return { ...r, hod_department_ids, department_name, department_ids }
    }
    return {
      ...r,
      hod_department_ids,
      department_ids: r.department_id != null ? [r.department_id] : []
    }
  })
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
    portalUsername, portalPassword, portalUserType, hodDepartmentIds,
    departmentIds: departmentIdsBody
  } = body
  const departmentIdsList = Array.isArray(departmentIdsBody)
    ? departmentIdsBody
    : departmentId != null && departmentId !== ''
      ? [departmentId]
      : []
  const resolvedDepartmentId = primaryDepartmentIdFromIds(departmentIdsList.map((id) => parseInt(id, 10)))
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
  const joinDate = body.joinDate ? new Date(body.joinDate) : new Date()
  const code = (employeeCode && String(employeeCode).trim()) || `EMP-${Date.now()}`
  const addressVal = body.address != null ? String(body.address).trim() : null
  const paramsFull = [
    code, firstName.trim(), lastName.trim(), email.trim(), phone?.trim() || null, addressVal || null,
    resolvedDepartmentId, designationId || null, employeeTypeId || null, resolvedStationId,
    cityId ?? null, position?.trim() || null, joinDate, true
  ]
  const paramsMinimal = [
    code, firstName.trim(), lastName.trim(), email.trim(), phone?.trim() || null, addressVal || null,
    resolvedDepartmentId, position?.trim() || null, joinDate, true
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
    ntn: body.ntn,
    cnicIssueDate: body.cnicIssueDate,
    cnicExpiryDate: body.cnicExpiryDate,
    emergencyContactNumber: body.emergencyContactNumber,
    personalCellNumber: body.personalCellNumber,
    employeeExtension: body.employeeExtension,
    religion: body.religion,
    grade: body.grade,
    region: body.region,
    bio: body.bio
  }).catch(() => {})
  const membershipIds = departmentIdsList.map((id) => parseInt(id, 10)).filter((n) => !Number.isNaN(n))
  if (membershipIds.length > 0) await adminRepo.setEmployeeDepartmentMemberships(newId, membershipIds)
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
    portalUsername, portalPassword, portalUserType, hodDepartmentIds,
    departmentIds: departmentIdsBody
  } = body

  let effectiveDepartmentId = departmentId
  if (departmentIdsBody !== undefined) {
    const ids = Array.isArray(departmentIdsBody)
      ? departmentIdsBody.map((x) => parseInt(x, 10)).filter((n) => !Number.isNaN(n))
      : []
    effectiveDepartmentId = primaryDepartmentIdFromIds(ids)
    await adminRepo.setEmployeeDepartmentMemberships(id, ids)
  }

  if (!firstName || !lastName || !email) {
    const err = new Error('First name, last name and email are required')
    err.status = 400
    throw err
  }
  let resolvedStationId = stationId ?? null
  if (cityId && (resolvedStationId == null || resolvedStationId === '')) {
    resolvedStationId = await adminRepo.getStationIdByCityId(cityId)
  }
  // Snapshot before-state for diff-based history auto-logging
  const beforeRows = await adminRepo.getEmployeeById(id).catch(() => null)
  const before = (Array.isArray(beforeRows) ? beforeRows[0] : beforeRows) || null
  await adminRepo.updateEmployee(id, {
    firstName, lastName, email, phone, departmentId: effectiveDepartmentId, designationId, employeeTypeId,
    stationId: resolvedStationId, cityId: cityId ?? null, position, employeeCode, isActive, joinDate: body.joinDate,
    address: body.address,
    dateOfBirth: body.dateOfBirth,
    fatherName: body.fatherName,
    gender: body.gender,
    maritalStatus: body.maritalStatus,
    cnicNumber: body.cnicNumber,
    ntn: body.ntn,
    cnicIssueDate: body.cnicIssueDate,
    cnicExpiryDate: body.cnicExpiryDate,
    emergencyContactNumber: body.emergencyContactNumber,
    personalCellNumber: body.personalCellNumber,
    employeeExtension: body.employeeExtension,
    religion: body.religion,
    grade: body.grade,
    region: body.region,
    bio: body.bio,
    ...(typeof body.salarySlipOnHold === 'boolean' ? { salarySlipOnHold: body.salarySlipOnHold } : {}),
    ...(body.lastWorkingDate !== undefined ? { lastWorkingDate: body.lastWorkingDate } : {})
  })
  // After-state snapshot + auto-log any tracked field diffs into employee history
  try {
    const afterRows = await adminRepo.getEmployeeById(id)
    const after = (Array.isArray(afterRows) ? afterRows[0] : afterRows) || null
    const actorEmployeeId = body.actorEmployeeId || body.createdBy || null
    if (before && after) {
      await historyService.autoLogFromDiff({
        employeeId: id, before, after,
        effectiveDate: new Date().toISOString().slice(0, 10),
        createdBy: actorEmployeeId
      })
    }
  } catch (autoLogErr) {
    console.warn('autoLogFromDiff failed (non-fatal):', autoLogErr.message)
  }
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
  const memIds = await adminRepo.getMembershipDepartmentIds(id)
  const department_ids = memIds.length ? memIds : (result[0].department_id != null ? [result[0].department_id] : [])
  return { ...result[0], hod_department_ids: hodIds, department_ids }
}

export async function deactivateEmployee(id) {
  const check = await adminRepo.deactivateEmployee(id)
  if (!check.length) return { notFound: true }
  return { message: 'Employee deactivated' }
}

export async function toggleEmployeeStatus(id, isActive, lastWorkingDate) {
  const result = await adminRepo.toggleEmployeeStatus(id, isActive, lastWorkingDate)
  if (!result) return { notFound: true }
  return result
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

// ---------- Old salary slip (tax certificate candidates) sheet ----------

/** Header columns for the upload template. Employee_Code resolves against employees.employee_code. */
export const OLD_SLIP_TEMPLATE_COLUMNS = [
  'Employee_Code', 'Pay_Month', 'Period_Label',
  'Basic_Salary_1', 'Medical_Allowance_2', 'Conveyance_Fixed_Allowance_3', 'Overtime_Allowance_4',
  'House_Rent_Allowance_5', 'Utilities_Allowance_6', 'Meal_Allowance_7', 'Arrears_8',
  'Bike_Maintainence_9', 'Incentives_Tech_10', 'Device_Reimbursment_11', 'Communication_12',
  'Incentives_KPI_13', 'Other_Allowance_14', 'Loan_15', 'Advance_Salary_16', 'EOBI_17', 'Income_Tax_18',
  'Absent_Days_19', 'Device_Deduction_20', 'Over_Utilization_Mobile_21', 'Vehicle_Fuel_Deduction_22',
  'Pandamic_Deduction_23', 'Late_Days_24', 'Other_Deduction_25', 'Mobile_Installment_26', 'Food_Panda_27',
  'Conveyance_Liters_Allowance_28', 'Leaves_29', 'Incremental_Arrears_31',
  'Tot_Gross_Salary', 'Tot_Allowances', 'Tot_Deductions', 'Tot_Net_Salary', 'Salary_Status', 'Remarks'
]

/** Map a sheet's Employee_Code to the fields the normalizer resolves by (employee_code lookup). Pure. */
export function aliasEmployeeCode(row) {
  const out = { ...row }
  const code = out.Employee_Code ?? out.employee_code
  const hasId = out.HR_Emp_ID != null || out.employeeId != null || out.employee_id != null
  if (code != null && String(code).trim() !== '' && !hasId) {
    out.HR_Emp_ID = code
    if (out.Source_Employee_Code == null) out.Source_Employee_Code = code
  }
  return out
}

// ---- Tax Certificate Sheet (SuperAdmin-uploaded annual income-tax register) ----
const CERT_COMPANY_NAME = 'iTecknologi Tracking Services (Pvt) Ltd.'
const CERT_COMPANY_ADDRESS = '9th & 10th Floor, QM Building, Roomi Street, Block-7, Clifton, Karachi-Pakistan'
const CERT_COMPANY_NTN = '8939436-6'

// HR's register format + a leading Fiscal Year column. Two "Name" and two "Address" columns are
// intentional (employee's own vs. as-registered name; employee vs. company address). Column order
// is authoritative — the parser reads uploads and the builder writes downloads by these positions.
export const TAX_CERT_SHEET_HEADER = [
  'Fiscal Year', 'Employee ID', 'Name', 'Designation', 'Department', 'CNIC', 'Name', 'Address',
  'NTN', 'Status', 'Company Name', 'Address', 'Company NTN', 'Total Income', 'Total Tax'
]

const s = (v) => (v == null ? '' : String(v).trim())
const num = (v) => {
  if (v == null || v === '') return null
  const n = Number(String(v).replace(/[, ]/g, ''))
  return Number.isNaN(n) ? null : n
}

// Canonical fiscal-year hint shown in the template's Fiscal Year column header.
export const FISCAL_YEAR_HINT = 'Fiscal Year (e.g. 2025-26)'

/**
 * Normalize a fiscal-year value to canonical Pakistani-FY form `YYYY-YY` (e.g. "2025-26",
 * meaning Jul 1 2025 – Jun 30 2026). Accepts common variants: "2025-2026", "2025/26",
 * "2025 2026", "FY2025-26", and a lone start year "2025". Returns null if it can't be parsed
 * or the end year isn't start+1. Pure.
 */
export function normalizeFiscalYear(raw) {
  if (raw == null) return null
  const str = String(raw).trim().toUpperCase().replace(/^FY\s*/, '').trim()
  if (!str) return null
  const parts = str.split(/[\s\-/]+/).filter(Boolean)
  if (parts.length === 1) {
    if (!/^\d{4}$/.test(parts[0])) return null
    const start = parseInt(parts[0], 10)
    return `${start}-${String((start + 1) % 100).padStart(2, '0')}`
  }
  if (parts.length === 2) {
    const [a, b] = parts
    if (!/^\d{4}$/.test(a)) return null
    const start = parseInt(a, 10)
    let end
    if (/^\d{4}$/.test(b)) end = parseInt(b, 10)
    else if (/^\d{2}$/.test(b)) {
      end = Math.floor(start / 100) * 100 + parseInt(b, 10)
      if (end < start) end += 100
    } else return null
    if (end !== start + 1) return null
    return `${start}-${String(end % 100).padStart(2, '0')}`
  }
  return null
}

/** Parse an uploaded tax-cert-sheet workbook (by column position) into normalized DB rows. Pure. */
export function parseTaxCertSheetRows(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  if (!sheet) return { rows: [], skipped: 0 }
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false })
  const body = aoa.slice(1) // drop header row
  const rows = []
  let skipped = 0
  for (const r of body) {
    const employee_code = s(r[1])
    const fiscal_year = normalizeFiscalYear(r[0])
    if (!employee_code || !fiscal_year) { skipped++; continue }
    rows.push({
      fiscal_year,
      employee_code,
      employee_name: s(r[2]) || null,
      designation: s(r[3]) || null,
      department: s(r[4]) || null,
      cnic: s(r[5]) || null,
      ntn: s(r[8]) || null,
      status: s(r[9]) || null,
      address: s(r[7]) || null,
      total_income: num(r[13]),
      total_tax: num(r[14])
      // Columns 6 (as-registered Name) and 10–12 (company Name/Address/NTN) are derived/constant — not stored.
    })
  }
  return { rows, skipped }
}

/** Map a stored DB row to a sheet row array (header order), injecting the constant company fields. Pure. */
export function storedRowToSheetRow(row) {
  return [
    row.fiscal_year || '',
    row.employee_code || '',
    row.employee_name || '',
    row.designation || '',
    row.department || '',
    row.cnic || '',
    (row.employee_name || '').toUpperCase(),
    row.address || '',
    row.ntn || '',
    row.status || '',
    CERT_COMPANY_NAME,
    CERT_COMPANY_ADDRESS,
    CERT_COMPANY_NTN,
    Number(row.total_income) || 0,
    Number(row.total_tax) || 0
  ]
}

/** Friendly JSON shape for the Administration preview table. Pure. */
export function storedRowToJson(row) {
  return {
    fiscalYear: row.fiscal_year || '',
    employeeCode: row.employee_code || '',
    name: row.employee_name || '',
    designation: row.designation || '',
    department: row.department || '',
    cnic: row.cnic || '',
    ntn: row.ntn || '',
    status: row.status || '',
    address: row.address || '',
    totalIncome: Number(row.total_income) || 0,
    totalTax: Number(row.total_tax) || 0
  }
}

/** Build the blank upload template (header row only). The Fiscal Year header carries a format hint;
 *  the parser reads by column position so the hint doesn't affect uploads. Pure. */
export function buildTaxCertificateTemplate() {
  const header = TAX_CERT_SHEET_HEADER.map((h) => (h === 'Fiscal Year' ? FISCAL_YEAR_HINT : h))
  const ws = XLSX.utils.aoa_to_sheet([header])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Tax Certificate Sheet')
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  return { buffer, filename: 'Tax-Certificate-Sheet-Template.xlsx' }
}

/** Build the download XLSX from stored DB rows. Pure. */
export function buildTaxCertificateSheet(storedRows) {
  const rows = (storedRows || []).map(storedRowToSheetRow)
  const ws = XLSX.utils.aoa_to_sheet([TAX_CERT_SHEET_HEADER, ...rows])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Tax Certificate Sheet')
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  return { buffer, filename: 'Tax-Certificates.xlsx' }
}

/** Parse + upsert an uploaded sheet. Returns { imported, skipped }. */
export async function importTaxCertificateSheet(buffer) {
  const { rows, skipped } = parseTaxCertSheetRows(buffer)
  const imported = rows.length ? await adminRepo.upsertTaxCertSheetRows(rows) : 0
  return { imported, skipped, total: rows.length + skipped }
}

/** List stored rows as preview JSON. */
export async function listTaxCertificateSheet(opts = {}) {
  const rows = await adminRepo.listTaxCertSheetRows(opts)
  return rows.map(storedRowToJson)
}

/** Build the download sheet from all stored rows (optionally one fiscal year). */
export async function buildTaxCertificateSheetFromStore(opts = {}) {
  const rows = await adminRepo.listTaxCertSheetRows(opts)
  return buildTaxCertificateSheet(rows)
}

/** Build the downloadable XLSX template (header row + one blank example row). */
export function buildOldSlipTemplate() {
  const header = OLD_SLIP_TEMPLATE_COLUMNS
  const example = header.map((h) => (h === 'Pay_Month' ? '2024-01-01' : ''))
  const ws = XLSX.utils.aoa_to_sheet([header, example])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Old Salary Slips')
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  return { buffer, filename: 'Old-Tax-Certificate-Sheet-Template.xlsx' }
}

/** Shared: normalize → skip duplicates → insert. Returns counts. */
async function importRows(rawRows) {
  const aliased = rawRows.map(aliasEmployeeCode)
  const normalized = await salaryRepo.normalizeSlips(aliased)
  const skipped = aliased.length - normalized.length
  const existing = await salaryRepo.getExistingOldSlipKeys(normalized)
  const { toInsert, duplicates } = salaryRepo.partitionByExistingKeys(normalized, existing)
  const created = await salaryRepo.insertNormalizedOldSlips(toInsert)
  return { total: rawRows.length, inserted: created.length, skipped, duplicates }
}

/** Parse an uploaded workbook and import its rows into old_salary_slip (skipping duplicates). */
export async function importOldSlips(buffer) {
  let sheet
  try {
    const wb = XLSX.read(buffer, { type: 'buffer' })
    sheet = wb.Sheets[wb.SheetNames[0]]
  } catch {
    const e = new Error('Could not read the uploaded file'); e.status = 400; throw e
  }
  if (!sheet) { const e = new Error('The uploaded file has no sheet'); e.status = 400; throw e }
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
  if (!rows.length) { const e = new Error('No data rows found in the sheet'); e.status = 400; throw e }
  return importRows(rows)
}

/** Add a single manually-entered old salary slip row. */
export async function addOldSlip(row) {
  if (!row || typeof row !== 'object') { const e = new Error('A row object is required'); e.status = 400; throw e }
  const result = await importRows([row])
  if (result.inserted === 0 && result.skipped > 0) {
    const e = new Error('Could not resolve the employee (Employee_Code) or Pay_Month'); e.status = 400; throw e
  }
  return { inserted: result.inserted, duplicate: result.duplicates > 0, skipped: result.skipped > 0 }
}
