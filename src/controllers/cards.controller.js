import * as cardsRepo from '../repositories/cards.repository.js'
import { fileToDataUrl } from '../utils/file.utils.js'

/** GET /api/cards/technicians – list technicians for card grid (public, no auth). */
export async function listTechnicians(req, res) {
  try {
    const rows = await cardsRepo.getTechnicians()
    const list = (rows || []).map((r) => ({
      employeeId: r.employee_id,
      employeeCode: r.employee_code || String(r.employee_id),
      firstName: r.first_name,
      lastName: r.last_name,
      name: [r.first_name, r.last_name].filter(Boolean).join(' ') || '—',
      phone: r.phone || null,
      emergencyPhone: r.emergency_phone || null,
      email: r.email || null,
      website: r.website || null,
      address: r.address || null,
      profilePicture: r.profile_picture || null,
      departmentName: r.department_name || null,
      designationName: r.designation_name || r.employee_type_name || null
    }))
    res.json({ technicians: list })
  } catch (err) {
    console.error('Cards listTechnicians:', err.message)
    res.status(500).json({ error: 'Failed to load technicians' })
  }
}

/** GET /api/cards/:employeeCode – single technician card (for QR scan; public). Resolves by employee_code or id. */
export async function getTechnicianCard(req, res) {
  try {
    const { employeeCode } = req.params
    const row = await cardsRepo.getTechnicianByIdOrCode(employeeCode)
    if (!row) {
      return res.status(404).json({ error: 'Technician not found' })
    }
    res.json({
      employeeId: row.employee_id,
      employeeCode: row.employee_code || String(row.employee_id),
      firstName: row.first_name,
      lastName: row.last_name,
      name: [row.first_name, row.last_name].filter(Boolean).join(' ') || '—',
      phone: row.phone || null,
      emergencyPhone: row.emergency_phone || null,
      email: row.email || null,
      website: row.website || null,
      address: row.address || null,
      profilePicture: row.profile_picture || null,
      departmentName: row.department_name || null,
      designationName: row.designation_name || row.employee_type_name || null
    })
  } catch (err) {
    console.error('Cards getTechnicianCard:', err.message)
    res.status(500).json({ error: 'Failed to load card' })
  }
}

function mapRowToCard(row) {
  if (!row) return null
  return {
    employeeId: row.employee_id,
    employeeCode: row.employee_code || String(row.employee_id),
    firstName: row.first_name,
    lastName: row.last_name,
    name: [row.first_name, row.last_name].filter(Boolean).join(' ') || '—',
    phone: row.phone || null,
    emergencyPhone: row.emergency_phone || null,
    email: row.email || null,
    website: row.website || null,
    address: row.address || null,
    profilePicture: row.profile_picture || null,
    departmentName: row.department_name || null,
    designationName: row.designation_name || row.employee_type_name || null
  }
}

/** POST /api/cards – create employee (body: employee_code, name, phone, ...). */
export async function createEmployee(req, res) {
  try {
    const row = await cardsRepo.createEmployee(req.body || {})
    if (!row) return res.status(500).json({ error: 'Create failed' })
    res.status(201).json(mapRowToCard(row))
  } catch (err) {
    console.error('Cards createEmployee:', err.message)
    res.status(500).json({ error: err.message || 'Failed to create employee' })
  }
}

/** PUT /api/cards/:employeeCode – update employee. */
export async function updateEmployee(req, res) {
  try {
    const { employeeCode } = req.params
    const row = await cardsRepo.updateEmployee(employeeCode, req.body || {})
    if (!row) return res.status(404).json({ error: 'Employee not found' })
    res.json(mapRowToCard(row))
  } catch (err) {
    console.error('Cards updateEmployee:', err.message)
    res.status(500).json({ error: err.message || 'Failed to update employee' })
  }
}

/** POST /api/cards/upload-profile – upload profile image; returns base64 data URL to save in DB (no URL dependency). */
export async function uploadProfileImage(req, res) {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'No file uploaded. Use form field "profileImage".' })
    }
    const profileImageData = fileToDataUrl(req.file)
    if (!profileImageData) {
      return res.status(400).json({ error: 'Could not read image data' })
    }
    res.status(200).json({ profileImageData })
  } catch (err) {
    console.error('Cards uploadProfileImage:', err.message)
    res.status(500).json({ error: err.message || 'Upload failed' })
  }
}
