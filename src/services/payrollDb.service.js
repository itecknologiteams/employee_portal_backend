import * as payrollRepo from '../repositories/payrollDb.repository.js'
import * as reqRepo from '../repositories/requisition.repository.js'
import * as XLSX from 'xlsx'
import { executeQuery } from '../../config/database.js'
import { computeStructureFromGross, getActiveTaxSlabs } from '../repositories/payroll.repository.js'
import { monthlyIncomeTax, computeAnnualIncomeTaxFromSlabs } from '../utils/incomeTax.js'

// Elements that make up taxable "Total Income": Basic, Medical, House Rent, Utilities,
// Incentives Tech, Incremental Arrears (same set as v_payroll_taxable_income).
const TAXABLE_ELEMENT_IDS = new Set([1, 2, 5, 6, 10, 31])
const INCOME_TAX_ELEMENT_ID = 18

/** Subset of the given employee ids that are active in the portal. */
async function getActiveEmployeeIds(employeeIds) {
  const ids = [...new Set((employeeIds || []).map(Number).filter(Number.isFinite))]
  if (!ids.length) return []
  const rows = await executeQuery(
    `SELECT employee_id FROM employees WHERE employee_id = ANY($1) AND is_active = true`,
    [ids]
  )
  return rows.map((r) => r.employee_id)
}

/** Fetch { employee_id -> {code, name} } from the portal DB for the given ids (empty map if none). */
async function getEmployeeIdentityMap(employeeIds) {
  const ids = [...new Set((employeeIds || []).filter((n) => Number.isFinite(Number(n))).map(Number))]
  if (!ids.length) return new Map()
  const rows = await executeQuery(
    `SELECT employee_id, employee_code, first_name, last_name FROM employees WHERE employee_id = ANY($1)`,
    [ids]
  )
  return new Map(rows.map((r) => [r.employee_id, {
    code: r.employee_code,
    name: [r.first_name, r.last_name].filter(Boolean).join(' ').trim()
  }]))
}

// ============================================================================
// Application services for the separate iteck_payroll database:
//   #1 loan/advance sync from approved requisitions
//   #2 employee salary-structure sync (portal -> element template)
//   #3 payroll-slip generation + read
// ============================================================================

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

// ---- #2 Structure sync (from employee_gross_salary — the current gross per employee) --
// Source of truth for each employee's current gross = the portal `employee_gross_salary` table.
// That gross is split into the standing structure elements via computeStructureFromGross
// (Basic/Medical/House/Utilities + EOBI), the same model the portal itself uses.
// Income Tax is auto-calculated at slip time; Loan/Advance come from the requisition flow.
const STRUCT_ELEMENT_MAP = {
  basicSalary: 1,
  medicalAllowance: 2,
  houseRentAllowance: 5,
  utilitiesAllowance: 6,
  eobiFixed: 17
}

/** Split a gross into structure elements and upsert them for the employee. */
async function applyStructureFromGross(employeeId, gross, joinDate) {
  const s = computeStructureFromGross(gross, joinDate)
  if (!s) return { employeeId, synced: 0, reason: 'Could not compute structure' }
  let synced = 0
  for (const [key, elementId] of Object.entries(STRUCT_ELEMENT_MAP)) {
    const amount = round2(s[key])
    if (Number.isFinite(amount) && amount > 0) {
      await payrollRepo.upsertEmployeeElement(employeeId, elementId, amount)
      synced++
    }
  }
  return { employeeId, synced, gross: round2(gross) }
}

/** Build one employee's element template from their current gross (employee_gross_salary). */
export async function syncEmployeeStructure(employeeId) {
  const rows = await executeQuery(
    `SELECT g.gross_salary, e.join_date
     FROM employee_gross_salary g JOIN employees e ON e.employee_id = g.employee_id
     WHERE g.employee_id = $1`,
    [employeeId]
  )
  const gross = Number(rows[0]?.gross_salary) || 0
  if (!(gross > 0)) return { employeeId, synced: 0, reason: 'No gross salary found' }
  return applyStructureFromGross(employeeId, gross, rows[0].join_date)
}

