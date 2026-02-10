import * as feedbackRepo from '../repositories/feedback.repository.js'
import { EMAIL_FROM, getEmailTransport, isEmailConfigured } from '../../config/email.js'

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function parseEmployeeId(employeeId) {
  if (employeeId == null || employeeId === '') return null
  const n = parseInt(employeeId, 10)
  return Number.isNaN(n) ? null : n
}

function parseCategoryEmailMap(raw) {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      const normalized = {}
      for (const [key, value] of Object.entries(parsed)) {
        if (!key || !value) continue
        normalized[String(key).trim().toLowerCase()] = String(value).trim()
      }
      return Object.keys(normalized).length ? normalized : null
    }
  } catch {
    // fall back to simple "key:email,key2:email2" parsing
  }
  const entries = raw.split(',').map(v => v.trim()).filter(Boolean)
  if (!entries.length) return null
  const mapped = {}
  for (const entry of entries) {
    const separator = entry.includes('=') ? '=' : ':'
    const [key, value] = entry.split(separator)
    if (!key || !value) continue
    mapped[key.trim().toLowerCase()] = value.trim()
  }
  return Object.keys(mapped).length ? mapped : null
}

function getDepartmentEmail(category) {
  const fallback = process.env.FEEDBACK_DEFAULT_EMAIL
    || process.env.FEEDBACK_TO_EMAIL
    || process.env.EMAIL_FROM
    || process.env.MAIL_FROM
    || process.env.SMTP_USER
    || null
  const map = parseCategoryEmailMap(process.env.FEEDBACK_CATEGORY_EMAILS)
  const key = (category || '').trim().toLowerCase()
  if (map && key && map[key]) return map[key]
  return fallback
}

export async function getFeedbackHistory(employeeId) {
  const eid = parseEmployeeId(employeeId)
  if (eid == null) return { error: 'employee_id must be a number', status: 400 }
  return feedbackRepo.getFeedbackHistory(eid)
}

export async function submitFeedback(data) {
  const { employeeId, employee_id, subject, category, message, rating } = data
  const validationErrors = []
  const eid = parseEmployeeId(employee_id ?? employeeId)

  if (eid == null) {
    validationErrors.push('employee_id is required and must be a number')
  }
  if (!isNonEmptyString(subject)) validationErrors.push('subject is required')
  if (!isNonEmptyString(category)) validationErrors.push('category is required')
  if (!isNonEmptyString(message)) validationErrors.push('message is required')

  let parsedRating = null
  if (rating !== undefined && rating !== null && rating !== '') {
    const ratingNumber = Number(rating)
    if (!Number.isInteger(ratingNumber)) {
      validationErrors.push('rating must be an integer when provided')
    } else {
      parsedRating = ratingNumber
    }
  }

  if (validationErrors.length > 0) {
    return { error: 'Validation failed', details: validationErrors, status: 400 }
  }

  const employeeRows = await feedbackRepo.getEmployeeById(eid)
  if (!employeeRows.length) {
    return { error: 'Employee not found', status: 404 }
  }

  const insertResult = await feedbackRepo.submitFeedback(
    eid,
    subject.trim(),
    category.trim(),
    message.trim(),
    parsedRating
  )
  const record = insertResult[0] || {}

  let emailSent = false
  if (isEmailConfigured()) {
    const transport = getEmailTransport()
    if (!transport) {
      console.warn('Email not configured (SMTP_*). Skipping send.')
    } else {
      try {
        const departmentEmail = getDepartmentEmail(category)
        const employeeEmail = employeeRows[0]?.email || null
        const emailSubject = `New Feedback: ${subject.trim()}`
        const emailBody = [
          `Employee ID: ${eid}`,
          `Category: ${category.trim()}`,
          `Rating: ${parsedRating ?? 'N/A'}`,
          '',
          'Message:',
          message.trim()
        ].join('\n')

        if (departmentEmail) {
          await transport.sendMail({
            from: EMAIL_FROM,
            to: "makhshafzaidi@gmail.com",
            subject: emailSubject,
            text: emailBody,
            replyTo: employeeEmail || undefined
          })
          console.log('✅ Feedback email sent:', { to: departmentEmail, subject: emailSubject })
          emailSent = true
        } else {
          console.warn('Feedback email recipient not configured. Skipping send.')
        }
      } catch (emailError) {
        console.error('Feedback email error:', emailError.message)
      }
    }
  } else {
    console.warn('Email not configured (SMTP_*). Skipping send.')
  }

  return {
    message: 'Feedback submitted successfully',
    id: record.id,
    created_at: record.created_at,
    emailSent,
    feedbackId: record.id
  }
}
