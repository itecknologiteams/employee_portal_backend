import { executeQueryPayroll, executeTransactionPayroll } from '../../config/payrollDatabase.js'

// ============================================================================
// Data access for the separate iteck_payroll database.
// Employee identity/data is NOT stored here — join it from the portal DB at the
// service layer (config/database.js). See config/payrollDatabase.js.
// ============================================================================

// ---- Fiscal calendar helpers (Pakistani FY: 1 Jul – 30 Jun) --------------
// fyid is deterministic and aligned to the seed: FY 2026-2027 = fyid 1.
// payroll_id is deterministic too: (fyid-1)*12 + mnth_id (fyid 1 → 1..12, fyid 2 → 13..24).

const FY_BASE_START_YEAR = 2026 // FY starting July 2026 == fyid 1

/** Calendar month (1–12) → fiscal month id (Jul=1 … Jun=12). */
function fiscalMonthId(calendarMonth) {
  return calendarMonth >= 7 ? calendarMonth - 6 : calendarMonth + 6
}
/** The July-year the given date's fiscal year starts in. */
function fyStartYear(date) {
  const d = new Date(date)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + 1
  return m >= 7 ? y : y - 1
}
function fyidFor(startYear) { return startYear - FY_BASE_START_YEAR + 1 }
function payrollIdFor(fyid, mnthId) { return (fyid - 1) * 12 + mnthId }
/** Add `n` whole months to a YYYY-MM-DD date; returns a Date (UTC, day pinned to 1st). */
function addMonthsUtc(date, n) {
  const d = new Date(date)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1))
}

/**
 * Ensure the fiscal year + all 12 periods exist for the given date, and return the
 * payroll_id of that date's month. Runs on the provided transaction client.
 */
async function ensurePeriodForDateTx(client, date) {
  const startYear = fyStartYear(date)
  const fyid = fyidFor(startYear)
  const label = `${startYear}-${startYear + 1}`
  const start = `${startYear}-07-01`
  const end = `${startYear + 1}-06-30`

  await client.query(
    `INSERT INTO payroll_fiscal_year (fyid, fy_label, start_date, end_date, is_closed)
     VALUES ($1, $2, $3, $4, 0) ON CONFLICT (fyid) DO NOTHING`,
    [fyid, label, start, end]
  )
  // Seed all 12 periods for this FY (idempotent).
  await client.query(
    `INSERT INTO payroll_period (payroll_id, period_id, fyid, mnth_id, period_status, payroll_final, paysheet_final)
     SELECT $1 * 12 - 12 + pm.mnth_id, $2, $2, pm.mnth_id, 0, 0, 0
     FROM payroll_month pm
     ON CONFLICT (payroll_id) DO NOTHING`,
    [fyid, fyid]
  )
  const cal = new Date(date).getUTCMonth() + 1
  return payrollIdFor(fyid, fiscalMonthId(cal))
}

/** Resolve the payroll_id for a calendar date (null if the FY/period is not set up). */
export async function getPayrollIdByDate(date) {
  const rows = await executeQueryPayroll(
    `SELECT pp.payroll_id
     FROM payroll_period pp
     JOIN payroll_month pm ON pm.mnth_id = pp.mnth_id
     JOIN payroll_fiscal_year fy ON fy.fyid = pp.fyid
     WHERE $1::date BETWEEN fy.start_date AND fy.end_date
       AND pm.mnth_no = EXTRACT(MONTH FROM $1::date)`,
    [date]
  )
  return rows[0]?.payroll_id ?? null
}

// ---- Loans & Advances ------------------------------------------------------

/**
 * Create a loan/advance header + its installment schedule, atomically.
 * Idempotent by sourceReqId (returns the existing loan if already synced).
 * @param {{sourceReqId?:number, employeeId:number, elementId:number, principal:number,
 *          installmentAmount:number, totalInstallments:number, startDate:string,
 *          disbursedOn?:string, remarks?:string}} loan
 */