/** Seed ACTIVE employees' structures from employee_gross_salary. */
export async function syncAllEmployeeStructures() {
  const rows = await executeQuery(
    `SELECT g.employee_id, g.gross_salary, e.join_date
     FROM employee_gross_salary g JOIN employees e ON e.employee_id = g.employee_id
     WHERE e.is_active = true AND g.gross_salary > 0`
  )
  const results = []
  for (const r of rows) {
    try {
      results.push(await applyStructureFromGross(r.employee_id, r.gross_salary, r.join_date))
    } catch (err) {
      results.push({ employeeId: r.employee_id, error: err?.message || 'failed' })
    }
  }
  const synced = results.filter((x) => (x.synced || 0) > 0).length
  return { total: rows.length, synced, results }
}

// ---- Allowance / Deduction sheets (manual per-period elements) --------------

const HEADER_CODE = 'Employee Code'
const HEADER_NAME = 'Employee Name'

/** Build a downloadable Excel template for the allowance OR deduction sheet.
 * One shared shape — only the heading/columns differ by type. Rows = active employees. */
export async function buildElementSheetTemplate(type) {
  const isDeduction = String(type || '').toLowerCase() === 'deduction'
  const label = isDeduction ? 'Deductions' : 'Allowances'
  const elements = await payrollRepo.getSheetElements(type)
  const emps = await executeQuery(
    `SELECT employee_code, first_name, last_name FROM employees WHERE is_active = true ORDER BY employee_code`
  )
  const headers = [HEADER_CODE, HEADER_NAME, ...elements.map((e) => e.element_name)]
  const dataRows = emps.map((e) => [
    e.employee_code,
    [e.first_name, e.last_name].filter(Boolean).join(' ').trim(),
    ...elements.map(() => '')
  ])
  const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, label)
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  return { buffer, filename: `${label}-Sheet-Template.xlsx`, elementCount: elements.length, employeeCount: emps.length }
}

/** Parse an uploaded allowance/deduction sheet and store the values as per-period elements. */
export async function uploadElementSheet(payrollId, type, buffer) {
  const pid = parseInt(payrollId, 10)
  if (!Number.isFinite(pid)) return { error: 'Valid payrollId is required', status: 400 }
  const elements = await payrollRepo.getSheetElements(type)
  const nameToId = new Map(elements.map((e) => [String(e.element_name).trim().toLowerCase(), e.element_id]))

  let sheet
  try {
    const wb = XLSX.read(buffer, { type: 'buffer' })
    sheet = wb.Sheets[wb.SheetNames[0]]
  } catch {
    return { error: 'Could not read the uploaded file', status: 400 }
  }
  if (!sheet) return { error: 'The uploaded file has no sheet', status: 400 }
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
  if (!rows.length) return { error: 'No data rows found in the sheet', status: 400 }

  const codes = [...new Set(rows.map((r) => String(r[HEADER_CODE] ?? r.employee_code ?? '').trim()).filter(Boolean))]
  const empRows = codes.length
    ? await executeQuery(`SELECT employee_id, employee_code FROM employees WHERE employee_code = ANY($1)`, [codes])
    : []
  const codeToId = new Map(empRows.map((e) => [String(e.employee_code).trim(), e.employee_id]))

  let cellsUpdated = 0
  const errors = []
  for (const row of rows) {
    const code = String(row[HEADER_CODE] ?? row.employee_code ?? '').trim()
    if (!code) continue
    const eid = codeToId.get(code)
    if (!eid) { errors.push({ code, error: 'Employee not found' }); continue }
    for (const [header, val] of Object.entries(row)) {
      const key = String(header).trim().toLowerCase()
      if (key === HEADER_CODE.toLowerCase() || key === HEADER_NAME.toLowerCase() || key === 'employee_code') continue
      const elementId = nameToId.get(key)
      if (!elementId) continue // unknown column — ignore
      const amount = Math.round((parseFloat(String(val).replace(/,/g, '')) || 0) * 100) / 100
      if (!(amount > 0)) continue // skip blanks / zero
      try {
        await payrollRepo.upsertPeriodElement(pid, eid, elementId, amount)
        cellsUpdated++
      } catch (err) {
        errors.push({ code, element: header, error: err?.message || 'failed' })
      }
    }
  }
  return {
    payrollId: pid,
    type: String(type || '').toLowerCase() === 'deduction' ? 'deduction' : 'allowance',
    cellsUpdated,
    failed: errors.length,
    errors: errors.slice(0, 20)
  }
}

