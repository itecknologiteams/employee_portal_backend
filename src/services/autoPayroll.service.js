/**
 * Automated Payroll Service
 * ---------------------------------------------------------------
 * Implements the new fully-automated payroll flow. Pulls inputs from:
 *  - ICS attendance API (paid days, absent days, late count)
 *  - leave_requests (unpaid leaves → absent days)
 *  - requisition (active loan installments at Creator Acknowledgment stage)
 *  - employee_salary_structure (fixed allowances)
 *  - payroll_entry (variable monthly allowances + deductions)
 *
 * See docs/superpowers/specs/2026-05-29-automated-payroll-design.md for full spec.
 */

import * as repo from '../repositories/autoPayroll.repository.js'
import { getActiveTaxSlabs } from '../repositories/payroll.repository.js'
import * as XLSX from 'xlsx'
import { executeQuery } from '../../config/database.js'

const EOBI_FIXED = 130
const LATE_TO_ABSENT_DIVISOR = 3

// ---------- Income tax (annualised, Pakistan FY July–June) ----------

/** Tax-year bounds [1 Jul, 30 Jun] containing the given date. New FY restarts the projection. */
function getTaxYearBounds(dateLike) {
  const d = new Date(dateLike)
  const y = d.getUTCFullYear()
  const startYear = d.getUTCMonth() >= 6 ? y : y - 1 // month index 6 = July
  return { start: new Date(Date.UTC(startYear, 6, 1)), end: new Date(Date.UTC(startYear + 1, 5, 30)) }
}

/** Annual tax from active slab rows: base tax of the bracket + percent over the bracket's lower bound. */
function computeAnnualTax(annualIncome, slabs) {
  if (!Array.isArray(slabs) || slabs.length === 0 || !(annualIncome > 0)) return 0
  const pick = slabs.find((s) => annualIncome >= parseFloat(s.min_amt) && annualIncome <= parseFloat(s.max_amt))
    || slabs[slabs.length - 1]
  const base = parseFloat(pick.taxable_amt) || 0
  const pct = parseFloat(pick.tax_percent) || 0
  const lower = parseFloat(pick.min_amt) - 1 // min_amt is "threshold + 1" (e.g. 600001 → lower 600000)
  return Math.round((base + (pct / 100) * (annualIncome - lower)) * 100) / 100
}

const monthStartUTC = (d) => { const x = new Date(d); return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), 1)) }
const monthsInclusive = (a, b) => (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) + 1

/** Gross in effect for a given FY month: current gross for the payroll month and later, else the
 *  historic gross from salary_change events (newGross of the latest change effective by month-end;
 *  oldGross of the first change for months before any change; current gross if no history). */
function grossInEffectForMonth(monthStart, pm, currentGross, changesAsc) {
  if (monthStart >= pm) return currentGross
  const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0))
  let applicable = null
  for (const c of changesAsc) {
    if (c.effectiveDate && new Date(c.effectiveDate) <= monthEnd) applicable = c
  }
  if (applicable && applicable.newGross != null) return applicable.newGross
  const first = changesAsc.find((c) => c.oldGross != null)
  return first ? first.oldGross : currentGross
}

/**
 * Monthly income-tax (FBR mid-year-revision / "catch-up" method, progressive slab).
 * For each month of the employee's FY span we annualise the gross in effect that month
 * (gross × months-in-FY), take the progressive annual tax, subtract the tax already collected in
 * earlier months, and spread the remainder over the months left in the FY. When salary rises
 * mid-year the annual liability jumps and the shortfall from the lower-paid months is recovered
 * across the remaining months — so post-increment months are higher than a flat annual÷12.
 * Self-contained: prior-month deductions are simulated by formula (no dependency on past slips).
 */
