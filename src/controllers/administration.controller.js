import * as adminService from '../services/administration.service.js'

function handleError(error, res, fallbackMessage) {
  if (error.status) {
    return res.status(error.status).json({ error: error.message })
  }
  if (error.code === '23503') {
    return res.status(400).json({ error: 'Cannot delete: referenced by other records' })
  }
  if (error.code === '23505') {
    return res.status(409).json({ error: 'Record already exists' })
  }
  console.error(fallbackMessage, error)
  return res.status(500).json({ error: fallbackMessage })
}

// Departments
export async function listDepartments(req, res) {
  try {
    const rows = await adminService.listDepartments()
    res.json(rows)
  } catch (error) {
    handleError(error, res, 'Failed to fetch departments')
  }
}

export async function createDepartment(req, res) {
  try {
    const { name, description } = req.body
    if (!name || !name.trim()) return res.status(400).json({ error: 'Department name is required' })
    const result = await adminService.createDepartment(name, description)
    res.status(201).json(result)
  } catch (error) {
    handleError(error, res, 'Failed to create department')
  }
}

export async function updateDepartment(req, res) {
  try {
    const { id } = req.params
    const { name, description } = req.body
    if (!name || !name.trim()) return res.status(400).json({ error: 'Department name is required' })
    const result = await adminService.updateDepartment(id, name, description)
    if (result.notFound) return res.status(404).json({ error: 'Department not found' })
    res.json(result)
  } catch (error) {
    handleError(error, res, 'Failed to update department')
  }
}

export async function deleteDepartment(req, res) {
  try {
    const { id } = req.params
    const result = await adminService.deleteDepartment(id)
    if (result.notFound) return res.status(404).json({ error: 'Department not found' })
    res.json({ message: 'Department deleted' })
  } catch (error) {
    if (error.code === '23503') return res.status(400).json({ error: 'Cannot delete department: employees are assigned to it' })
    handleError(error, res, 'Failed to delete department')
  }
}

// Designations – pagination & search via query params (search, page, limit)
export async function listDesignations(req, res) {
  try {
    const { search, page, limit } = req.query
    if (search !== undefined || page !== undefined || limit !== undefined) {
      const result = await adminService.listDesignationsSearchPaginated(search, page, limit)
      return res.json(result)
    }
    const rows = await adminService.listDesignations()
    res.json(rows)
  } catch (error) {
    handleError(error, res, 'Failed to fetch designations')
  }
}

export async function createDesignation(req, res) {
  try {
    const { name } = req.body
    if (!name || !name.trim()) return res.status(400).json({ error: 'Designation name is required' })
    const result = await adminService.createDesignation(name)
    res.status(201).json(result)
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Designation already exists' })
    handleError(error, res, 'Failed to create designation')
  }
}

export async function updateDesignation(req, res) {
  try {
    const { id } = req.params
    const { name } = req.body
    if (!name || !name.trim()) return res.status(400).json({ error: 'Designation name is required' })
    const result = await adminService.updateDesignation(id, name)
    if (result.notFound) return res.status(404).json({ error: 'Designation not found' })
    res.json(result)
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Designation already exists' })
    handleError(error, res, 'Failed to update designation')
  }
}

export async function deleteDesignation(req, res) {
  try {
    const { id } = req.params
    const result = await adminService.deleteDesignation(id)
    if (result.notFound) return res.status(404).json({ error: 'Designation not found' })
    res.json({ message: 'Designation deleted' })
  } catch (error) {
    if (error.code === '23503') return res.status(400).json({ error: 'Cannot delete: employees are assigned to this designation' })
    handleError(error, res, 'Failed to delete designation')
  }
}

// Employee types
export async function listEmployeeTypes(req, res) {
  try {
    const { page, limit } = req.query
    const result = await adminService.listEmployeeTypesPaginated(page, limit)
    res.json(result)
  } catch (error) {
    handleError(error, res, 'Failed to fetch employee types')
  }
}

export async function createEmployeeType(req, res) {
  try {
    const { name } = req.body
    if (!name || !name.trim()) return res.status(400).json({ error: 'Employee type name is required' })
    const result = await adminService.createEmployeeType(name)
    res.status(201).json(result)
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Employee type already exists' })
    handleError(error, res, 'Failed to create employee type')
  }
}

