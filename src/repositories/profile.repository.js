import { executeQuery } from '../../config/database.js'

// Full profile: department, designation, employee_type, station, city, grade (names) + extended profile fields
// Date columns cast to TEXT to preserve YYYY-MM-DD format (avoid UTC conversion by pg driver)
const profileQueryFull = `
  SELECT e.employee_id, e.first_name, e.last_name, e.email, e.phone, e.address,
    e.department_id, d.department_name, e.position, e.employee_code, e.join_date::text AS join_date, e.bio, e.profile_picture,
    e.designation_id, desg.desg_name AS designation_name,
    e.employee_type_id, et.emp_type_name AS employee_type_name,
    e.station_id, s.station_name,
    e.city_id, c.city_name,
    e.date_of_birth::text AS date_of_birth, e.father_name, e.gender, e.marital_status, e.religion,
    COALESCE(g.grade_name, e.grade) AS grade,
    e.cnic_number, e.cnic_issue_date::text AS cnic_issue_date, e.cnic_expiry_date::text AS cnic_expiry_date,
    e.emergency_contact_number, e.employee_extension, e.personal_cell_number
  FROM employees e
  LEFT JOIN departments d ON e.department_id = d.department_id
  LEFT JOIN designation desg ON e.designation_id = desg.desg_id
  LEFT JOIN employee_type et ON e.employee_type_id = et.emp_type_id
  LEFT JOIN station s ON e.station_id = s.station_id
  LEFT JOIN city c ON e.city_id = c.city_id
  LEFT JOIN grade g ON e.grade_id = g.grade_id
  WHERE e.employee_id = $1
`

// Fallback when station/city tables missing (no extended columns so old DBs work)
const profileQueryNoStationCity = `
  SELECT e.employee_id, e.first_name, e.last_name, e.email, e.phone, e.address,
    e.department_id, d.department_name, e.position, e.employee_code, e.join_date::text AS join_date, e.bio, e.profile_picture,
    e.designation_id, desg.desg_name AS designation_name,
    e.employee_type_id, et.emp_type_name AS employee_type_name,
    e.station_id, e.city_id, NULL::text AS station_name, NULL::text AS city_name,
    e.date_of_birth::text AS date_of_birth, e.father_name, e.gender, e.marital_status, e.religion, e.grade,
    e.cnic_number, e.cnic_issue_date::text AS cnic_issue_date, e.cnic_expiry_date::text AS cnic_expiry_date,
    e.emergency_contact_number, e.employee_extension, e.personal_cell_number
  FROM employees e
  LEFT JOIN departments d ON e.department_id = d.department_id
  LEFT JOIN designation desg ON e.designation_id = desg.desg_id
  LEFT JOIN employee_type et ON e.employee_type_id = et.emp_type_id
  WHERE e.employee_id = $1
`

// Fallback when designation/employee_type/station/city tables missing (no extended columns)
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

// Full profile without grade table (fallback when grade table or grade_id column missing)
const profileQueryFullNoGrade = `
  SELECT e.employee_id, e.first_name, e.last_name, e.email, e.phone, e.address,
    e.department_id, d.department_name, e.position, e.employee_code, e.join_date::text AS join_date, e.bio, e.profile_picture,
    e.designation_id, desg.desg_name AS designation_name,
    e.employee_type_id, et.emp_type_name AS employee_type_name,
    e.station_id, s.station_name,
    e.city_id, c.city_name,
    e.date_of_birth::text AS date_of_birth, e.father_name, e.gender, e.marital_status, e.religion, e.grade,
    e.cnic_number, e.cnic_issue_date::text AS cnic_issue_date, e.cnic_expiry_date::text AS cnic_expiry_date,
    e.emergency_contact_number, e.employee_extension, e.personal_cell_number
  FROM employees e
  LEFT JOIN departments d ON e.department_id = d.department_id
  LEFT JOIN designation desg ON e.designation_id = desg.desg_id
  LEFT JOIN employee_type et ON e.employee_type_id = et.emp_type_id
  LEFT JOIN station s ON e.station_id = s.station_id
  LEFT JOIN city c ON e.city_id = c.city_id
  WHERE e.employee_id = $1
`

