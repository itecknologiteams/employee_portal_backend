import { executeQuery } from '../../config/database.js'

// ---------- Periods ----------

export async function createPeriod({ name, startDate, endDate, workingDays, createdBy }) {
  const rows = await executeQuery(
    `INSERT INTO auto_payroll_period (name, start_date, end_date, working_days, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, start_date, end_date, working_days, status, created_at`,
    [name, startDate, endDate, workingDays, createdBy ?? null]
  )
  return rows[0]
}

export async function listPeriods({ status, limit = 50, offset = 0 } = {}) {
  const where = status ? 'WHERE p.status = $1' : ''
  const params = status ? [status, limit, offset] : [limit, offset]
  const limitParamIdx = status ? '$2' : '$1'
  const offsetParamIdx = status ? '$3' : '$2'
  return executeQuery(
    `SELECT p.id, p.name, p.start_date, p.end_date, p.working_days, p.status,
            p.created_at, p.processed_at, p.published_at, p.closed_at,
            (SELECT COUNT(*)::int FROM auto_payroll_slip s WHERE s.period_id = p.id) AS slip_count
       FROM auto_payroll_period p ${where}
      ORDER BY p.start_date DESC, p.id DESC
      LIMIT ${limitParamIdx} OFFSET ${offsetParamIdx}`,
    params
  )
}

export async function getPeriodById(id) {
  const rows = await executeQuery(
    `SELECT id, name, start_date, end_date, working_days, status,
            created_at, created_by, processed_at, published_at, closed_at
       FROM auto_payroll_period
      WHERE id = $1`,
    [id]
  )
  return rows[0] || null
}

export async function updatePeriodStatus(id, status, extra = {}) {
  const setStamps = []
  if (status === 'processing') setStamps.push('processed_at = NULL')
  if (status === 'processed') setStamps.push('processed_at = CURRENT_TIMESTAMP')
  if (status === 'published') setStamps.push('published_at = CURRENT_TIMESTAMP')
  if (status === 'closed') setStamps.push('closed_at = CURRENT_TIMESTAMP')
  const stampsSql = setStamps.length ? ', ' + setStamps.join(', ') : ''
  await executeQuery(
    `UPDATE auto_payroll_period SET status = $1 ${stampsSql} WHERE id = $2`,
    [status, id]
  )
}

export async function deletePeriod(id) {
  await executeQuery(`DELETE FROM auto_payroll_period WHERE id = $1`, [id])
}

// ---------- Entries (variable allowances + deductions per period) ----------

export async function upsertEntry({ periodId, employeeId, entryType, entrySubtype, amount, source = 'manual', notes = null, createdBy = null }) {
  const rows = await executeQuery(
    `INSERT INTO payroll_entry (period_id, employee_id, entry_type, entry_subtype, amount, source, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (period_id, employee_id, entry_subtype) DO UPDATE
       SET amount = EXCLUDED.amount,
           entry_type = EXCLUDED.entry_type,
           source = EXCLUDED.source,
           notes = EXCLUDED.notes
     RETURNING id, period_id, employee_id, entry_type, entry_subtype, amount, source, notes`,
    [periodId, employeeId, entryType, entrySubtype, amount, source, notes, createdBy]
  )
  return rows[0]
}

export async function listEntriesByPeriod(periodId) {
  return executeQuery(
    `SELECT e.id, e.period_id, e.employee_id, e.entry_type, e.entry_subtype,
            e.amount, e.source, e.notes, e.created_at,
            emp.first_name, emp.last_name, emp.employee_code
       FROM payroll_entry e
       JOIN employees emp ON emp.employee_id = e.employee_id
      WHERE e.period_id = $1
      ORDER BY e.entry_type, e.entry_subtype, emp.first_name`,
    [periodId]
  )
}

export async function listEntriesByEmployeeAndPeriod(periodId, employeeId) {
  return executeQuery(
    `SELECT id, entry_type, entry_subtype, amount, source, notes
       FROM payroll_entry
      WHERE period_id = $1 AND employee_id = $2`,
    [periodId, employeeId]
  )
}

