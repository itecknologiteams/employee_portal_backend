import { executeQuery } from '../../config/database.js'

// Departments
export async function listDepartments() {
  return executeQuery(
    'SELECT department_id AS id, department_name AS name, description FROM departments ORDER BY department_name'
  )
}

export async function createDepartment(name, description) {
  await executeQuery(
    'INSERT INTO departments (department_name, description) VALUES ($1, $2)',
    [name.trim(), description?.trim() || null]
  )
  const r = await executeQuery(
    'SELECT department_id AS id, department_name AS name, description FROM departments WHERE department_name = $1',
    [name.trim()]
  )
  return r[0]
}

export async function updateDepartment(id, name, description) {
  await executeQuery(
    'UPDATE departments SET department_name = $1, description = $2 WHERE department_id = $3',
    [name.trim(), description?.trim() || null, id]
  )
  const r = await executeQuery(
    'SELECT department_id AS id, department_name AS name, description FROM departments WHERE department_id = $1',
    [id]
  )
  return r
}

export async function deleteDepartment(id) {
  const existing = await executeQuery('SELECT department_id FROM departments WHERE department_id = $1', [id])
  if (!existing.length) return { notFound: true }
  await executeQuery('DELETE FROM departments WHERE department_id = $1', [id])
  return {}
}

// Designations
export async function listDesignations() {
  return executeQuery('SELECT desg_id AS id, desg_name AS name FROM designation ORDER BY desg_name')
}

export async function createDesignation(name) {
  await executeQuery('INSERT INTO designation (desg_name) VALUES ($1)', [name.trim()])
  const r = await executeQuery('SELECT desg_id AS id, desg_name AS name FROM designation WHERE desg_name = $1', [name.trim()])
  return r[0]
}

export async function updateDesignation(id, name) {
  await executeQuery('UPDATE designation SET desg_name = $1 WHERE desg_id = $2', [name.trim(), id])
  const r = await executeQuery('SELECT desg_id AS id, desg_name AS name FROM designation WHERE desg_id = $1', [id])
  return r
}

export async function deleteDesignation(id) {
  const existing = await executeQuery('SELECT desg_id FROM designation WHERE desg_id = $1', [id])
  if (!existing.length) return { notFound: true }
  await executeQuery('DELETE FROM designation WHERE desg_id = $1', [id])
  return {}
}

// Employee types
export async function listEmployeeTypes() {
  return executeQuery('SELECT emp_type_id AS id, emp_type_name AS name FROM employee_type ORDER BY emp_type_name')
}

export async function createEmployeeType(name) {
  await executeQuery('INSERT INTO employee_type (emp_type_name) VALUES ($1)', [name.trim()])
  const r = await executeQuery('SELECT emp_type_id AS id, emp_type_name AS name FROM employee_type WHERE emp_type_name = $1', [name.trim()])
  return r[0]
}

export async function updateEmployeeType(id, name) {
  await executeQuery('UPDATE employee_type SET emp_type_name = $1 WHERE emp_type_id = $2', [name.trim(), id])
  const r = await executeQuery('SELECT emp_type_id AS id, emp_type_name AS name FROM employee_type WHERE emp_type_id = $1', [id])
  return r
}

export async function deleteEmployeeType(id) {
  const existing = await executeQuery('SELECT emp_type_id FROM employee_type WHERE emp_type_id = $1', [id])
  if (!existing.length) return { notFound: true }
  await executeQuery('DELETE FROM employee_type WHERE emp_type_id = $1', [id])
  return {}
}

// Stations
export async function listStations() {
  try {
    return await executeQuery(`
      SELECT s.station_id AS id, s.station_name AS name,
        (SELECT string_agg(c.city_name, ', ' ORDER BY c.city_name) FROM city c WHERE c.station_id = s.station_id) AS city_name
      FROM station s ORDER BY s.station_name
    `)
  } catch (err) {
    if (err.code === '42P01') return []
    throw err
  }
}

export async function createStation(name) {
  await executeQuery('INSERT INTO station (station_name) VALUES ($1)', [name.trim()])
  const r = await executeQuery(
    'SELECT s.station_id AS id, s.station_name AS name, NULL::integer AS city_id, NULL AS city_name FROM station s WHERE s.station_name = $1',
    [name.trim()]
  )
  return r[0]
}

export async function updateStation(id, name) {
  await executeQuery('UPDATE station SET station_name = $1 WHERE station_id = $2', [name.trim(), id])
  const r = await executeQuery(`
    SELECT s.station_id AS id, s.station_name AS name,
      (SELECT string_agg(c.city_name, ', ' ORDER BY c.city_name) FROM city c WHERE c.station_id = s.station_id) AS city_name
    FROM station s WHERE s.station_id = $1
  `, [id])
  return r
}

export async function deleteStation(id) {
  const existing = await executeQuery('SELECT station_id FROM station WHERE station_id = $1', [id])
  if (!existing.length) return { notFound: true }
  await executeQuery('DELETE FROM station WHERE station_id = $1', [id])
  return {}
}