function computeMonthlyIncomeTax({ payrollMonthDate, joinDate, currentGross, salaryChanges, slabs }) {
  if (!(currentGross > 0) || !Array.isArray(slabs) || slabs.length === 0) return 0
  const { start: fyStart, end: fyEnd } = getTaxYearBounds(payrollMonthDate)
  const pm = monthStartUTC(payrollMonthDate)
  const join = joinDate ? monthStartUTC(joinDate) : null
  const effStart = (join && join > fyStart) ? join : fyStart
  if (pm < effStart || pm > fyEnd) return 0
  const monthsInFY = Math.max(1, monthsInclusive(effStart, fyEnd))
  const changesAsc = (salaryChanges || []).filter((c) => c.effectiveDate)
    .slice().sort((a, b) => (a.effectiveDate < b.effectiveDate ? -1 : 1))

  let deductedSoFar = 0
  const cursor = new Date(effStart)
  while (cursor <= fyEnd) {
    const grossK = Number(grossInEffectForMonth(new Date(cursor), pm, currentGross, changesAsc)) || 0
    const annualTaxK = computeAnnualTax(grossK * monthsInFY, slabs)
    const remainingFromK = Math.max(1, monthsInclusive(new Date(cursor), fyEnd))
    const taxK = Math.max(0, Math.round(((annualTaxK - deductedSoFar) / remainingFromK) * 100) / 100)
    if (cursor.getUTCFullYear() === pm.getUTCFullYear() && cursor.getUTCMonth() === pm.getUTCMonth()) {
      return taxK // reached the payroll month
    }
    deductedSoFar += taxK
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  return 0
}

// ---------- Period CRUD ----------

export async function createPeriod(body) {
  const { name, startDate, endDate, workingDays, createdBy } = body
  if (!name || !startDate || !endDate) {
    return { error: 'name, startDate, endDate are required', status: 400 }
  }
  const wd = parseInt(workingDays, 10)
  if (Number.isNaN(wd) || wd < 1 || wd > 31) {
    return { error: 'workingDays must be between 1 and 31', status: 400 }
  }
  const row = await repo.createPeriod({ name, startDate, endDate, workingDays: wd, createdBy })
  return { period: shapePeriod(row) }
}

export async function listPeriods(query) {
  const { status, limit = 50, offset = 0 } = query || {}
  const rows = await repo.listPeriods({
    status,
    limit: parseInt(limit, 10) || 50,
    offset: parseInt(offset, 10) || 0
  })
  return { periods: rows.map(shapePeriod) }
}

export async function getPeriod(id) {
  const period = await repo.getPeriodById(id)
  if (!period) return { error: 'Period not found', status: 404 }
  return { period: shapePeriod(period) }
}

export async function deletePeriod(id) {
  const period = await repo.getPeriodById(id)
  if (!period) return { error: 'Period not found', status: 404 }
  if (period.status !== 'draft') {
    return { error: `Only draft periods can be deleted (current status: ${period.status})`, status: 400 }
  }
  await repo.deletePeriod(id)
  return { deleted: true }
}

// ---------- Entries (variable monthly amounts) ----------

export async function upsertEntry(periodId, body) {
  const period = await repo.getPeriodById(periodId)
  if (!period) return { error: 'Period not found', status: 404 }
  if (period.status === 'published' || period.status === 'closed') {
    return { error: 'Cannot edit entries on a published/closed period', status: 400 }
  }
  const { employeeId, entryType, entrySubtype, amount, source, notes, createdBy } = body
  if (!employeeId || !entryType || !entrySubtype) {
    return { error: 'employeeId, entryType, entrySubtype are required', status: 400 }
  }
  if (!['allowance', 'deduction'].includes(entryType)) {
    return { error: 'entryType must be allowance or deduction', status: 400 }
  }
  const amt = parseFloat(amount)
  if (Number.isNaN(amt) || amt < 0) {
    return { error: 'amount must be a non-negative number', status: 400 }
  }
  const row = await repo.upsertEntry({
    periodId,
    employeeId,
    entryType,
    entrySubtype,
    amount: amt,
    source: source || 'manual',
    notes: notes || null,
    createdBy: createdBy || null
  })
  return { entry: row }
}

export async function listEntries(periodId) {
  const period = await repo.getPeriodById(periodId)
  if (!period) return { error: 'Period not found', status: 404 }
  const entries = await repo.listEntriesByPeriod(periodId)
  return { entries }
}

export async function deleteEntry(id) {
  await repo.deleteEntry(id)
  return { deleted: true }
}

// ---------- Bulk import from Excel/CSV ----------

/**
 * Two accepted sheet shapes:
 *   1. FLAT  — columns: Employee Code (or Employee ID), Entry Type, Subtype, Amount, Notes (opt)
 *   2. GRID  — columns: Employee Code (or ID) + Name (opt), then one column per subtype.
 *              Subtype column header must match one of the known subtypes (case-insensitive,
 *              spaces → underscores). Amounts auto-detected as allowance vs deduction.
 *
 * Allowance subtypes:  overtime, incentives_kpi, arrears, incremental_arrears, other_allowance
 * Deduction subtypes:  income_tax, loan, salary_advance, other_deduction, device_deduction,
 *                      cellphone_installment, foodpanda, fuel_overusage,
 *                      over_utilization_mobile, pandemic, leaves
 */
const ALLOWANCE_SUBTYPES = new Set([
  'overtime', 'incentives_kpi', 'arrears', 'incremental_arrears', 'other_allowance'
])
const DEDUCTION_SUBTYPES = new Set([
  'income_tax', 'loan', 'salary_advance', 'other_deduction', 'device_deduction',
  'cellphone_installment', 'foodpanda', 'fuel_overusage', 'over_utilization_mobile',
  'pandemic', 'leaves'
])
const SUBTYPE_ALIASES = {
  // common header variants → canonical subtype
  'overtime': 'overtime',
  'incentives kpi': 'incentives_kpi',
  'kpi': 'incentives_kpi',
  'kpi incentive': 'incentives_kpi',
  'incentive kpi': 'incentives_kpi',
  'arrears': 'arrears',
  'incremental arrears': 'incremental_arrears',
  'other allowance': 'other_allowance',
  'income tax': 'income_tax',
  'tax': 'income_tax',
  'loan': 'loan',
  'salary advance': 'salary_advance',
  'advance salary': 'salary_advance',
  'other deduction': 'other_deduction',
  'device deduction': 'device_deduction',
  'cellphone installment': 'cellphone_installment',
  'mobile installment': 'cellphone_installment',
  'foodpanda': 'foodpanda',
  'foodpanda deduction': 'foodpanda',
  'fuel overusage': 'fuel_overusage',
  'fuel overusage deduction': 'fuel_overusage',
  'over utilization mobile': 'over_utilization_mobile',
  'over utilization of mobile': 'over_utilization_mobile',
  'mobile over utilization': 'over_utilization_mobile',
  'pandemic': 'pandemic',
  'pandemic deduction': 'pandemic',
  'leaves': 'leaves',
  'leaves deduction': 'leaves'
}

function canonicalSubtype(label) {
  if (!label) return null
  const key = String(label).trim().toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ')
  return SUBTYPE_ALIASES[key] || (ALLOWANCE_SUBTYPES.has(key.replace(/\s+/g, '_')) || DEDUCTION_SUBTYPES.has(key.replace(/\s+/g, '_')) ? key.replace(/\s+/g, '_') : null)
}

function entryTypeOf(subtype) {
  if (ALLOWANCE_SUBTYPES.has(subtype)) return 'allowance'
  if (DEDUCTION_SUBTYPES.has(subtype)) return 'deduction'
  return null
}

async function resolveEmployeeId(codeOrId) {
  if (codeOrId == null || codeOrId === '') return null
  const raw = String(codeOrId).trim()
  if (!raw) return null
  // Try by code first (string match), then by id
  const byCode = await executeQuery(
    'SELECT employee_id FROM employees WHERE employee_code = $1 LIMIT 1',
    [raw]
  )
  if (byCode[0]) return byCode[0].employee_id
  const asInt = parseInt(raw, 10)
  if (!Number.isNaN(asInt)) {
    const byId = await executeQuery('SELECT employee_id FROM employees WHERE employee_id = $1 LIMIT 1', [asInt])
    if (byId[0]) return byId[0].employee_id
  }
  return null
}

export async function uploadEntries(periodId, file, createdBy = null) {
  const period = await repo.getPeriodById(periodId)
  if (!period) return { error: 'Period not found', status: 404 }
  if (period.status === 'published' || period.status === 'closed') {
    return { error: 'Cannot upload entries to a published/closed period', status: 400 }
  }
  if (!file || !file.buffer) return { error: 'No file uploaded', status: 400 }

  const isCsv = /\.csv$/i.test(file.originalname || '')
  const wb = isCsv
    ? XLSX.read(file.buffer.toString('utf8'), { type: 'string', raw: true })
    : XLSX.read(file.buffer, { type: 'buffer', cellDates: false })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) return { error: 'File has no sheets', status: 400 }
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' })
  if (!rows || rows.length < 2) return { error: 'Sheet has no data rows', status: 400 }

  // Detect header row (first row containing "employee" in any cell)
  let headerRowIdx = 0
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    if ((rows[i] || []).some((c) => /employee/i.test(String(c || '')))) { headerRowIdx = i; break }
  }
  const headers = (rows[headerRowIdx] || []).map((h) => String(h || '').trim())
  const lower = headers.map((h) => h.toLowerCase())

  const codeIdx = lower.findIndex((h) => /(employee\s*(code|id))/i.test(h))
  if (codeIdx === -1) return { error: 'Header must contain "Employee Code" or "Employee ID"', status: 400 }

  const typeIdx = lower.findIndex((h) => h === 'entry type' || h === 'type')
  const subtypeIdx = lower.findIndex((h) => h === 'subtype' || h === 'entry subtype')
  const amountIdx = lower.findIndex((h) => h === 'amount')
  const notesIdx = lower.findIndex((h) => h === 'notes' || h === 'note')

  const isFlat = subtypeIdx !== -1 && amountIdx !== -1

  // Pre-map grid columns to canonical subtypes
  const gridCols = []
  if (!isFlat) {
    for (let i = 0; i < headers.length; i++) {
      if (i === codeIdx) continue
      const sub = canonicalSubtype(headers[i])
      if (sub) gridCols.push({ idx: i, subtype: sub, entryType: entryTypeOf(sub) })
    }
    if (!gridCols.length) {
      return { error: 'No recognised subtype columns found. Use a flat sheet (Employee Code, Subtype, Amount) or named columns (Foodpanda, Loan, Overtime, …)', status: 400 }
    }
  }

  let inserted = 0
  const errors = []
  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r] || []
    const codeOrId = row[codeIdx]
    if (!codeOrId) continue
    const empId = await resolveEmployeeId(codeOrId)
    if (!empId) { errors.push({ row: r + 1, message: `Employee not found: ${codeOrId}` }); continue }

    if (isFlat) {
      const rawSubtype = row[subtypeIdx]
      const subtype = canonicalSubtype(rawSubtype)
      if (!subtype) { errors.push({ row: r + 1, message: `Unknown subtype: ${rawSubtype}` }); continue }
      let entryType = typeIdx !== -1 ? String(row[typeIdx] || '').trim().toLowerCase() : null
      if (entryType !== 'allowance' && entryType !== 'deduction') entryType = entryTypeOf(subtype)
      if (!entryType) { errors.push({ row: r + 1, message: `Cannot infer type for ${rawSubtype}` }); continue }
      const amt = parseFloat(String(row[amountIdx] || '').replace(/,/g, ''))
      if (Number.isNaN(amt) || amt < 0) continue
      if (amt === 0) continue
      await repo.upsertEntry({
        periodId, employeeId: empId, entryType, entrySubtype: subtype,
        amount: amt, source: 'excel',
        notes: notesIdx !== -1 ? (String(row[notesIdx] || '').trim() || null) : null,
        createdBy
      })
      inserted++
    } else {
      // GRID — iterate every recognised column
      for (const col of gridCols) {
        const raw = row[col.idx]
        if (raw == null || raw === '') continue
        const amt = parseFloat(String(raw).replace(/,/g, ''))
        if (Number.isNaN(amt) || amt <= 0) continue
        await repo.upsertEntry({
          periodId, employeeId: empId, entryType: col.entryType, entrySubtype: col.subtype,
          amount: amt, source: 'excel', notes: null, createdBy
        })
        inserted++
      }
    }
  }

  return { inserted, errors }
}

