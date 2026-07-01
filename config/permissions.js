/**
 * SINGLE SOURCE OF TRUTH for all permission keys.
 *
 * Add a new permission key HERE only — auth (login permission set + SuperAdmin grant),
 * role-permissions (Role Permissions page) and administration (per-employee Access Permissions +
 * role defaults) all import this list. Previously each of those kept its own copy, and a key added
 * to some-but-not-all silently failed to save. Keep this the one place.
 */
export const PERMISSION_KEYS = [
  'dashboard', 'profile', 'profile_update_requests', 'salary_slip', 'view_salary_slips',
  'leave', 'leave_pending', 'feedback', 'feedback_history', 'feedback_records_hr',
  'requisition_create', 'requisition_can_add_items', 'requisition_history', 'requisition_acknowledgment',
  'requisition_pending', 'requisition_approved', 'requisition_reports', 'requisition_email_diagnostics',
  'tat_report', 'help_support', 'extensions', 'administration',
  'payroll', 'payroll_gross_salaries', 'payroll_other_allowances', 'payroll_deductions', 'payroll_incentives',
  'my_trainings', 'manage_trainings'
]