// Cities
export async function listCities() {
  try {
    return await executeQuery(`
      SELECT c.city_id AS id, c.city_name AS name, c.station_id, s.station_name
      FROM city c LEFT JOIN station s ON c.station_id = s.station_id
      ORDER BY c.city_name
    `)
  } catch (err) {
    if (err.code === '42P01') return []
    throw err
  }
}

export async function createCity(name, stationId) {
  await executeQuery('INSERT INTO city (city_name, station_id) VALUES ($1, $2)', [name.trim(), stationId])
  const r = await executeQuery(`
    SELECT c.city_id AS id, c.city_name AS name, c.station_id, s.station_name
    FROM city c LEFT JOIN station s ON c.station_id = s.station_id
    WHERE c.city_name = $1 AND c.station_id = $2
  `, [name.trim(), stationId])
  return r[0]
}

export async function updateCity(id, name, stationId) {
  await executeQuery('UPDATE city SET city_name = $1, station_id = $2 WHERE city_id = $3', [name.trim(), stationId, id])
  const r = await executeQuery(`
    SELECT c.city_id AS id, c.city_name AS name, c.station_id, s.station_name
    FROM city c LEFT JOIN station s ON c.station_id = s.station_id
    WHERE c.city_id = $1
  `, [id])
  return r
}

export async function deleteCity(id) {
  const existing = await executeQuery('SELECT city_id FROM city WHERE city_id = $1', [id])
  if (!existing.length) return { notFound: true }
  await executeQuery('DELETE FROM city WHERE city_id = $1', [id])
  return {}
}

// Employees list – city_name is the selected city only (from employees.city_id)
const employeesFullQuery = `
  SELECT e.employee_id AS id, e.employee_code AS code, e.first_name, e.last_name, e.email, e.phone,
    e.department_id, d.department_name, e.position, e.designation_id, desg.desg_name AS designation_name,
    e.employee_type_id, et.emp_type_name AS employee_type_name, e.station_id, s.station_name,
    e.city_id, c.city_name,
    e.is_active, e.join_date
  FROM employees e
  LEFT JOIN departments d ON e.department_id = d.department_id
  LEFT JOIN designation desg ON e.designation_id = desg.desg_id
  LEFT JOIN employee_type et ON e.employee_type_id = et.emp_type_id
  LEFT JOIN station s ON e.station_id = s.station_id
  LEFT JOIN city c ON e.city_id = c.city_id
  ORDER BY e.first_name, e.last_name
`

export async function listEmployees() {
  try {
    return await executeQuery(employeesFullQuery)
  } catch (err) {
    if (err.code === '42P01' || err.code === '42703') {
      try {
        return await executeQuery(`
          SELECT e.employee_id AS id, e.employee_code AS code, e.first_name, e.last_name, e.email, e.phone,
            e.department_id, d.department_name, e.position, NULL::integer AS designation_id, NULL AS designation_name,
            NULL::integer AS employee_type_id, NULL AS employee_type_name, NULL::integer AS station_id, NULL AS station_name,
            NULL::integer AS city_id, NULL AS city_name, COALESCE(e.is_active, true) AS is_active, e.join_date
          FROM employees e LEFT JOIN departments d ON e.department_id = d.department_id
          ORDER BY e.first_name, e.last_name
        `)
      } catch (err2) {
        const rows = await executeQuery(`
          SELECT e.employee_id AS id, e.employee_code AS code, e.first_name, e.last_name, e.email, e.phone,
            e.department_id, d.department_name, e.position, NULL::integer AS designation_id, NULL AS designation_name,
            NULL::integer AS employee_type_id, NULL AS employee_type_name, COALESCE(e.is_active, true) AS is_active, e.join_date
          FROM employees e LEFT JOIN departments d ON e.department_id = d.department_id
          ORDER BY e.first_name, e.last_name
        `)
        return rows.map(r => ({ ...r, station_id: null, station_name: null, city_id: null, city_name: null }))
      }
    }
    throw err
  }
}

export async function getStationIdByCityId(cityId) {
  try {
    const r = await executeQuery('SELECT station_id FROM city WHERE city_id = $1', [cityId])
    return r.length ? r[0].station_id : null
  } catch (_) {
    return null
  }
}

export async function findEmployeeByEmail(email) {
  return executeQuery('SELECT employee_id FROM employees WHERE email = $1', [email.trim()])
}

const insertEmployeeFull = `INSERT INTO employees (
  employee_code, first_name, last_name, email, phone,
  department_id, designation_id, employee_type_id, station_id, city_id, position, join_date, is_active
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`
const insertEmployeeMinimal = `INSERT INTO employees (
  employee_code, first_name, last_name, email, phone,
  department_id, position, join_date, is_active
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`