// ---------- Run payroll ----------

export async function runPayroll(periodId, runBy = null) {
  const period = await repo.getPeriodById(periodId)
  if (!period) return { error: 'Period not found', status: 404 }
  if (!['draft', 'processed'].includes(period.status)) {
    return { error: `Cannot run payroll on a ${period.status} period`, status: 400 }
  }

  await repo.updatePeriodStatus(periodId, 'processing')
  await repo.deleteSlipsForPeriod(periodId) // re-runs replace prior slips

  // Refresh loan-installment entries first (so they're picked up below).
  await regenerateLoanInstallmentEntries(periodId, period)

  const employees = await repo.getActiveEmployeesForPeriod(period.start_date, period.end_date)
  const empIds = employees.map((e) => e.employee_id)
  const structureMap = await repo.getSalaryStructureMap(empIds)
  const leaves = await repo.getApprovedLeavesInRange(period.start_date, period.end_date)
  // Income-tax inputs (fetched once per run): active slab + each employee's salary-change timeline.
  const taxSlabs = await getActiveTaxSlabs().catch(() => [])
  const salaryChangeMap = await repo.getSalaryChangeHistoryMap(empIds)

  const slipsCreated = []
  const errors = []

  for (const emp of employees) {
    try {
      const slip = await computeSlipForEmployee({
        period,
        emp,
        structure: structureMap.get(emp.employee_id) || {},
        leaves: leaves.filter((l) => l.employee_id === emp.employee_id),
        taxSlabs,
        salaryChanges: salaryChangeMap.get(emp.employee_id) || []
      })
      await repo.upsertSlip(slip)
      slipsCreated.push(emp.employee_id)
    } catch (err) {
      console.error(`[auto-payroll] failed slip for emp ${emp.employee_id}:`, err.message)
      errors.push({ employeeId: emp.employee_id, message: err.message })
    }
  }

  await repo.updatePeriodStatus(periodId, 'processed')
  return {
    processed: slipsCreated.length,
    failures: errors.length,
    errors
  }
}

