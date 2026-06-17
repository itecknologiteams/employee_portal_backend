import * as profileRepo from '../repositories/profile.repository.js'
import * as reqRepo from '../repositories/requisition.repository.js'
import * as notifRepo from '../repositories/notification.repository.js'
import * as notifSvc from './notification.service.js'
import { EMAIL_FROM, getEmailTransport, isEmailConfigured } from '../../config/email.js'
import { getOfficialEmailFromCrm, getCrmEmailMapByEmployeeCodes } from '../../config/crmDatabase.js'

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
  const employeeCode = employee.employee_code ?? String(employee.employee_id ?? '')
  const officialEmail = await getOfficialEmailFromCrm(employeeCode)
  return {
    name: [employee.first_name, employee.last_name].filter(Boolean).join(' ') || 'Unknown',
    email: employee.email ?? null,
    officialEmail: officialEmail ?? null,
    phone: employee.phone ?? null,
    department: employee.department_name ?? null,
    position: employee.position ?? null,
    employeeId: employeeCode || String(employee.employee_id),
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
    personalCellNumber: employee.personal_cell_number ?? null
  }
}

const PROFILE_HR_EMAIL = process.env.PROFILE_HR_EMAIL || process.env.LEAVE_EMAIL_ANNUAL || 'hr@itecknologi.com'

/** Submit profile update request (HR bucket). No direct DB update; HR must approve. */
export async function updateProfile(employeeId, data) {
  const result = await profileRepo.createOrUpdateProfileChangeRequest(employeeId, data)
  const requestId = (Array.isArray(result) && result[0]) ? result[0].id : (result && result.id)

  if (isEmailConfigured()) {
    const transport = getEmailTransport()
    if (transport) {
      try {
        const to = PROFILE_HR_EMAIL
        const subject = `New profile change request – pending HR approval (Employee ID: ${employeeId})`
        const baseUrl = process.env.BASE_URL || 'http://localhost:5173'
        const body = [
          'A profile update request has been submitted and is in your HR bucket.',
          '',
          `Employee ID: ${employeeId}`,
          requestId != null ? `Request ID: ${requestId}` : '',
          '',
          `View pending requests: ${baseUrl}`
        ].filter(Boolean).join('\n')
        console.log('📧 [Profile] HR notify: Sending to:', to, '| Subject:', subject)
        await transport.sendMail({ from: EMAIL_FROM, to, subject, text: body })
        console.log('📧 [Profile] HR notify SENT OK →', to)
      } catch (err) {
        console.error('📧 [Profile] HR notify FAILED:', err.message)
      }
    }
  }

  return { message: 'Profile update request submitted for HR approval' }
}

export async function getMyPendingRequest(employeeId) {
  return profileRepo.getPendingProfileChangeRequest(employeeId)
}

/** Build a `current_data` object keyed exactly like `requested_data`, from an employee row.
 *  Lets the UI diff requested-vs-current and show what the employee actually changed. */
function buildCurrentProfileData(row) {
  const fullName = [row.first_name, row.last_name].filter(Boolean).join(' ').trim()
  const ymd = (d) => (d ? String(new Date(d).toISOString()).slice(0, 10) : null)
  return {
    name: fullName || null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    personalCellNumber: row.personal_cell_number ?? null,
    emergencyContactNumber: row.emergency_contact_number ?? null,
    department: row.department_name ?? null,
    position: row.position ?? null,
    employeeCode: row.employee_code ?? null,
    grade: row.grade ?? null,
    joinDate: ymd(row.join_date),
    fatherName: row.father_name ?? null,
    dateOfBirth: ymd(row.date_of_birth),
    gender: row.gender ?? null,
    maritalStatus: row.marital_status ?? null,
    religion: row.religion ?? null,
    cnicNumber: row.cnic_number ?? null,
    cnicIssueDate: ymd(row.cnic_issue_date),
    cnicExpiryDate: ymd(row.cnic_expiry_date),
    homeAddress: row.address ?? null,
    employeeExtension: row.employee_extension ?? null,
    profileImage: row.profile_picture ?? null
  }
}

/** HR only: list all pending profile change requests, with each requester's current values
 *  (for diffing) and official CRM email. */
export async function getHrPendingProfileRequests(hrEmployeeId) {
  const isHr = await reqRepo.isHrMember(hrEmployeeId)
  if (!isHr) return { error: 'Only HR can view pending profile change requests', status: 403 }
  const rows = await profileRepo.getAllPendingProfileChangeRequests()

  // Official email comes from CRM (ERP_Tracking.dbo.USERS), keyed by employee_code. Best-effort:
  // an empty map (CRM unreachable / no record) falls back to the stored email in the UI.
  const codes = [...new Set(rows.map(r => r.employee_code).filter(Boolean))]
  const crmEmailMap = codes.length ? await getCrmEmailMapByEmployeeCodes(codes).catch(() => new Map()) : new Map()

  const list = rows.map(r => {
    const officialEmail = (r.employee_code && crmEmailMap.get(String(r.employee_code).trim())) || null
    return {
      id: r.id,
      employee_id: r.employee_id,
      first_name: r.first_name,
      last_name: r.last_name,
      employee_code: r.employee_code,
      email: r.email,
      officialEmail,
      status: r.status,
      requested_at: r.requested_at,
      requested_data: r.requested_data,
      current_data: buildCurrentProfileData(r)
    }
  })
  return { list }
}

/** HR only: approve request and apply to employees. */
export async function hrApproveProfileRequest(requestId, hrEmployeeId) {
  const isHr = await reqRepo.isHrMember(hrEmployeeId)
  if (!isHr) return { error: 'Only HR can approve profile change requests', status: 403 }
  const result = await profileRepo.approveProfileChangeRequest(requestId, hrEmployeeId)
  if (!result) return { error: 'Request not found or already processed', status: 404 }
  if (result.employee_id) {
    notifSvc.notifySafe(notifSvc.notify({
      recipientEmployeeId: result.employee_id,
      type: 'profile_change_approved',
      title: 'Profile change approved',
      body: 'Your profile update request was approved and applied.',
      url: '/profile',
      relatedEntityType: 'profile',
      relatedEntityId: requestId
    }))
  }
  return { message: 'Profile change approved and applied', request: result }
}

/** HR only: reject request. */
export async function hrRejectProfileRequest(requestId, hrEmployeeId) {
  const isHr = await reqRepo.isHrMember(hrEmployeeId)
  if (!isHr) return { error: 'Only HR can reject profile change requests', status: 403 }
  const result = await profileRepo.rejectProfileChangeRequest(requestId, hrEmployeeId)
  if (!result) return { error: 'Request not found or already processed', status: 404 }
  if (result.employee_id) {
    notifSvc.notifySafe(notifSvc.notify({
      recipientEmployeeId: result.employee_id,
      type: 'profile_change_rejected',
      title: 'Profile change rejected',
      body: 'Your profile update request was rejected.',
      url: '/profile',
      relatedEntityType: 'profile',
      relatedEntityId: requestId
    }))
  }
  return { message: 'Profile change rejected', request: result }
}