export async function createEmployeeFull(params) {
  return executeQuery(insertEmployeeFull, params)
}

export async function createEmployeeMinimal(params) {
  return executeQuery(insertEmployeeMinimal, params)
}

export async function getEmployeeByEmail(email) {
  return executeQuery(
    'SELECT employee_id AS id, first_name, last_name, email FROM employees WHERE email = $1',
    [email.trim()]
  )
}

export async function initLeaveBalanceForEmployee(employeeId) {
  return executeQuery(
    'INSERT INTO leave_balance (employee_id, annual_leave, sick_leave, personal_leave) VALUES ($1, 15, 10, 5)',
    [employeeId]
  ).catch(() => {})
}

export async function createUser(username, hashedPassword, userType, empId) {
  return executeQuery(
    'INSERT INTO users (username, password, user_type, emp_id) VALUES ($1, $2, $3, $4)',
    [username.trim(), hashedPassword, userType, empId]
  )
}

export async function updateEmployee(id, updates) {
  const { firstName, lastName, email, phone, departmentId, designationId, employeeTypeId, stationId, cityId, position, employeeCode, isActive } = updates
  let params = [
    firstName.trim(), lastName.trim(), email.trim(), phone?.trim() || null,
    departmentId || null, designationId || null, employeeTypeId || null, stationId, cityId ?? null, position?.trim() || null,
    employeeCode?.trim() || null
  ]
  const setClauses = [
    'first_name = $1', 'last_name = $2', 'email = $3', 'phone = $4',
    'department_id = $5', 'designation_id = $6', 'employee_type_id = $7', 'station_id = $8', 'city_id = $9', 'position = $10', 'employee_code = $11'
  ]
  let idx = 12
  if (typeof isActive === 'boolean') {
    setClauses.push(`is_active = $${idx}`)
    params.push(isActive)
    idx++
  }
  params.push(id)
  await executeQuery(
    `UPDATE employees SET ${setClauses.join(', ')} WHERE employee_id = $${idx}`,
    params
  )
}

export async function findUserByEmpId(empId) {
  return executeQuery('SELECT user_id, username, user_type FROM users WHERE emp_id = $1', [empId])
}

export async function updateUser(uid, username, password, userType) {
  if (password) {
    await executeQuery('UPDATE users SET username = $1, password = $2, user_type = $3 WHERE user_id = $4', [username, password, userType, uid])
  } else {
    await executeQuery('UPDATE users SET username = $1, user_type = $2 WHERE user_id = $3', [username, userType, uid])
  }
}

export async function getEmployeeById(id) {
  try {
    return await executeQuery(`
      SELECT e.employee_id AS id, e.employee_code AS code, e.first_name, e.last_name, e.email, e.phone,
        e.department_id, d.department_name, e.position, e.designation_id, desg.desg_name AS designation_name,
        e.employee_type_id, et.emp_type_name AS employee_type_name,
        e.station_id, s.station_name,
        e.city_id, c.city_name,
        e.is_active, e.join_date
      FROM employees e
      LEFT JOIN departments d ON e.department_id = d.department_id
      LEFT JOIN designation desg ON e.designation_id = desg.desg_id
      LEFT JOIN employee_type et ON e.employee_type_id = et.emp_type_id
      LEFT JOIN station s ON e.station_id = s.station_id
      LEFT JOIN city c ON e.city_id = c.city_id
      WHERE e.employee_id = $1
    `, [id])
  } catch (err) {
    if (err.code === '42P01' || err.code === '42703') {
      const r = await executeQuery(`
        SELECT e.employee_id AS id, e.employee_code AS code, e.first_name, e.last_name, e.email, e.phone,
          e.department_id, d.department_name, e.position, e.designation_id, desg.desg_name AS designation_name,
          e.employee_type_id, et.emp_type_name AS employee_type_name, e.is_active, e.join_date
        FROM employees e
        LEFT JOIN departments d ON e.department_id = d.department_id
        LEFT JOIN designation desg ON e.designation_id = desg.desg_id
        LEFT JOIN employee_type et ON e.employee_type_id = et.emp_type_id
        WHERE e.employee_id = $1
      `, [id])
      if (r.length) Object.assign(r[0], { station_id: null, station_name: null, city_name: null, city_id: null })
      return r
    }
    throw err
  }
}

export async function deactivateEmployee(id) {
  await executeQuery('UPDATE employees SET is_active = $2 WHERE employee_id = $1', [id, false])
  return executeQuery('SELECT employee_id FROM employees WHERE employee_id = $1 AND is_active = $2', [id, false])
}

export async function getUserByEmployee(empId) {
  try {
    const rows = await executeQuery(
      'SELECT user_id AS id, username, user_type FROM users WHERE emp_id = $1',
      [empId]
    )
    return rows.length ? { id: rows[0].id, username: rows[0].username, userType: rows[0].user_type } : null
  } catch (err) {
    if (err.code === '42P01') return null
    throw err
  }
}