/** Build the slip row for one employee. Pure calculation — no DB writes here. */
async function computeSlipForEmployee({ period, emp, structure, leaves, taxSlabs = [], salaryChanges = [] }) {
  const periodStart = new Date(period.start_date)
  const periodEnd = new Date(period.end_date)
  const totalWd = period.working_days

  // Pro-ration based on join/leave dates
  const empJoin = emp.effective_join_date ? new Date(emp.effective_join_date) : null
  const empLeave = emp.effective_leave_date ? new Date(emp.effective_leave_date) : null
  const effStart = empJoin && empJoin > periodStart ? empJoin : periodStart
  const effEnd = empLeave && empLeave < periodEnd ? empLeave : periodEnd
  const effectiveWd = computeEffectiveWorkingDays(effStart, effEnd, periodStart, periodEnd, totalWd)
  const joinedInPeriod = !!(empJoin && empJoin >= periodStart && empJoin <= periodEnd)
  const leftInPeriod = !!(empLeave && empLeave >= periodStart && empLeave <= periodEnd)

  // Attendance from ICS (stubbed — see fetchIcsAttendance)
  const attendance = await fetchIcsAttendance(emp.employee_code, period.start_date, period.end_date)
  const icsAbsent = Number(attendance?.absent_days) || 0
  const icsLate = Number(attendance?.late_count) || 0
  const lateAbsent = Math.floor(icsLate / LATE_TO_ABSENT_DIVISOR)

  // Unpaid leaves intersecting period
  const unpaidLeaveDays = leaves
    .filter((l) => !l.is_paid)
    .reduce((sum, l) => sum + overlapDays(l.start_date, l.end_date, effStart, effEnd), 0)

  const rawAbsent = icsAbsent + lateAbsent + unpaidLeaveDays
  const absentDays = Math.min(Math.round(rawAbsent), effectiveWd)
  const paidDays = Math.max(0, effectiveWd - absentDays)

  // Earnings
  const s = structure || {}
  const basic = parseFloat(s.basic_salary) || 0
  const medical = parseFloat(s.medical_allowance) || 0
  const conveyanceFixed = parseFloat(s.conveyance_allowance) || 0
  const conveyanceLiters = parseFloat(s.conveyance_liters_allowance) || 0
  const communication = parseFloat(s.communication_allowance) || 0
  const houseRent = parseFloat(s.house_rent_allowance) || 0
  const utilities = parseFloat(s.utilities_allowance) || 0
  const mealAllow = parseFloat(s.meal_allowance) || 0
  const otherAllow = parseFloat(s.other_allowance) || 0
  const arrears = parseFloat(s.arrears) || 0
  const incrementalArrears = parseFloat(s.incremental_arrears) || 0
  const bikeMaint = parseFloat(s.bike_maintenance_allowance) || 0
  const incentivesTech = parseFloat(s.incentives) || 0
  const deviceReimb = parseFloat(s.device_reimbursement) || 0

  // Variable entries for this employee/period
  const entries = await repo.listEntriesByEmployeeAndPeriod(period.id, emp.employee_id)
  const entryMap = entriesToMap(entries)

  // Map variable allowances onto slip columns
  const overtime = entryMap.allowance.overtime || 0
  const incentivesKpi = entryMap.allowance.incentives_kpi || 0
  const extraArrears = entryMap.allowance.arrears || 0 // additive to structure arrears if any
  const extraIncrArrears = entryMap.allowance.incremental_arrears || 0
  const otherAllowFromEntries = entryMap.allowance.other_allowance || 0

  // Total allowances (every earning EXCEPT basic salary — basic kept separate for FBR treatment later)
  const totalAllowances =
    medical + conveyanceFixed + conveyanceLiters + communication + houseRent + utilities +
    overtime + mealAllow + (arrears + extraArrears) + (incrementalArrears + extraIncrArrears) +
    bikeMaint + incentivesTech + deviceReimb + incentivesKpi + (otherAllow + otherAllowFromEntries)

  const fullGross = basic + totalAllowances
  const dayRate = effectiveWd > 0 ? fullGross / effectiveWd : 0
  const grossActual = Math.round(dayRate * paidDays * 100) / 100
  const absentDeduction = Math.round(dayRate * absentDays * 100) / 100
  const lateDeduction = Math.round(dayRate * lateAbsent * 100) / 100 // informational only — already in absentDeduction

  // Deductions
  // Income tax: auto-calculated from the annualised projection (FY July–June). A manual income_tax
  // entry, if present, overrides the auto value (HR adjustment).
  const autoIncomeTax = computeMonthlyIncomeTax({
    payrollMonthDate: new Date(period.end_date), // payroll month = the period's end month
    joinDate: emp.effective_join_date || emp.join_date || null,
    currentGross: fullGross, // contractual monthly gross (pre-proration)
    salaryChanges,
    slabs: taxSlabs
  })
  const manualIncomeTax = entryMap.deduction.income_tax || 0
  const incomeTax = manualIncomeTax > 0 ? manualIncomeTax : autoIncomeTax
  const loanDed = entryMap.deduction.loan || 0
  const salaryAdvanceDed = entryMap.deduction.salary_advance || 0
  const otherDed = entryMap.deduction.other_deduction || 0
  const deviceDed = entryMap.deduction.device_deduction || 0
  const cellphoneInst = entryMap.deduction.cellphone_installment || 0
  const foodpanda = entryMap.deduction.foodpanda || 0
  const fuelOver = entryMap.deduction.fuel_overusage || 0
  const overUtilMobile = entryMap.deduction.over_utilization_mobile || 0
  const pandemic = entryMap.deduction.pandemic || 0
  const leavesDed = entryMap.deduction.leaves || 0

  const totalDeductions =
    incomeTax + loanDed + salaryAdvanceDed + otherDed + EOBI_FIXED +
    deviceDed + cellphoneInst + foodpanda + fuelOver + overUtilMobile +
    pandemic + leavesDed
  // NOTE: absentDeduction is reflected via grossActual (gross is pro-rated by paidDays), so it's
  // NOT added here to avoid double-counting. The column is stored for display only.

  const netSalary = Math.round((grossActual - totalDeductions) * 100) / 100

  return {
    period_id: period.id,
    employee_id: emp.employee_id,
    effective_working_days: effectiveWd,
    paid_days: paidDays,
    absent_days: absentDays,
    late_count: icsLate,
    late_absent_equivalent: lateAbsent,
    unpaid_leave_days: unpaidLeaveDays,
    joined_in_period: joinedInPeriod,
    left_in_period: leftInPeriod,
    basic_salary: prorate(basic, paidDays, effectiveWd),
    medical_allowance: prorate(medical, paidDays, effectiveWd),
    conveyance_fixed: prorate(conveyanceFixed, paidDays, effectiveWd),
    conveyance_liters: prorate(conveyanceLiters, paidDays, effectiveWd),
    communication: prorate(communication, paidDays, effectiveWd),
    house_rent: prorate(houseRent, paidDays, effectiveWd),
    utilities: prorate(utilities, paidDays, effectiveWd),
    overtime: overtime, // variable, not prorated
    meal_allowance: prorate(mealAllow, paidDays, effectiveWd),
    arrears: arrears + extraArrears,
    incremental_arrears: incrementalArrears + extraIncrArrears,
    bike_maintenance: prorate(bikeMaint, paidDays, effectiveWd),
    incentives_tech: prorate(incentivesTech, paidDays, effectiveWd),
    device_reimbursement: prorate(deviceReimb, paidDays, effectiveWd),
    incentives_kpi: incentivesKpi,
    other_allowance: prorate(otherAllow, paidDays, effectiveWd) + otherAllowFromEntries,
    income_tax: incomeTax,
    loan: loanDed,
    salary_advance: salaryAdvanceDed,
    other_deduction: otherDed,
    eobi: EOBI_FIXED,
    late_deduction: lateDeduction,
    absent_deduction: absentDeduction,
    device_deduction: deviceDed,
    cellphone_installment: cellphoneInst,
    foodpanda_deduction: foodpanda,
    fuel_overusage_deduction: fuelOver,
    over_utilization_mobile: overUtilMobile,
    pandemic_deduction: pandemic,
    leaves_deduction: leavesDed,
    tot_gross: grossActual,
    tot_allowances: Math.round(totalAllowances * 100) / 100,
    tot_deductions: Math.round(totalDeductions * 100) / 100,
    tot_net: netSalary,
    status: 'draft'
  }
}