export async function updateEmployeeType(req, res) {
  try {
    const { id } = req.params
    const { name } = req.body
    if (!name || !name.trim()) return res.status(400).json({ error: 'Employee type name is required' })
    const result = await adminService.updateEmployeeType(id, name)
    if (result.notFound) return res.status(404).json({ error: 'Employee type not found' })
    res.json(result)
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Employee type already exists' })
    handleError(error, res, 'Failed to update employee type')
  }
}

export async function deleteEmployeeType(req, res) {
  try {
    const { id } = req.params
    const result = await adminService.deleteEmployeeType(id)
    if (result.notFound) return res.status(404).json({ error: 'Employee type not found' })
    res.json({ message: 'Employee type deleted' })
  } catch (error) {
    if (error.code === '23503') return res.status(400).json({ error: 'Cannot delete: employees are assigned to this type' })
    handleError(error, res, 'Failed to delete employee type')
  }
}

// Stations
export async function listStations(req, res) {
  try {
    const rows = await adminService.listStations()
    res.json(rows)
  } catch (error) {
    if (error.code === '42P01') return res.json([])
    handleError(error, res, 'Failed to fetch stations')
  }
}

export async function createStation(req, res) {
  try {
    const { name } = req.body
    if (!name || !name.trim()) return res.status(400).json({ error: 'Station name is required' })
    const result = await adminService.createStation(name)
    res.status(201).json(result)
  } catch (error) {
    if (error.code === '42P01') return res.status(500).json({ error: 'Station table does not exist. Run migration-city-station.sql.' })
    handleError(error, res, 'Failed to create station')
  }
}

export async function updateStation(req, res) {
  try {
    const { id } = req.params
    const { name } = req.body
    if (!name || !name.trim()) return res.status(400).json({ error: 'Station name is required' })
    const result = await adminService.updateStation(id, name)
    if (result.notFound) return res.status(404).json({ error: 'Station not found' })
    res.json(result)
  } catch (error) {
    handleError(error, res, 'Failed to update station')
  }
}

export async function deleteStation(req, res) {
  try {
    const { id } = req.params
    const result = await adminService.deleteStation(id)
    if (result.notFound) return res.status(404).json({ error: 'Station not found' })
    res.json({ message: 'Station deleted' })
  } catch (error) {
    if (error.code === '23503') return res.status(400).json({ error: 'Cannot delete station: employees are assigned to it' })
    handleError(error, res, 'Failed to delete station')
  }
}

// Cities – pagination & search via query params (search, page, limit)
export async function listCities(req, res) {
  try {
    const { search, page, limit } = req.query
    if (search !== undefined || page !== undefined || limit !== undefined) {
      const result = await adminService.listCitiesSearchPaginated(search, page, limit)
      return res.json(result)
    }
    const rows = await adminService.listCities()
    res.json(rows)
  } catch (error) {
    if (error.code === '42P01') return res.json([])
    handleError(error, res, 'Failed to fetch cities')
  }
}

export async function createCity(req, res) {
  try {
    const { name, stationId } = req.body
    if (!name || !name.trim()) return res.status(400).json({ error: 'City name is required' })
    if (!stationId) return res.status(400).json({ error: 'Station is required – cities are identified by station' })
    const result = await adminService.createCity(name, stationId)
    res.status(201).json(result)
  } catch (error) {
    if (error.code === '42P01') return res.status(500).json({ error: 'City table does not exist. Run migration-city-station.sql.' })
    handleError(error, res, 'Failed to create city')
  }
}

export async function updateCity(req, res) {
  try {
    const { id } = req.params
    const { name, stationId } = req.body
    if (!name || !name.trim()) return res.status(400).json({ error: 'City name is required' })
    if (!stationId) return res.status(400).json({ error: 'Station is required' })
    const result = await adminService.updateCity(id, name, stationId)
    if (result.notFound) return res.status(404).json({ error: 'City not found' })
    res.json(result)
  } catch (error) {
    handleError(error, res, 'Failed to update city')
  }
}

export async function deleteCity(req, res) {
  try {
    const { id } = req.params
    const result = await adminService.deleteCity(id)
    if (result.notFound) return res.status(404).json({ error: 'City not found' })
    res.json({ message: 'City deleted' })
  } catch (error) {
    handleError(error, res, 'Failed to delete city')
  }
}