export async function getProfile(employeeId) {
  try {
    return await executeQuery(profileQueryFull, [employeeId])
  } catch (err) {
    if (err.code === '42P01' || err.code === '42703') {
      try {
        return await executeQuery(profileQueryFullNoGrade, [employeeId])
      } catch (_) {
        try {
          return await executeQuery(profileQueryNoStationCity, [employeeId])
        } catch (__) {
          return await executeQuery(profileQueryMinimal, [employeeId])
        }
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

/** Legacy direct update – no longer used by profile flow; kept for admin/HR via administration. */
export async function updateProfile(employeeId, { email, phone, address, bio }) {
  return executeQuery(
    `UPDATE employees SET email = $1, phone = $2, address = $3, bio = $4, updated_at = CURRENT_TIMESTAMP WHERE employee_id = $5`,
    [email, phone, address, bio, employeeId]
  )
}

// ---------- Profile change requests (HR bucket) ----------

export async function createOrUpdateProfileChangeRequest(employeeId, requestedData) {
  const dataJson = JSON.stringify(requestedData || {})
  const existing = await executeQuery(
    'SELECT id FROM profile_change_requests WHERE employee_id = $1 AND status = $2',
    [employeeId, 'Pending']
  )
  if (existing.length > 0) {
    return executeQuery(
      `UPDATE profile_change_requests SET requested_data = $1::jsonb, requested_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, employee_id, status, requested_at`,
      [dataJson, existing[0].id]
    )
  }
  return executeQuery(
    `INSERT INTO profile_change_requests (employee_id, requested_data, status, requested_at)
     VALUES ($1, $2::jsonb, 'Pending', CURRENT_TIMESTAMP)
     RETURNING id, employee_id, status, requested_at`,
    [employeeId, dataJson]
  )
}

export async function getPendingProfileChangeRequest(employeeId) {
  const rows = await executeQuery(
    `SELECT id, employee_id, requested_data, status, requested_at, reviewed_at, reviewed_by_employee_id
     FROM profile_change_requests WHERE employee_id = $1 AND status = $2`,
    [employeeId, 'Pending']
  )
  return rows[0] || null
}

export async function getAllPendingProfileChangeRequests() {
  return executeQuery(
    `SELECT pcr.id, pcr.employee_id, pcr.requested_data, pcr.status, pcr.requested_at,
        e.first_name, e.last_name, e.employee_code, e.email,
        e.phone, e.address, e.bio, e.position, e.join_date, e.profile_picture,
        e.date_of_birth, e.father_name, e.gender, e.marital_status, e.religion, e.grade,
        e.cnic_number, e.cnic_issue_date, e.cnic_expiry_date,
        e.emergency_contact_number, e.employee_extension, e.personal_cell_number,
        d.department_name
     FROM profile_change_requests pcr
     JOIN employees e ON e.employee_id = pcr.employee_id
     LEFT JOIN departments d ON d.department_id = e.department_id
     WHERE pcr.status = 'Pending'
     ORDER BY pcr.requested_at ASC`
  )
}

async function getDepartmentIdByName(departmentName) {
  if (!departmentName || typeof departmentName !== 'string') return null
  const rows = await executeQuery(
    'SELECT department_id FROM departments WHERE department_name = $1',
    [departmentName.trim()]
  )
  return rows.length > 0 ? rows[0].department_id : null
}

/** Apply requested_data to employees row and mark request Approved. Returns updated request row. */
export async function approveProfileChangeRequest(requestId, reviewedByEmployeeId) {
  const rows = await executeQuery(
    `SELECT id, employee_id, requested_data FROM profile_change_requests WHERE id = $1 AND status = 'Pending'`,
    [requestId]
  )
  if (rows.length === 0) return null
  const { employee_id: empId, requested_data: raw } = rows[0]
  const d = raw && typeof raw === 'object' ? raw : {}

  const name = d.name != null ? String(d.name).trim() : ''
  const departmentId = d.department != null ? await getDepartmentIdByName(d.department) : undefined

  const setClauses = []
  const params = []
  let idx = 1

  if (name) {
    const [first_name, last_name] = name.includes(' ')
      ? [name.split(' ').slice(0, -1).join(' '), name.split(' ').slice(-1).join(' ')]
      : [name, '']
    setClauses.push(`first_name = $${idx}`); params.push(first_name); idx++
    setClauses.push(`last_name = $${idx}`); params.push(last_name); idx++
  }
  if (d.email != null) { setClauses.push(`email = $${idx}`); params.push(String(d.email).trim()); idx++ }
  if (d.phone != null) { setClauses.push(`phone = $${idx}`); params.push(d.phone ? String(d.phone).trim() : null); idx++ }
  if (d.homeAddress != null) { setClauses.push(`address = $${idx}`); params.push(d.homeAddress ? String(d.homeAddress).trim() : null); idx++ }
  if (d.bio != null) { setClauses.push(`bio = $${idx}`); params.push(d.bio ? String(d.bio).trim() : null); idx++ }
  if (d.position != null) { setClauses.push(`position = $${idx}`); params.push(d.position ? String(d.position).trim() : null); idx++ }
  if (d.employeeCode != null) { setClauses.push(`employee_code = $${idx}`); params.push(d.employeeCode ? String(d.employeeCode).trim() : null); idx++ }
  if (departmentId !== undefined) { setClauses.push(`department_id = $${idx}`); params.push(departmentId); idx++ }
  if (d.joinDate != null) { setClauses.push(`join_date = $${idx}`); params.push(d.joinDate || null); idx++ }
  if (d.profileImage != null) { setClauses.push(`profile_picture = $${idx}`); params.push(typeof d.profileImage === 'string' ? d.profileImage : null); idx++ }

  if (d.dateOfBirth != null) { setClauses.push(`date_of_birth = $${idx}`); params.push(d.dateOfBirth || null); idx++ }
  if (d.fatherName != null) { setClauses.push(`father_name = $${idx}`); params.push(d.fatherName ? String(d.fatherName).trim() : null); idx++ }
  if (d.gender != null) { setClauses.push(`gender = $${idx}`); params.push(d.gender ? String(d.gender).trim() : null); idx++ }
  if (d.maritalStatus != null) { setClauses.push(`marital_status = $${idx}`); params.push(d.maritalStatus ? String(d.maritalStatus).trim() : null); idx++ }
  if (d.religion != null) { setClauses.push(`religion = $${idx}`); params.push(d.religion ? String(d.religion).trim() : null); idx++ }
  if (d.grade != null) { setClauses.push(`grade = $${idx}`); params.push(d.grade ? String(d.grade).trim() : null); idx++ }
  if (d.cnicNumber != null) { setClauses.push(`cnic_number = $${idx}`); params.push(d.cnicNumber ? String(d.cnicNumber).trim() : null); idx++ }
  if (d.cnicIssueDate != null) { setClauses.push(`cnic_issue_date = $${idx}`); params.push(d.cnicIssueDate || null); idx++ }
  if (d.cnicExpiryDate != null) { setClauses.push(`cnic_expiry_date = $${idx}`); params.push(d.cnicExpiryDate || null); idx++ }
  if (d.emergencyContactNumber != null) { setClauses.push(`emergency_contact_number = $${idx}`); params.push(d.emergencyContactNumber ? String(d.emergencyContactNumber).trim() : null); idx++ }
  if (d.employeeExtension != null) { setClauses.push(`employee_extension = $${idx}`); params.push(d.employeeExtension ? String(d.employeeExtension).trim() : null); idx++ }
  if (d.personalCellNumber != null) { setClauses.push(`personal_cell_number = $${idx}`); params.push(d.personalCellNumber ? String(d.personalCellNumber).trim() : null); idx++ }

  if (setClauses.length > 0) {
    setClauses.push('updated_at = CURRENT_TIMESTAMP')
    params.push(empId)
    await executeQuery(
      `UPDATE employees SET ${setClauses.join(', ')} WHERE employee_id = $${idx}`,
      params
    )
  }

  const updated = await executeQuery(
    `UPDATE profile_change_requests SET status = 'Approved', reviewed_at = CURRENT_TIMESTAMP, reviewed_by_employee_id = $1 WHERE id = $2 RETURNING id, employee_id, status, reviewed_at, reviewed_by_employee_id`,
    [reviewedByEmployeeId, requestId]
  )
  return updated[0] || null
}

export async function rejectProfileChangeRequest(requestId, reviewedByEmployeeId) {
  const result = await executeQuery(
    `UPDATE profile_change_requests SET status = 'Rejected', reviewed_at = CURRENT_TIMESTAMP, reviewed_by_employee_id = $1 WHERE id = $2 AND status = 'Pending' RETURNING id, employee_id, status, reviewed_at`,
    [reviewedByEmployeeId, requestId]
  )
  return result[0] || null
}

/** Get single request by id (for approve/reject). */
export async function getProfileChangeRequestById(requestId) {
  const rows = await executeQuery(
    'SELECT id, employee_id, requested_data, status, requested_at, reviewed_at, reviewed_by_employee_id FROM profile_change_requests WHERE id = $1',
    [requestId]
  )
  return rows[0] || null
}