function prorate(amount, paidDays, workingDays) {
  if (!amount || !workingDays) return 0
  return Math.round(((amount * paidDays) / workingDays) * 100) / 100
}

function entriesToMap(entries) {
  const out = { allowance: {}, deduction: {} }
  for (const e of entries) {
    if (e.entry_type === 'allowance') out.allowance[e.entry_subtype] = parseFloat(e.amount) || 0
    else if (e.entry_type === 'deduction') out.deduction[e.entry_subtype] = parseFloat(e.amount) || 0
  }
  return out
}

function computeEffectiveWorkingDays(effStart, effEnd, periodStart, periodEnd, totalWd) {
  if (effEnd < effStart) return 0
  if (effStart <= periodStart && effEnd >= periodEnd) return totalWd
  // Prorate by calendar-day ratio (period uses its own working_days definition).
  const periodCalDays = msToDays(periodEnd - periodStart) + 1
  const effCalDays = msToDays(effEnd - effStart) + 1
  if (periodCalDays <= 0) return totalWd
  const ratio = effCalDays / periodCalDays
  return Math.max(1, Math.round(totalWd * ratio))
}

function overlapDays(start, end, periodStart, periodEnd) {
  const s = new Date(start) > periodStart ? new Date(start) : periodStart
  const e = new Date(end) < periodEnd ? new Date(end) : periodEnd
  if (e < s) return 0
  return msToDays(e - s) + 1
}

