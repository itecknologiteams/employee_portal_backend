import { executeQuery } from '../../config/database.js'

// Full profile: department, designation, employee_type, station, city
const profileQueryFull = `
  SELECT e.employee_id, e.first_name, e.last_name, e.email, e.phone, e.address,
    e.department_id, d.department_name, e.position, e.employee_code, e.join_date, e.bio, e.profile_picture,
    e.designation_id, desg.desg_name AS designation_name,
    e.employee_type_id, et.emp_type_name AS employee_type_name,
    e.station_id, s.station_name,
    e.city_id, c.city_name
  FROM employees e
  LEFT JOIN departments d ON e.department_id = d.department_id
  LEFT JOIN designation desg ON e.designation_id = desg.desg_id
  LEFT JOIN employee_type et ON e.employee_type_id = et.emp_type_id
  LEFT JOIN station s ON e.station_id = s.station_id
  LEFT JOIN city c ON e.city_id = c.city_id
  WHERE e.employee_id = $1
`

// Fallback when station/city tables missing (still return e.station_id, e.city_id for reference)
const profileQueryNoStationCity = `
  SELECT e.employee_id, e.first_name, e.last_name, e.email, e.phone, e.address,
    e.department_id, d.department_name, e.position, e.employee_code, e.join_date, e.bio, e.profile_picture,
    e.designation_id, desg.desg_name AS designation_name,
    e.employee_type_id, et.emp_type_name AS employee_type_name,
    e.station_id, e.city_id, NULL::text AS station_name, NULL::text AS city_name
  FROM employees e
  LEFT JOIN departments d ON e.department_id = d.department_id
  LEFT JOIN designation desg ON e.designation_id = desg.desg_id
  LEFT JOIN employee_type et ON e.employee_type_id = et.emp_type_id
  WHERE e.employee_id = $1
`

// Fallback when designation/employee_type/station/city tables missing
const profileQueryMinimal = `
  SELECT e.employee_id, e.first_name, e.last_name, e.email, e.phone, e.address,
    e.department_id, d.department_name, e.position, e.employee_code, e.join_date, e.bio, e.profile_picture,
    e.designation_id, NULL::text AS designation_name,
    e.employee_type_id, NULL::text AS employee_type_name,
    e.station_id, e.city_id, NULL::text AS station_name, NULL::text AS city_name
  FROM employees e
  LEFT JOIN departments d ON e.department_id = d.department_id
  WHERE e.employee_id = $1
`

export async function getProfile(employeeId) {
  try {
    return await executeQuery(profileQueryFull, [employeeId])
  } catch (err) {
    if (err.code === '42P01' || err.code === '42703') {
      try {
        return await executeQuery(profileQueryNoStationCity, [employeeId])
      } catch (_) {
        return await executeQuery(profileQueryMinimal, [employeeId])
      }
    }
    throw err
  }
}

export async function getEmployeeTypeName(employeeId) {
  try {
    const r = await executeQuery(
      'SELECT et.emp_type_name FROM employees e JOIN employee_type et ON e.employee_type_id = et.emp_type_id WHERE e.employee_id = $1',
      [employeeId]
    )
    return r.length > 0 ? r[0].emp_type_name : null
  } catch (_) {
    return null
  }
}

export async function getDesignationName(employeeId) {
  try {
    const r = await executeQuery(
      'SELECT desg.desg_name FROM employees e JOIN designation desg ON e.designation_id = desg.desg_id WHERE e.employee_id = $1',
      [employeeId]
    )
    return r.length > 0 ? r[0].desg_name : null
  } catch (_) {
    return null
  }
}

export async function updateProfile(employeeId, { email, phone, address, bio }) {
  return executeQuery(
    `UPDATE employees SET email = $1, phone = $2, address = $3, bio = $4, updated_at = CURRENT_TIMESTAMP WHERE employee_id = $5`,
    [email, phone, address, bio, employeeId]
  )
}