// Employees – search, pagination, filters: departmentId, designationId, cityId, status (active|inactive)
export async function listEmployees(req, res) {
  try {
    const { search, page, limit, departmentId, designationId, cityId, status } = req.query
    const hasFilters = [search, page, limit, departmentId, designationId, cityId, status].some(v => v !== undefined)
    if (hasFilters) {
      const result = await adminService.listEmployeesSearchPaginated(search, page, limit, {
        departmentId,
        designationId,
        cityId,
        status
      })
      return res.json(result)
    }
    const rows = await adminService.listEmployees()
    res.json(rows)
  } catch (error) {
    handleError(error, res, 'Failed to fetch employees')
  }
}

export async function createEmployee(req, res) {
  try {
    const result = await adminService.createEmployee(req.body)
    res.status(201).json(result)
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message })
    console.error('Create employee error:', error)
    res.status(500).json({ error: 'Failed to create employee', detail: error.message })
  }
}

export async function updateEmployee(req, res) {
  try {
    const { id } = req.params
    const result = await adminService.updateEmployee(id, req.body)
    if (result.notFound) return res.status(404).json({ error: 'Employee not found' })
    res.json(result)
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Email already in use' })
    if (error.status) return res.status(error.status).json({ error: error.message })
    handleError(error, res, 'Failed to update employee')
  }
}

export async function deactivateEmployee(req, res) {
  try {
    const { id } = req.params
    const result = await adminService.deactivateEmployee(id)
    if (result.notFound) return res.status(404).json({ error: 'Employee not found' })
    res.json(result)
  } catch (error) {
    handleError(error, res, 'Failed to deactivate employee')
  }
}

export async function getSuperAdminStatus(req, res) {
  try {
    const result = await adminService.getSuperAdminStatus()
    res.json(result)
  } catch (error) {
    if (error.code === '42P01') return res.json({ exists: false, superAdminEmployeeId: null })
    console.error('SuperAdmin status error:', error)
    res.status(500).json({ error: 'Failed to check SuperAdmin status' })
  }
}

export async function getRoleDefaults(req, res) {
  try {
    const { role } = req.params
    const result = await adminService.getRoleDefaults(role)
    res.json(result)
  } catch (error) {
    if (error.code === '42P01') return res.json({ roleDefaults: {} })
    console.error('Get role defaults error:', error)
    res.status(500).json({ error: 'Failed to fetch role defaults' })
  }
}

export async function getUserByEmployee(req, res) {
  try {
    const { empId } = req.params
    const result = await adminService.getUserByEmployee(empId)
    res.json(result)
  } catch (error) {
    if (error.code === '42P01') return res.json(null)
    handleError(error, res, 'Failed to fetch user')
  }
}

// Requisition Category Management (admin)
export async function listRequisitionCategories(req, res) {
  try {
    const rows = await adminService.listRequisitionCategoriesAdmin()
    res.json(rows)
  } catch (error) {
    handleError(error, res, 'Failed to fetch requisition categories')
  }
}

export async function createRequisitionCategory(req, res) {
  try {
    const { name, ...flags } = req.body
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Category name is required' })
    const result = await adminService.createRequisitionCategoryAdmin(String(name).trim(), flags)
    res.status(201).json(result)
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Category with this name already exists' })
    handleError(error, res, 'Failed to create category')
  }
}

export async function updateRequisitionCategory(req, res) {
  try {
    const { id } = req.params
    const { name, form_layout, ...flags } = req.body
    const result = await adminService.updateRequisitionCategoryAdmin(id, name || null, { ...flags, form_layout })
    if (!result) return res.status(404).json({ error: 'Category not found' })
    res.json(result)
  } catch (error) {
    handleError(error, res, 'Failed to update category')
  }
}

export async function deleteRequisitionCategory(req, res) {
  try {
    const { id } = req.params
    const deleted = await adminService.deleteRequisitionCategoryAdmin(id)
    if (!deleted) return res.status(404).json({ error: 'Category not found' })
    res.json({ message: 'Category deleted' })
  } catch (error) {
    handleError(error, res, 'Failed to delete category')
  }
}