function msToDays(ms) {
  return Math.floor(ms / (24 * 60 * 60 * 1000))
}

/**
 * Stub for ICS attendance API. Replace with real fetch once endpoint confirmed.
 * Expected return shape: { paid_days: number, absent_days: number, late_count: number }
 *
 * For now returns zeros so the rest of the flow works end-to-end. The user can
 * upload variable entries and review slips without attendance.
 */
async function fetchIcsAttendance(employeeCode, startDate, endDate) {
  // TODO: wire to actual ICS attendance endpoint (e.g. /attendance/by-emp.php?code=XXX&from=YYYY-MM-DD&to=YYYY-MM-DD)
  // For now return a no-op stub so the rest of the pipeline can be tested.
  return { paid_days: null, absent_days: 0, late_count: 0 }
}

// ---------- Loan installment auto-generation ----------

async function regenerateLoanInstallmentEntries(periodId, period) {
  // Wipe previously-generated loan rows for this period (manual entries are preserved).
  const existing = await repo.listEntriesByPeriod(periodId)
  for (const e of existing) {
    if (typeof e.source === 'string' && e.source.startsWith('loan_req:')) {
      await repo.deleteEntry(e.id)
    }
  }
  const activeLoans = await repo.getActiveLoanDeductionsForPeriod(period.end_date)

  for (const loan of activeLoans) {
    const approvedAmount = parseFloat(loan.approved_amount) || 0
    const installments = Math.max(1, parseInt(loan.approved_installments, 10) || 1)
    if (approvedAmount <= 0) continue
    const monthlyInstallment = Math.round((approvedAmount / installments) * 100) / 100
    const paid = await repo.countLoanInstallmentsPaid(loan.req_id, periodId)
    if (paid >= installments) continue // fully paid off in prior periods

    const remaining = approvedAmount - paid * monthlyInstallment
    const thisInstallment = Math.min(monthlyInstallment, Math.round(remaining * 100) / 100)
    if (thisInstallment <= 0) continue

    const subtype = String(loan.loan_advance_type || '').toLowerCase() === 'advance' ? 'salary_advance' : 'loan'

    await repo.upsertEntry({
      periodId,
      employeeId: loan.employee_id,
      entryType: 'deduction',
      entrySubtype: subtype,
      amount: thisInstallment,
      source: `loan_req:${loan.req_id}`,
      notes: `Installment ${paid + 1}/${installments} of approved ${approvedAmount}`,
      createdBy: null
    })
  }
}