export async function createLoanWithSchedule(loan) {
  return executeTransactionPayroll(async (client) => {
    if (loan.sourceReqId != null) {
      const ex = await client.query('SELECT loan_id FROM payroll_loan WHERE source_req_id = $1', [loan.sourceReqId])
      if (ex.rows.length) return { loanId: ex.rows[0].loan_id, created: false }
    }

    const n = Math.max(1, parseInt(loan.totalInstallments, 10) || 1)
    const principal = Math.round((Number(loan.principal) || 0) * 100) / 100
    const perMonth = Math.round((Number(loan.installmentAmount) || 0) * 100) / 100
    const startPayrollId = await ensurePeriodForDateTx(client, loan.startDate)

    const ins = await client.query(
      `INSERT INTO payroll_loan
         (source_req_id, employee_id, element_id, principal_amount, installment_amount,
          total_installments, start_payroll_id, status, disbursed_on, remarks)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'Active', $8, $9)
       RETURNING loan_id`,
      [loan.sourceReqId ?? null, loan.employeeId, loan.elementId, principal, perMonth,
       n, startPayrollId, loan.disbursedOn ?? null, loan.remarks ?? null]
    )
    const loanId = ins.rows[0].loan_id

    // Build the schedule: each month = perMonth, the LAST installment absorbs any rounding remainder.
    let recoveredSoFar = 0
    for (let i = 0; i < n; i++) {
      const monthDate = addMonthsUtc(loan.startDate, i).toISOString().slice(0, 10)
      const payrollId = await ensurePeriodForDateTx(client, monthDate)
      const amount = i < n - 1
        ? perMonth
        : Math.round((principal - recoveredSoFar) * 100) / 100
      recoveredSoFar += perMonth
      await client.query(
        `INSERT INTO payroll_loan_installment (loan_id, payroll_id, installment_no, amount, status)
         VALUES ($1, $2, $3, $4, 'Pending')`,
        [loanId, payrollId, i + 1, amount]
      )
    }
    return { loanId, created: true }
  })
}

/** Loans for an employee with outstanding balance (uses v_payroll_loan_balance). */
export async function getEmployeeLoans(employeeId) {
  return executeQueryPayroll(
    `SELECT l.loan_id, l.source_req_id, l.element_id, e.element_name,
            l.principal_amount, l.installment_amount, l.total_installments,
            l.status, l.disbursed_on,
            b.recovered_amount, b.outstanding_amount, b.pending_installments
     FROM payroll_loan l
     JOIN payroll_elements e ON e.element_id = l.element_id
     LEFT JOIN v_payroll_loan_balance b ON b.loan_id = l.loan_id
     WHERE l.employee_id = $1
     ORDER BY l.loan_id DESC`,
    [employeeId]
  )
}

/** Installments due (Pending) for an employee in a given payroll period. */
export async function getDueInstallments(employeeId, payrollId) {
  return executeQueryPayroll(
    `SELECT i.installment_id, i.loan_id, i.installment_no, i.amount, l.element_id
     FROM payroll_loan_installment i
     JOIN payroll_loan l ON l.loan_id = i.loan_id
     WHERE l.employee_id = $1 AND i.payroll_id = $2 AND i.status = 'Pending'`,
    [employeeId, payrollId]
  )
}

/** Mark an installment as recovered on a slip. */
export async function markInstallmentDeducted(installmentId, deductedAmount, slipId) {
  return executeQueryPayroll(
    `UPDATE payroll_loan_installment
     SET status = 'Deducted', deducted_amount = $2, slip_id = $3
     WHERE installment_id = $1`,
    [installmentId, deductedAmount, slipId]
  )
}

/** Close a loan once its full principal has been recovered. */
export async function completeLoanIfRecovered(loanId) {
  return executeQueryPayroll(
    `UPDATE payroll_loan l
     SET status = 'Completed', updated_at = CURRENT_TIMESTAMP
     WHERE l.loan_id = $1 AND l.status = 'Active'
       AND (SELECT COALESCE(SUM(deducted_amount), 0) FROM payroll_loan_installment WHERE loan_id = $1)
           >= l.principal_amount`,
    [loanId]
  )
}

// ---- Employee salary structure (element template) --------------------------

