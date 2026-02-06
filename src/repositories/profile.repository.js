import { executeQuery } from '../../config/database.js'

const profileQuery = `
  SELECT e.employee_id, e.first_name, e.last_name, e.email, e.phone, e.address,
    e.department_id, d.department_name, e.position, e.employee_code, e.join_date, e.bio, e.profile_picture,
    e.station_id, s.station_name,
    (SELECT string_agg(c.city_name, ', ' ORDER BY c.city_name) FROM city c WHERE c.station_id = s.station_id) AS city_name
  FROM employees e
  LEFT JOIN departments d ON e.department_id = d.department_id
  LEFT JOIN station s ON e.station_id = s.station_id
  WHERE e.employee_id = $1
`

const profileQueryFallback = `
  SELECT e.employee_id, e.first_name, e.last_name, e.email, e.phone, e.address,
    e.department_id, d.department_name, e.position, e.employee_code, e.join_date, e.bio, e.profile_picture
  FROM employees e
  LEFT JOIN departments d ON e.department_id = d.department_id
  WHERE e.employee_id = $1
`

export async function getProfile(employeeId) {
  try {
    return await executeQuery(profileQuery, [employeeId])
  } catch (err) {
    if (err.code === '42P01' || err.code === '42703') {
      return await executeQuery(profileQueryFallback, [employeeId])
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