// ---- #1 Loan/Advance sync from an approved requisition ---------------------

/** First day of next month as YYYY-MM-DD (fallback installment start). */
function firstOfNextMonth() {
  const d = new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10)
}

/** Loan (15) vs Advance Salary (16) from the requisition type/category. Null if neither. */
function loanElementId(data) {
  const t = `${data.loan_advance_type || ''} ${data.req_category || ''}`.toLowerCase()
  if (t.includes('advance')) return 16
  if (t.includes('loan')) return 15
  return null
}

/**
 * Create a payroll_loan + installment schedule from a Finance-approved loan/advance requisition.
 * Idempotent (payroll_loan.source_req_id). Returns {created, loanId} or {skipped, reason}.
 */
export async function syncLoanFromRequisition(reqId) {
  const data = await reqRepo.getRequisitionLoanData(reqId)
  if (!data) return { skipped: true, reason: 'Requisition not found' }
  if (Number(data.req_finance_approval) !== 1) return { skipped: true, reason: 'Not finance-approved' }

  const elementId = loanElementId(data)
  if (!elementId) return { skipped: true, reason: 'Not a Loan/Advance requisition' }

  const principal = round2(data.req_hr_approved_amount ?? data.loan_advance_amount)
  if (!(principal > 0)) return { skipped: true, reason: 'No approved amount' }

  const totalInstallments = Math.max(1, parseInt(data.req_hr_approved_installments ?? data.loan_installment_months ?? 1, 10) || 1)
  const installmentAmount = round2(Math.ceil(principal / totalInstallments))
  const startDate = data.req_hr_installment_start_date
    ? new Date(data.req_hr_installment_start_date).toISOString().slice(0, 10)
    : firstOfNextMonth()

  const res = await payrollRepo.createLoanWithSchedule({
    sourceReqId: Number(reqId),
    employeeId: Number(data.req_emp_id),
    elementId,
    principal,
    installmentAmount,
    totalInstallments,
    startDate,
    disbursedOn: startDate,
    remarks: `Synced from requisition #${reqId} (${data.req_category || ''})`
  })
  return { ...res, employeeId: Number(data.req_emp_id), elementId, principal, totalInstallments, startDate }
}

/** Non-throwing wrapper for use in the requisition approval flow (fire-and-forget). */
export async function syncLoanFromRequisitionSafe(reqId) {
  try {
    const r = await syncLoanFromRequisition(reqId)
    if (r.skipped) console.log(`[PayrollLoanSync] req#${reqId} skipped: ${r.reason}`)
    else console.log(`[PayrollLoanSync] req#${reqId} -> loan ${r.loanId} (${r.created ? 'created' : 'existing'})`)
    return r
  } catch (err) {
    console.error(`[PayrollLoanSync] req#${reqId} FAILED:`, err?.message)
    return { error: err?.message || 'sync failed' }
  }
}

// ---- #3 Payroll slip generation + read -------------------------------------

/**
 * Generate (or regenerate) an employee's slip for a payroll period from their element template
 * plus any loan/advance installments due that period. Stores the header + element line items,
 * and marks the recovered installments as Deducted.
 */
