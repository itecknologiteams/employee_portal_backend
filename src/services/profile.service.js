import * as profileRepo from '../repositories/profile.repository.js'

export async function getProfile(employeeId) {
  const result = await profileRepo.getProfile(employeeId)
  if (result.length === 0) return null
  const employee = result[0]
  const locationFromStation = (employee.station_name && employee.city_name)
    ? `${employee.station_name}, ${employee.city_name}`
    : (employee.station_name || employee.city_name || null)
  const employeeTypeName = await profileRepo.getEmployeeTypeName(employeeId)
  const designationName = await profileRepo.getDesignationName(employeeId)
  return {
    name: `${employee.first_name} ${employee.last_name}`,
    email: employee.email,
    phone: employee.phone,
    department: employee.department_name || employee.department_id,
    position: employee.position,
    employeeId: employee.employee_code || employee.employee_id,
    joinDate: employee.join_date,
    location: locationFromStation || employee.address || 'Not specified',
    stationId: employee.station_id || null,
    stationName: employee.station_name || null,
    cityName: employee.city_name || null,
    bio: employee.bio || 'No bio available',
    employeeTypeName: employeeTypeName || null,
    designationName: designationName || null
  }
}

export async function updateProfile(employeeId, data) {
  await profileRepo.updateProfile(employeeId, data)
  return { message: 'Profile updated successfully' }
}