export async function deleteEntry(id) {
  await executeQuery(`DELETE FROM payroll_entry WHERE id = $1`, [id])
}

export async function deleteEntriesBySource(periodId, source) {
  await executeQuery(
    `DELETE FROM payroll_entry WHERE period_id = $1 AND source = $2`,
    [periodId, source]
  )
}

// ---------- Slips ----------

export async function upsertSlip(slip) {
  // Insert or update by (period_id, employee_id)
  const cols = Object.keys(slip)
  const vals = cols.map((c) => slip[c])
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ')
  const updates = cols
    .filter((c) => c !== 'period_id' && c !== 'employee_id')
    .map((c) => `${c} = EXCLUDED.${c}`)
    .join(', ')
  const rows = await executeQuery(
    `INSERT INTO auto_payroll_slip (${cols.join(', ')})
     VALUES (${placeholders})
     ON CONFLICT (period_id, employee_id) DO UPDATE
       SET ${updates}
     RETURNING id, period_id, employee_id`,
    vals
  )
  return rows[0]
}

export async function listSlipsByPeriod(periodId) {
  return executeQuery(
    `SELECT s.*, emp.first_name, emp.last_name, emp.employee_code,
            d.department_name, dg.desg_name AS designation_name
       FROM auto_payroll_slip s
       JOIN employees emp ON emp.employee_id = s.employee_id
       LEFT JOIN departments d ON d.department_id = emp.department_id
       LEFT JOIN designation dg ON dg.desg_id = emp.designation_id
      WHERE s.period_id = $1
      ORDER BY emp.first_name, emp.last_name`,
    [periodId]
  )
}

export async function getSlipById(id) {
  const rows = await executeQuery(
    `SELECT s.*, emp.first_name, emp.last_name, emp.employee_code,
            d.department_name, dg.desg_name AS designation_name
       FROM auto_payroll_slip s
       JOIN employees emp ON emp.employee_id = s.employee_id
       LEFT JOIN departments d ON d.department_id = emp.department_id
       LEFT JOIN designation dg ON dg.desg_id = emp.designation_id
      WHERE s.id = $1`,
    [id]
  )
  return rows[0] || null
}

export async function updateSlipFields(id, updates, auditEntry) {
  const cols = Object.keys(updates)
  if (!cols.length) return null
  const setSql = cols.map((c, i) => `${c} = $${i + 2}`).join(', ')
  const vals = cols.map((c) => updates[c])
  await executeQuery(
    `UPDATE auto_payroll_slip
        SET ${setSql},
            status = CASE WHEN status = 'draft' THEN 'overridden' ELSE status END,
            audit_log = audit_log || $${cols.length + 2}::jsonb
      WHERE id = $1`,
    [id, ...vals, JSON.stringify([auditEntry])]
  )
}

export async function publishSlipsForPeriod(periodId) {
  await executeQuery(
    `UPDATE auto_payroll_slip SET status = 'published' WHERE period_id = $1`,
    [periodId]
  )
}

export async function deleteSlipsForPeriod(periodId) {
  await executeQuery(`DELETE FROM auto_payroll_slip WHERE period_id = $1`, [periodId])
}

// ---------- Source data helpers ----------

/**
 * Active employees for whom slips should be generated for this period.
 *
 * Hard rule: only employees with is_active = true. Inactive employees (terminated,
 * resigned, archived) are skipped entirely — no slip will be generated for them,
 * even if their last_working_date falls inside the period. HR can re-activate
 * temporarily if a back-dated slip is genuinely required.
 *
 * Additional filters:
 *  - Must have joined on/before the period end (join_date <= end).
 *  - If last_working_date is set, it must be >= period start (left after period began).
 */
