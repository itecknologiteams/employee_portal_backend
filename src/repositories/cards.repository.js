import { executeQueryCards } from '../../config/cardsDatabase.js'

/**
 * employee_cards.employees columns:
 * id, employee_code, name, phone, emergency_phone, department, designation,
 * website, address, email, profile_image, qr_code, created_at
 */

const LIST_QUERY = `
  SELECT 
    e.id AS employee_id,
    e.employee_code,
    e.name AS first_name,
    '' AS last_name,
    e.phone,
    e.emergency_phone,
    e.email,
    e.department AS department_name,
    e.designation AS designation_name,
    e.website,
    e.address,
    e.profile_image AS profile_picture
  FROM employees e
  ORDER BY e.name
`

const BY_ID_QUERY = `
  SELECT 
    e.id AS employee_id,
    e.employee_code,
    e.name AS first_name,
    '' AS last_name,
    e.phone,
    e.emergency_phone,
    e.email,
    e.department AS department_name,
    e.designation AS designation_name,
    e.website,
    e.address,
    e.profile_image AS profile_picture
  FROM employees e
  WHERE e.id = $1
  LIMIT 1
`

const BY_CODE_QUERY = `
  SELECT 
    e.id AS employee_id,
    e.employee_code,
    e.name AS first_name,
    '' AS last_name,
    e.phone,
    e.emergency_phone,
    e.email,
    e.department AS department_name,
    e.designation AS designation_name,
    e.website,
    e.address,
    e.profile_image AS profile_picture
  FROM employees e
  WHERE e.employee_code = $1
  LIMIT 1
`

/** Resolve by employee_code first (QR URL), then by numeric id. */
export async function getTechnicianByIdOrCode(idOrCode) {
  if (!idOrCode || String(idOrCode).trim() === '') return null
  const str = String(idOrCode).trim()
  try {
    const byCode = await executeQueryCards(BY_CODE_QUERY, [str])
    if (byCode.length) return byCode[0]
    const num = parseInt(str, 10)
    if (!Number.isNaN(num)) {
      const byId = await executeQueryCards(BY_ID_QUERY, [num])
      if (byId.length) return byId[0]
    }
    return null
  } catch (err) {
    console.error('Cards DB getTechnicianByIdOrCode:', err.message)
    throw err
  }
}

export async function getTechnicians() {
  try {
    return await executeQueryCards(LIST_QUERY)
  } catch (err) {
    console.error('Cards DB getTechnicians:', err.message)
    throw err
  }
}

export async function getTechnicianById(employeeId) {
  const id = parseInt(employeeId, 10)
  if (Number.isNaN(id)) return null
  try {
    const rows = await executeQueryCards(BY_ID_QUERY, [id])
    return rows.length ? rows[0] : null
  } catch (err) {
    console.error('Cards DB getTechnicianById:', err.message)
    throw err
  }
}

export async function createEmployee(data) {
  const {
    employee_code, name, phone, emergency_phone, department, designation,
    website, address, email, profile_image
  } = data
  const rows = await executeQueryCards(
    `INSERT INTO employees (employee_code, name, phone, emergency_phone, department, designation, website, address, email, profile_image)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id AS employee_id, employee_code, name, phone, emergency_phone, department, designation, website, address, email, profile_image AS profile_picture`,
    [
      employee_code || null, name || null, phone || null, emergency_phone || null,
      department || null, designation || null, website || null, address || null,
      email || null, profile_image || null
    ]
  )
  return rows[0] || null
}

export async function updateEmployee(id, data) {
  const numId = parseInt(id, 10)
  if (Number.isNaN(numId)) return null
  const {
    employee_code, name, phone, emergency_phone, department, designation,
    website, address, email, profile_image
  } = data
  const rows = await executeQueryCards(
    `UPDATE employees SET
       employee_code = COALESCE($2, employee_code),
       name = COALESCE($3, name),
       phone = COALESCE($4, phone),
       emergency_phone = COALESCE($5, emergency_phone),
       department = COALESCE($6, department),
       designation = COALESCE($7, designation),
       website = COALESCE($8, website),
       address = COALESCE($9, address),
       email = COALESCE($10, email),
       profile_image = COALESCE($11, profile_image)
     WHERE id = $1
     RETURNING id AS employee_id, employee_code, name, phone, emergency_phone, department, designation, website, address, email, profile_image AS profile_picture`,
    [
      numId, employee_code ?? null, name ?? null, phone ?? null, emergency_phone ?? null,
      department ?? null, designation ?? null, website ?? null, address ?? null,
      email ?? null, profile_image ?? null
    ]
  )
  return rows[0] || null
}