export async function upsertEmployeeElement(employeeId, elementId, amount) {
  return executeQueryPayroll(
    `INSERT INTO employee_payroll_element (employee_id, element_id, amount, is_active, updated_at)
     VALUES ($1, $2, $3, 1, CURRENT_TIMESTAMP)
     ON CONFLICT (employee_id, element_id)
     DO UPDATE SET amount = EXCLUDED.amount, is_active = 1, updated_at = CURRENT_TIMESTAMP
     RETURNING id`,
    [employeeId, elementId, amount]
  )
}

export async function getEmployeeElements(employeeId) {
  return executeQueryPayroll(
    `SELECT epe.element_id, e.element_name, e.element_type, e.seq_no, epe.amount
     FROM employee_payroll_element epe
     JOIN payroll_elements e ON e.element_id = epe.element_id
     WHERE epe.employee_id = $1 AND epe.is_active = 1
     ORDER BY e.element_type, e.seq_no`,
    [employeeId]
  )
}

// ---- Per-period manual elements (allowance / deduction sheets) -------------

/** Catalog of elements that belong on the manual sheet for a type.
 *  allowance: Allowance type minus Basic/Medical/House/Utilities (from gross structure).
 *  deduction: Deduction type minus Loan/Advance/EOBI/Income Tax (auto / requisition-sourced). */
export async function getSheetElements(type) {
  const isDeduction = String(type || '').toLowerCase() === 'deduction'
  const elementType = isDeduction ? 'Deduction' : 'Allowance'
  const excluded = isDeduction ? [15, 16, 17, 18] : [1, 2, 5, 6]
  return executeQueryPayroll(
    `SELECT element_id, element_name FROM payroll_elements
     WHERE element_type = $1 AND element_id <> ALL($2::int[])
     ORDER BY seq_no NULLS LAST, element_id`,
    [elementType, excluded]
  )
}

export async function upsertPeriodElement(payrollId, employeeId, elementId, amount) {
  return executeQueryPayroll(
    `INSERT INTO payroll_period_element (payroll_id, employee_id, element_id, amount, updated_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
     ON CONFLICT (payroll_id, employee_id, element_id)
     DO UPDATE SET amount = EXCLUDED.amount, updated_at = CURRENT_TIMESTAMP`,
    [payrollId, employeeId, elementId, amount]
  )
}

/** Manual per-period element amounts (with type) for one employee. */
export async function getPeriodElements(payrollId, employeeId) {
  return executeQueryPayroll(
    `SELECT pe.element_id, e.element_type, pe.amount
     FROM payroll_period_element pe
     JOIN payroll_elements e ON e.element_id = pe.element_id
     WHERE pe.payroll_id = $1 AND pe.employee_id = $2`,
    [payrollId, employeeId]
  )
}

// ---- Payroll slips (header + element line items) ---------------------------

/**
 * Upsert a slip and replace its element line items, atomically.
 * @param {{payrollId:number, employeeId:number, workingDays?:number, paidDays?:number,
 *          absentDays?:number, grossSalary:number, totalAllowances:number,
 *          totalDeductions:number, netSalary:number, status?:string,
 *          elements:Array<{elementId:number, amount:number}>}} slip
 */
export async function createSlipWithElements(slip) {
  return executeTransactionPayroll(async (client) => {
    const head = await client.query(
      `INSERT INTO payroll_slip
         (payroll_id, employee_id, working_days, paid_days, absent_days,
          gross_salary, total_allowances, total_deductions, net_salary, status, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
       ON CONFLICT (payroll_id, employee_id) DO UPDATE SET
         working_days = EXCLUDED.working_days, paid_days = EXCLUDED.paid_days, absent_days = EXCLUDED.absent_days,
         gross_salary = EXCLUDED.gross_salary, total_allowances = EXCLUDED.total_allowances,
         total_deductions = EXCLUDED.total_deductions, net_salary = EXCLUDED.net_salary,
         status = EXCLUDED.status, updated_at = CURRENT_TIMESTAMP
       RETURNING slip_id`,
      [slip.payrollId, slip.employeeId, slip.workingDays ?? 0, slip.paidDays ?? 0, slip.absentDays ?? 0,
       slip.grossSalary, slip.totalAllowances, slip.totalDeductions, slip.netSalary, slip.status ?? 'Generated']
    )
    const slipId = head.rows[0].slip_id

    await client.query('DELETE FROM payroll_slip_element WHERE slip_id = $1', [slipId])
    for (const el of (slip.elements || [])) {
      await client.query(
        `INSERT INTO payroll_slip_element (slip_id, element_id, amount) VALUES ($1, $2, $3)`,
        [slipId, el.elementId, el.amount]
      )
    }
    return { slipId }
  })
}