export async function getActiveEmployeesForPeriod(startDate, endDate) {
  try {
    return await executeQuery(
      `SELECT e.employee_id, e.employee_code, e.first_name, e.last_name,
              e.email, e.department_id, e.designation_id,
              e.join_date AS effective_join_date,
              e.last_working_date AS effective_leave_date
         FROM employees e
        WHERE e.is_active = true
          AND (e.join_date IS NULL OR e.join_date <= $2)
          AND (e.last_working_date IS NULL OR e.last_working_date >= $1)
        ORDER BY e.first_name, e.last_name`,
      [startDate, endDate]
    )
  } catch (err) {
    // Fallback when last_working_date column doesn't exist yet — still enforce is_active.
    if (err.code === '42703') {
      return executeQuery(
        `SELECT e.employee_id, e.employee_code, e.first_name, e.last_name,
                e.email, e.department_id, e.designation_id,
                e.join_date AS effective_join_date,
                NULL::date AS effective_leave_date
           FROM employees e
          WHERE e.is_active = true
            AND (e.join_date IS NULL OR e.join_date <= $2)
          ORDER BY e.first_name, e.last_name`,
        [startDate, endDate]
      )
    }
    throw err
  }
}

/** Loan/Advance requisitions whose deduction should be active for this period.
 *  Trigger condition: HR Check approved AND creator NOT yet acknowledged AND finance approved
 *  (i.e. requisition is in "Pending Creator Acknowledgment" stage). */
export async function getActiveLoanDeductionsForPeriod(periodEndDate) {
  return executeQuery(
    `SELECT r.req_id, r.req_emp_id AS employee_id, r.req_category,
            COALESCE(r.req_hr_approved_amount, 0) AS approved_amount,
            COALESCE(r.req_hr_approved_installments, 1) AS approved_installments,
            r.req_hr_check_approved_at, r.loan_advance_type
       FROM requisition r
      WHERE COALESCE(r.req_is_rejected, 0) = 0
        AND COALESCE(r.req_creator_acknowledged, 0) = 0
        AND r.req_hr_check_approved_by IS NOT NULL
        AND COALESCE(r.req_finance_approval, 0) = 1
        AND r.req_hr_check_approved_at::date <= $1
        AND LOWER(COALESCE(r.req_category, '')) LIKE '%loan%advance%salary%'`,
    [periodEndDate]
  )
}

/** Count how many monthly installments of this loan have already been deducted in prior published periods. */
export async function countLoanInstallmentsPaid(reqId, beforePeriodId) {
  const rows = await executeQuery(
    `SELECT COUNT(*)::int AS paid
       FROM payroll_entry e
       JOIN auto_payroll_period p ON p.id = e.period_id
      WHERE e.source = $1
        AND e.entry_type = 'deduction'
        AND p.id < $2
        AND p.status IN ('processed','published','closed')`,
    [`loan_req:${reqId}`, beforePeriodId]
  )
  return rows[0]?.paid ?? 0
}

/** Employee salary structure (fixed allowances). */
export async function getSalaryStructureMap(employeeIds) {
  if (!employeeIds.length) return new Map()
  const rows = await executeQuery(
    `SELECT employee_id, basic_salary, medical_allowance, conveyance_allowance,
            conveyance_liters_allowance, communication_allowance, house_rent_allowance,
            utilities_allowance, meal_allowance, other_allowance, arrears,
            incremental_arrears, bike_maintenance_allowance, incentives,
            device_reimbursement, eobi_fixed
       FROM employee_salary_structure
      WHERE employee_id = ANY($1::int[])`,
    [employeeIds]
  )
  return new Map(rows.map((r) => [r.employee_id, r]))
}

/** Approved leaves intersecting the period (used for unpaid-leave absent days). */
export async function getApprovedLeavesInRange(startDate, endDate) {
  try {
    return await executeQuery(
      `SELECT lr.leave_request_id, lr.employee_id, lr.start_date, lr.end_date,
              lr.leave_type_id, lt.leave_type_name, COALESCE(lt.is_paid, true) AS is_paid
         FROM leave_requests lr
         LEFT JOIN leave_types lt ON lt.leave_type_id = lr.leave_type_id
        WHERE lr.status = 'Approved'
          AND lr.start_date <= $2
          AND lr.end_date   >= $1`,
      [startDate, endDate]
    )
  } catch (err) {
    if (err.code === '42P01' || err.code === '42703') return []
    throw err
  }
}
