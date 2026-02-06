import bcrypt from 'bcryptjs'
import * as adminRepo from '../repositories/administration.repository.js'

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
  return adminRepo.listEmployees()
}

export async function createEmployee(body) {
  const {
    employeeCode, firstName, lastName, email, phone, departmentId,
    designationId, employeeTypeId, stationId, cityId, position,
    portalUsername, portalPassword, portalUserType
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
  const paramsFull = [
    code, firstName.trim(), lastName.trim(), email.trim(), phone?.trim() || null,
    departmentId || null, designationId || null, employeeTypeId || null, resolvedStationId,
    cityId ?? null, position?.trim() || null, joinDate, true
  ]
  const paramsMinimal = [
    code, firstName.trim(), lastName.trim(), email.trim(), phone?.trim() || null,
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
  if (portalUsername && portalUsername.trim() && portalPassword && portalUserType) {
    try {
      const hash = await bcrypt.hash(portalPassword, 10)
      const uType = ['Admin', 'SuperAdmin', 'Staff', 'User'].includes(portalUserType) ? portalUserType : 'User'
      await adminRepo.createUser(portalUsername.trim(), hash, uType, newId)
    } catch (err) {
      if (err.code === '23505' || err.number === 2627 || err.number === 2601) {
        const e = new Error('Employee created but username already exists. Edit employee to set a different username.')
        e.status = 409
        throw e
      }
      if (err.code !== '42P01' && err.number !== 208) throw err
    }
  }
  return { message: 'Employee added successfully', employee: result[0] }
}

export async function updateEmployee(id, body) {
  const {
    employeeCode, firstName, lastName, email, phone, departmentId,
    designationId, employeeTypeId, stationId, cityId, position, isActive,
    portalUsername, portalPassword, portalUserType
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
    stationId: resolvedStationId, cityId: cityId ?? null, position, employeeCode, isActive
  })
  if (portalUsername !== undefined || portalPassword !== undefined || portalUserType !== undefined) {
    try {
      const existingUser = await adminRepo.findUserByEmpId(id)
      const uType = portalUserType && ['Admin', 'SuperAdmin', 'Staff', 'User'].includes(portalUserType) ? portalUserType : 'User'
      if (existingUser.length > 0) {
        const uid = existingUser[0].user_id
        if (portalUsername && portalUsername.trim()) {
          if (portalPassword && portalPassword.length >= 8) {
            const hash = await bcrypt.hash(portalPassword, 10)
            await adminRepo.updateUser(uid, portalUsername.trim(), hash, uType)
          } else {
            await adminRepo.updateUser(uid, portalUsername.trim(), null, uType)
          }
        } else {
          await adminRepo.updateUser(uid, existingUser[0].username, null, uType)
        }
      } else if (portalUsername && portalUsername.trim() && portalPassword && portalPassword.length >= 8) {
        const hash = await bcrypt.hash(portalPassword, 10)
        await adminRepo.createUser(portalUsername.trim(), hash, uType, id)
      }
    } catch (err) {
      if (err.code === '42P01') { /* ok */ } else if (err.code === '23505') {
        const e = new Error('Employee updated but username already in use')
        e.status = 409
        throw e
      } else throw err
    }
  }
  const result = await adminRepo.getEmployeeById(id)
  if (!result.length) return { notFound: true }
  return result[0]
}

export async function deactivateEmployee(id) {
  const check = await adminRepo.deactivateEmployee(id)
  if (!check.length) return { notFound: true }
  return { message: 'Employee deactivated' }
}

export async function getUserByEmployee(empId) {
  return adminRepo.getUserByEmployee(empId)
}
