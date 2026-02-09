import * as profileRepo from '../repositories/profile.repository.js'

export async function getProfile(employeeId) {
  const result = await profileRepo.getProfile(employeeId)
  if (result.length === 0) return null
  const employee = result[0]
  // Prefer names from main query; fallback to separate calls if row has no designation/employee_type (minimal fallback used)
  let designationName = employee.designation_name ?? null
  let employeeTypeName = employee.employee_type_name ?? null
  if (designationName == null || employeeTypeName == null) {
    const [et, desg] = await Promise.all([
      profileRepo.getEmployeeTypeName(employeeId),
      profileRepo.getDesignationName(employeeId)
    ])
    if (designationName == null) designationName = desg
    if (employeeTypeName == null) employeeTypeName = et
  }
  const locationFromStation = (employee.station_name && employee.city_name)
    ? `${employee.station_name}, ${employee.city_name}`
    : (employee.station_name || employee.city_name || null)
  return {
    name: [employee.first_name, employee.last_name].filter(Boolean).join(' ') || 'Unknown',
    email: employee.email ?? null,
    phone: employee.phone ?? null,
    department: employee.department_name ?? null,
    position: employee.position ?? null,
    employeeId: employee.employee_code ?? String(employee.employee_id),
    joinDate: employee.join_date ?? null,
    location: locationFromStation || employee.address || 'Not specified',
    stationId: employee.station_id ?? null,
    stationName: employee.station_name ?? null,
    cityName: employee.city_name ?? null,
    cityId: employee.city_id ?? null,
    bio: employee.bio ?? 'No bio available',
    employeeTypeName: employeeTypeName ?? null,
    designationName: designationName ?? null
  }
}

export async function updateProfile(employeeId, data) {
  await profileRepo.updateProfile(employeeId, data)
  return { message: 'Profile updated successfully' }
}