export async function generatePayrollSlip(payrollId, employeeId, slabs) {
  const pid = parseInt(payrollId, 10)
  const eid = parseInt(employeeId, 10)
  if (!Number.isFinite(pid) || !Number.isFinite(eid)) return { error: 'Valid payrollId and employeeId are required', status: 400 }
  // Active DB tax slabs (passed in by a bulk run, else fetched here). Empty → built-in fallback.
  const taxSlabs = slabs !== undefined ? slabs : await getActiveTaxSlabs().catch(() => [])

  const structure = await payrollRepo.getEmployeeElements(eid)
  if (!structure.length) return { error: 'No salary structure for this employee. Run structure sync first.', status: 400 }
  const periodEls = await payrollRepo.getPeriodElements(pid, eid)   // allowance/deduction sheet values
  const due = await payrollRepo.getDueInstallments(eid, pid)

  // Merge structure + manual per-period elements + due loan/advance installments.
  const elMap = new Map() // element_id -> { amount, type }
  for (const s of structure) elMap.set(s.element_id, { amount: round2(s.amount), type: s.element_type })
  for (const pe of periodEls) {
    const prev = elMap.get(pe.element_id) || { amount: 0, type: pe.element_type }
    prev.amount = round2(prev.amount + Number(pe.amount))
    prev.type = pe.element_type
    elMap.set(pe.element_id, prev)
  }
  for (const inst of due) {
    const prev = elMap.get(inst.element_id) || { amount: 0, type: 'Deduction' }
    prev.amount = round2(prev.amount + Number(inst.amount))
    prev.type = 'Deduction'
    elMap.set(inst.element_id, prev)
  }

  // Auto income tax: annualise the taxable elements, apply the FY slabs, deduct 1/12 monthly.
  // (Income Tax is always computed here — never taken from the structure template.)
  let monthlyTaxable = 0
  for (const [elementId, v] of elMap) {
    if (TAXABLE_ELEMENT_IDS.has(elementId)) monthlyTaxable += v.amount
  }
  const annualTaxable = round2(monthlyTaxable) * 12
  const annualTaxFromSlabs = computeAnnualIncomeTaxFromSlabs(annualTaxable, taxSlabs)
  const monthlyTax = annualTaxFromSlabs != null
    ? round2(annualTaxFromSlabs / 12)              // DB-managed active slab version
    : monthlyIncomeTax(annualTaxable)              // built-in 2026-27 fallback
  if (monthlyTax > 0) elMap.set(INCOME_TAX_ELEMENT_ID, { amount: round2(monthlyTax), type: 'Deduction' })
  else elMap.delete(INCOME_TAX_ELEMENT_ID)

  let totalAllowances = 0, totalDeductions = 0
  for (const v of elMap.values()) {
    if (v.type === 'Allowance') totalAllowances += v.amount
    else if (v.type === 'Deduction') totalDeductions += v.amount
    // 'Adjust' (e.g. Leaves) is excluded from gross/net here.
  }
  totalAllowances = round2(totalAllowances)
  totalDeductions = round2(totalDeductions)

  const elements = [...elMap.entries()].map(([elementId, v]) => ({ elementId, amount: v.amount }))
  const { slipId } = await payrollRepo.createSlipWithElements({
    payrollId: pid,
    employeeId: eid,
    grossSalary: totalAllowances,     // gross = sum of all allowance elements (incl. Basic)
    totalAllowances,
    totalDeductions,
    netSalary: round2(totalAllowances - totalDeductions),
    status: 'Generated',
    elements
  })

  // Record installment recovery.
  for (const inst of due) {
    await payrollRepo.markInstallmentDeducted(inst.installment_id, inst.amount, slipId)
    await payrollRepo.completeLoanIfRecovered(inst.loan_id)
  }

  return await getPayrollSlip(pid, eid)
}

function shapeSlip(row) {
  if (!row) return null
  return {
    slipId: row.slip_id,
    payrollId: row.payroll_id,
    employeeId: row.employee_id,
    fiscalYear: row.fy_label,
    month: row.mnth_name,
    monthNo: row.mnth_no,
    workingDays: Number(row.working_days),
    paidDays: Number(row.paid_days),
    absentDays: Number(row.absent_days),
    grossSalary: Number(row.gross_salary),
    totalAllowances: Number(row.total_allowances),
    totalDeductions: Number(row.total_deductions),
    netSalary: Number(row.net_salary),
    status: row.status,
    onHold: row.slip_on_hold ?? false,
    elements: (row.elements || []).map(e => ({
      elementId: e.element_id,
      name: e.element_name,
      type: e.element_type,
      amount: Number(e.amount)
    }))
  }
}

