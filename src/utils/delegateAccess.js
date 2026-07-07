import crypto from 'crypto'
import { PERMISSION_KEYS } from '../../config/permissions.js'

const EXCLUDED_PAGES = new Set(['role_permissions', 'manage_delegate_access', 'administration'])
export const SELECTABLE_PAGE_KEYS = PERMISSION_KEYS.filter((k) => !EXCLUDED_PAGES.has(k))
export const MIN_EXPIRY_DAYS = 10

const PAGE_PATHS = {
  dashboard: '/dashboard', profile: '/profile', profile_update_requests: '/profile/update-requests',
  salary_slip: '/salary-slip', view_salary_slips: '/view-salary-slips', leave: '/leave-request',
  leave_pending: '/leave-request/pending', feedback: '/feedback', feedback_history: '/feedback/history',
  feedback_records_hr: '/feedback/records', requisition_create: '/requisition', requisition_history: '/requisition/history',
  requisition_acknowledgment: '/requisition/acknowledgment', requisition_pending: '/requisition/pending',
  requisition_approved: '/requisition/approved', requisition_reports: '/requisition/reports',
  requisition_email_diagnostics: '/requisition/email-diagnostics', tat_report: '/tat-report',
  extensions: '/extensions', payroll: '/payroll', payroll_gross_salaries: '/payroll/gross-salaries',
  payroll_other_allowances: '/payroll/other-allowances', payroll_deductions: '/payroll/deductions',
  payroll_incentives: '/payroll/incentives', my_trainings: '/my-trainings', manage_trainings: '/manage-trainings'
}

export function hashToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken)).digest('hex')
}

export function computeStatus(row) {
  if (row.revoked_at) return 'revoked'
  if (new Date(row.expires_at).getTime() <= Date.now()) return 'expired'
  return 'active'
}

export function maskEmail(email) {
  const [local, domain] = String(email || '').split('@')
  if (!domain) return email || ''
  const visible = local.slice(0, Math.min(3, local.length))
  return `${visible}${'*'.repeat(Math.max(0, local.length - visible.length))}@${domain}`
}

export function pageToPath(key) { return PAGE_PATHS[key] || '/profile' }

export function validateCreateInput({ employeeId, pages, expiryDays, landingPage }) {
  const eid = parseInt(employeeId, 10)
  if (Number.isNaN(eid)) return { ok: false, error: 'Valid employeeId required' }
  const cleanPages = Array.isArray(pages) ? pages.filter((p) => SELECTABLE_PAGE_KEYS.includes(p)) : []
  if (cleanPages.length === 0) return { ok: false, error: 'Select at least one valid page' }
  const days = parseInt(expiryDays, 10)
  if (Number.isNaN(days) || days < MIN_EXPIRY_DAYS) return { ok: false, error: `Expiry must be at least ${MIN_EXPIRY_DAYS} days` }
  const landing = landingPage || pageToPath(cleanPages[0])
  if (!cleanPages.some((p) => pageToPath(p) === landing)) return { ok: false, error: 'Landing page must be one of the selected pages' }
  return { ok: true, cleanPages, landing, days, employeeId: eid }
}

const ACTION_PREFIXES = ['/api/requisition', '/api/leave']
export function isDelegateActionRequest(method, path) {
  if (!['POST', 'PUT', 'PATCH'].includes(method)) return false
  return ACTION_PREFIXES.some((p) => String(path).startsWith(p))
}

export function buildSessionUser(link) {
  const pages = Array.isArray(link.pages) ? link.pages : JSON.parse(link.pages || '[]')
  return {
    employeeId: link.employee_id,
    employeeCode: link.employee_code || '',
    name: [link.first_name, link.last_name].filter(Boolean).join(' ').trim() || 'Employee',
    email: link.email || '',
    userType: 'DelegateAccess',
    permissions: pages,
    delegate: { linkId: link.id, expiresAt: link.expires_at, landingPage: link.landing_page }
  }
}
