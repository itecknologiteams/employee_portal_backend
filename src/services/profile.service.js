import * as profileRepo from '../repositories/profile.repository.js'
import * as reqRepo from '../repositories/requisition.repository.js'

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
    designationName: designationName ?? null,
    // Extended profile fields (after migration) + profile image
    profileImage: employee.profile_picture ?? null,
    homeAddress: employee.address ?? null,
    dateOfBirth: employee.date_of_birth ?? null,
    fatherName: employee.father_name ?? null,
    gender: employee.gender ?? null,
    maritalStatus: employee.marital_status ?? null,
    religion: employee.religion ?? null,
    grade: employee.grade ?? null,
    cnicNumber: employee.cnic_number ?? null,
    cnicIssueDate: employee.cnic_issue_date ?? null,
    cnicExpiryDate: employee.cnic_expiry_date ?? null,
    emergencyContactNumber: employee.emergency_contact_number ?? null,
    employeeExtension: employee.employee_extension ?? null,
    personalCellNumber: employee.personal_cell_number ?? null,
    region: employee.region ?? null
  }
}

/** Submit profile update request (HR bucket). No direct DB update; HR must approve. */
export async function updateProfile(employeeId, data) {
  await profileRepo.createOrUpdateProfileChangeRequest(employeeId, data)
  return { message: 'Profile update request submitted for HR approval' }
}

export async function getMyPendingRequest(employeeId) {
  return profileRepo.getPendingProfileChangeRequest(employeeId)
}

/** HR only: list all pending profile change requests. */
export async function getHrPendingProfileRequests(hrEmployeeId) {
  const isHr = await reqRepo.isHrMember(hrEmployeeId)
  if (!isHr) return { error: 'Only HR can view pending profile change requests', status: 403 }
  const list = await profileRepo.getAllPendingProfileChangeRequests()
  return { list }
}

/** HR only: approve request and apply to employees. */
export async function hrApproveProfileRequest(requestId, hrEmployeeId) {
  const isHr = await reqRepo.isHrMember(hrEmployeeId)
  if (!isHr) return { error: 'Only HR can approve profile change requests', status: 403 }
  const result = await profileRepo.approveProfileChangeRequest(requestId, hrEmployeeId)
  if (!result) return { error: 'Request not found or already processed', status: 404 }
  return { message: 'Profile change approved and applied', request: result }
}

/** HR only: reject request. */
export async function hrRejectProfileRequest(requestId, hrEmployeeId) {
  const isHr = await reqRepo.isHrMember(hrEmployeeId)
  if (!isHr) return { error: 'Only HR can reject profile change requests', status: 403 }
  const result = await profileRepo.rejectProfileChangeRequest(requestId, hrEmployeeId)
  if (!result) return { error: 'Request not found or already processed', status: 404 }
  return { message: 'Profile change rejected', request: result }
}