export async function getPayrollSlip(payrollId, employeeId) {
  const row = await payrollRepo.getSlip(parseInt(payrollId, 10), parseInt(employeeId, 10))
  return shapeSlip(row)
}

export async function listPayrollSlips(employeeId) {
  const rows = await payrollRepo.listSlipsForEmployee(parseInt(employeeId, 10))
  return rows.map(r => ({
    slipId: r.slip_id,
    payrollId: r.payroll_id,
    fiscalYear: r.fy_label,
    month: r.mnth_name,
    monthNo: r.mnth_no,
    grossSalary: Number(r.gross_salary),
    totalDeductions: Number(r.total_deductions),
    netSalary: Number(r.net_salary),
    status: r.status
  }))
}

// ---- Period-centric (HR payroll run) --------------------------------------

/** All payroll periods with slip counts. */
export async function listPeriods() {
  const rows = await payrollRepo.listPeriods()
  return rows.map((r) => ({
    payrollId: r.payroll_id,
    fyid: r.fyid,
    fiscalYear: r.fy_label,
    monthId: r.mnth_id,
    month: r.mnth_name,
    monthNo: r.mnth_no,
    status: Number(r.period_status) === 1 ? 'Active' : 'Open',
    payrollFinal: Number(r.payroll_final) === 1,
    paysheetFinal: Number(r.paysheet_final) === 1,
    slipCount: Number(r.slip_count || 0)
  }))
}

/** All slips in a period, with employee code/name joined from the portal DB. */
export async function listSlipsForPeriod(payrollId) {
  const rows = await payrollRepo.listSlipsByPeriod(parseInt(payrollId, 10))
  const idMap = await getEmployeeIdentityMap(rows.map((r) => r.employee_id))
  return rows.map((r) => {
    const emp = idMap.get(r.employee_id) || {}
    return {
      slipId: r.slip_id,
      employeeId: r.employee_id,
      employeeCode: emp.code || null,
      employeeName: emp.name || null,
      grossSalary: Number(r.gross_salary),
      totalAllowances: Number(r.total_allowances),
      totalDeductions: Number(r.total_deductions),
      netSalary: Number(r.net_salary),
      status: r.status,
      onHold: r.slip_on_hold ?? false
    }
  })
}

/** Generate/regenerate slips for every employee that has a salary structure, for one period. */
export async function generateAllForPeriod(payrollId) {
  const pid = parseInt(payrollId, 10)
  if (!Number.isFinite(pid)) return { error: 'Valid payrollId is required', status: 400 }
  const withStructure = await payrollRepo.listEmployeeIdsWithStructure()
  const employeeIds = await getActiveEmployeeIds(withStructure)   // active employees only
  const taxSlabs = await getActiveTaxSlabs().catch(() => [])      // fetch once for the whole run
  let generated = 0
  const errors = []
  for (const eid of employeeIds) {
    try {
      const r = await generatePayrollSlip(pid, eid, taxSlabs)
      if (r?.error) errors.push({ employeeId: eid, error: r.error })
      else generated++
    } catch (err) {
      errors.push({ employeeId: eid, error: err?.message || 'failed' })
    }
  }
  return {
    payrollId: pid,
    candidates: employeeIds.length,
    skippedInactive: withStructure.length - employeeIds.length,
    generated,
    failed: errors.length,
    errors: errors.slice(0, 20)
  }
}

/** Loans/advances for an employee with outstanding balances. */
export async function getEmployeeLoans(employeeId) {
  const rows = await payrollRepo.getEmployeeLoans(parseInt(employeeId, 10))
  return rows.map(r => ({
    loanId: r.loan_id,
    sourceReqId: r.source_req_id,
    type: r.element_name,
    principal: Number(r.principal_amount),
    installmentAmount: Number(r.installment_amount),
    totalInstallments: r.total_installments,
    recovered: Number(r.recovered_amount || 0),
    outstanding: Number(r.outstanding_amount || 0),
    pendingInstallments: Number(r.pending_installments || 0),
    status: r.status
  }))
}
