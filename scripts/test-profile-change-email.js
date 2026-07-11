/**
 * One-off: render the HR "New Profile Change Request" email with sample data
 * and send it to a test recipient. Run: node scripts/test-profile-change-email.js
 */
import dotenv from 'dotenv'
dotenv.config()

// Import AFTER dotenv.config() — config/email.js reads process.env at module load time.
const { EMAIL_FROM, getEmailTransport, isEmailConfigured } = await import('../config/email.js')
const { renderPortalEmail } = await import('../src/utils/leaveEmailTemplate.js')

const TO = process.argv[2] || 'ali.asif@itecknologi.com'

// Sample requester + the changes they submitted (mirrors requested_data shape).
const employeeName = 'Ali Asif'
const employeeCode = 'ITK-0355'
const requestedData = {
  phone: '+92 300 1234567',
  personalCellNumber: '+92 321 7654321',
  emergencyContactNumber: '+92 333 9998887',
  homeAddress: 'House 12, Street 4, Gulshan-e-Iqbal, Karachi',
  maritalStatus: 'Married'
}

const PROFILE_FIELD_LABELS = {
  name: 'Name', email: 'Email', phone: 'Phone',
  personalCellNumber: 'Personal Cell Number', emergencyContactNumber: 'Emergency Contact Number',
  department: 'Department', position: 'Position', employeeCode: 'Employee Code', grade: 'Grade',
  joinDate: 'Join Date', fatherName: "Father's Name", dateOfBirth: 'Date of Birth', gender: 'Gender',
  maritalStatus: 'Marital Status', religion: 'Religion', cnicNumber: 'CNIC Number',
  cnicIssueDate: 'CNIC Issue Date', cnicExpiryDate: 'CNIC Expiry Date', homeAddress: 'Home Address',
  employeeExtension: 'Employee Extension', profileImage: 'Profile Photo'
}
function formatRequestedChanges(data) {
  if (!data || typeof data !== 'object') return null
  const parts = []
  for (const [key, value] of Object.entries(data)) {
    if (value == null || value === '') continue
    const label = PROFILE_FIELD_LABELS[key] || key
    const shown = key === 'profileImage' ? '(new photo uploaded)' : String(value)
    parts.push(`${label}: ${shown}`)
  }
  return parts.length ? parts.join(' • ') : null
}

async function main() {
  if (!isEmailConfigured()) {
    console.error('❌ SMTP not configured (SMTP_HOST/SMTP_USER/SMTP_PASSWORD). Aborting.')
    process.exit(1)
  }
  const transport = getEmailTransport()
  const baseUrl = process.env.PORTAL_URL || process.env.BASE_URL || 'https://emp.itecknologi.com'
  const { html, text } = renderPortalEmail({
    title: 'New Profile Change Request',
    accent: 'amber',
    greeting: 'Dear HR,',
    introLines: ['A profile update request has been submitted and is now in your HR bucket for review.'],
    details: [
      { label: 'Employee Name', value: employeeName },
      { label: 'Employee Code', value: employeeCode },
      { label: 'Requested Changes', value: formatRequestedChanges(requestedData) },
      { label: 'View pending requests', value: baseUrl }
    ],
    footerNote: 'This is an automated message from the Employee Portal. Please do not reply.'
  })
  const subject = `[TEST] New profile change request – pending HR approval (${employeeName})`
  console.log('📧 Sending test email to:', TO, '| From:', EMAIL_FROM)
  const info = await transport.sendMail({ from: EMAIL_FROM, to: TO, subject, html, text })
  console.log('✅ SENT. messageId:', info.messageId, '| accepted:', info.accepted)
  process.exit(0)
}

main().catch((err) => {
  console.error('❌ FAILED:', err.message)
  process.exit(1)
})