/** One slip (header + element line items with names) for an employee in a period. */
export async function getSlip(payrollId, employeeId) {
  const head = await executeQueryPayroll(
    `SELECT s.slip_id, s.payroll_id, s.employee_id, s.working_days, s.paid_days, s.absent_days,
            s.gross_salary, s.total_allowances, s.total_deductions, s.net_salary, s.status,
            s.slip_on_hold, pp.fyid, pm.mnth_name, pm.mnth_no, fy.fy_label
     FROM payroll_slip s
     JOIN payroll_period pp ON pp.payroll_id = s.payroll_id
     JOIN payroll_month pm ON pm.mnth_id = pp.mnth_id
     JOIN payroll_fiscal_year fy ON fy.fyid = pp.fyid
     WHERE s.payroll_id = $1 AND s.employee_id = $2`,
    [payrollId, employeeId]
  )
  if (!head.length) return null
  const elements = await executeQueryPayroll(
    `SELECT se.element_id, e.element_name, e.element_type, e.seq_no, se.amount
     FROM payroll_slip_element se
     JOIN payroll_elements e ON e.element_id = se.element_id
     WHERE se.slip_id = $1
     ORDER BY e.element_type, e.seq_no`,
    [head[0].slip_id]
  )
  return { ...head[0], elements }
}

/** All payroll periods (newest FY first, fiscal month order) with slip counts. */
export async function listPeriods() {
  return executeQueryPayroll(
    `SELECT pp.payroll_id, pp.fyid, fy.fy_label, pp.mnth_id, pm.mnth_name, pm.mnth_no,
            pp.period_status, pp.payroll_final, pp.paysheet_final,
            (SELECT COUNT(*) FROM payroll_slip s WHERE s.payroll_id = pp.payroll_id) AS slip_count
     FROM payroll_period pp
     JOIN payroll_month pm ON pm.mnth_id = pp.mnth_id
     JOIN payroll_fiscal_year fy ON fy.fyid = pp.fyid
     ORDER BY fy.start_date DESC, pm.mnth_id ASC`
  )
}

/** Slip headers for all employees in a period (employee names are joined at the service layer). */
export async function listSlipsByPeriod(payrollId) {
  return executeQueryPayroll(
    `SELECT s.slip_id, s.employee_id, s.gross_salary, s.total_allowances,
            s.total_deductions, s.net_salary, s.status, s.slip_on_hold
     FROM payroll_slip s WHERE s.payroll_id = $1 ORDER BY s.employee_id`,
    [payrollId]
  )
}

/** Employee ids that have an active salary-structure template (candidates for a payroll run). */
export async function listEmployeeIdsWithStructure() {
  const rows = await executeQueryPayroll(
    `SELECT DISTINCT employee_id FROM employee_payroll_element WHERE is_active = 1`
  )
  return rows.map(r => r.employee_id)
}

/** All slips for an employee (newest FY/month first). */
export async function listSlipsForEmployee(employeeId) {
  return executeQueryPayroll(
    `SELECT s.slip_id, s.payroll_id, s.gross_salary, s.total_deductions, s.net_salary, s.status,
            fy.fy_label, pm.mnth_name, pm.mnth_no
     FROM payroll_slip s
     JOIN payroll_period pp ON pp.payroll_id = s.payroll_id
     JOIN payroll_month pm ON pm.mnth_id = pp.mnth_id
     JOIN payroll_fiscal_year fy ON fy.fyid = pp.fyid
     WHERE s.employee_id = $1
     ORDER BY fy.start_date DESC, pm.mnth_id DESC`,
    [employeeId]
  )
}