// ---------- Slip review & publish ----------

export async function listSlips(periodId) {
  const period = await repo.getPeriodById(periodId)
  if (!period) return { error: 'Period not found', status: 404 }
  const slips = await repo.listSlipsByPeriod(periodId)
  return { slips }
}

export async function updateSlip(slipId, updates, updatedBy) {
  const slip = await repo.getSlipById(slipId)
  if (!slip) return { error: 'Slip not found', status: 404 }
  const allowed = new Set([
    'basic_salary', 'medical_allowance', 'conveyance_fixed', 'conveyance_liters',
    'communication', 'house_rent', 'utilities', 'overtime', 'meal_allowance',
    'arrears', 'incremental_arrears', 'bike_maintenance', 'incentives_tech',
    'device_reimbursement', 'incentives_kpi', 'other_allowance',
    'income_tax', 'loan', 'salary_advance', 'other_deduction', 'eobi',
    'device_deduction', 'cellphone_installment', 'foodpanda_deduction',
    'fuel_overusage_deduction', 'over_utilization_mobile', 'pandemic_deduction',
    'leaves_deduction', 'tot_gross', 'tot_allowances', 'tot_deductions', 'tot_net',
    'remarks', 'paid_days', 'absent_days'
  ])
  const sanitized = {}
  const changes = []
  for (const [k, v] of Object.entries(updates || {})) {
    if (!allowed.has(k)) continue
    sanitized[k] = v
    changes.push({ field: k, from: slip[k], to: v })
  }
  if (!Object.keys(sanitized).length) {
    return { error: 'No editable fields supplied', status: 400 }
  }
  const auditEntry = {
    at: new Date().toISOString(),
    by: updatedBy ?? null,
    changes
  }
  await repo.updateSlipFields(slipId, sanitized, auditEntry)
  return { updated: true }
}

export async function publish(periodId) {
  const period = await repo.getPeriodById(periodId)
  if (!period) return { error: 'Period not found', status: 404 }
  if (period.status !== 'processed') {
    return { error: `Only processed periods can be published (current: ${period.status})`, status: 400 }
  }
  await repo.publishSlipsForPeriod(periodId)
  await repo.updatePeriodStatus(periodId, 'published')
  return { published: true }
}

// ---------- Shaping ----------

function shapePeriod(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
    workingDays: row.working_days,
    status: row.status,
    createdAt: row.created_at,
    processedAt: row.processed_at,
    publishedAt: row.published_at,
    closedAt: row.closed_at,
    slipCount: row.slip_count
  }
}
