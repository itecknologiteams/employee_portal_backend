# Automated Payroll System — Design

**Status:** Draft, in active implementation. Revisions allowed throughout build.

## Goal

A fully automated payroll page (`/payroll/automated`) that runs alongside the existing payroll system, so it can be built and tested in isolation. HR clicks one button per month → system computes correct slips for every active employee, pulling data automatically from ICS attendance, leave requests, and approved loan requisitions. Variable items (Foodpanda, KPI bonus, etc.) entered through a structured "entries" UI.

## Scope

**In scope**
- Pakistan-based payroll, monthly cycle
- All 16 earning elements + 14 deduction elements as already defined in the existing salary slip
- ICS attendance auto-pull (paid days, absent days, late count)
- Loan/Salary Advance auto-deduction from approved requisitions at Creator Acknowledgment stage
- Variable monthly entries (allowances + deductions) via dedicated UI + Excel upload
- Mid-month joiners/leavers prorated automatically
- Per-slip override + audit log before publishing
- Manual "Run Payroll" trigger (no cron)

**Out of scope (initially)**
- Income tax auto-calculation — TBD, HR enters manually for now (slabs already exist; tax logic to be decided later with user)
- External integrations for Foodpanda/Fuel APIs — handled via entries table
- Replacing the existing payroll system — new system runs alongside until proven

## Key decisions

1. **Isolation:** Separate tables (`auto_payroll_period`, `auto_payroll_slip`, `payroll_entry`), separate service file, separate page. Existing payroll system untouched.
2. **Attendance source:** ICS attendance API (same source as leave management).
3. **Loan trigger:** Loan/Salary Advance deduction begins when its requisition reaches the Creator Acknowledgment stage (i.e. `req_hr_check_approved_by IS NOT NULL` AND `req_creator_acknowledged != 1`). Monthly installment = `req_hr_approved_amount / req_hr_approved_installments` until total paid off.
4. **Variable deductions** (Foodpanda, Fuel Overusage, Cellphone Installment, Device Deduction, Over-utilization Mobile, Pandemic, Other Deduction): single `payroll_entry` table per (period, employee, type, subtype, amount). HR enters via UI or Excel upload.
5. **Variable allowances** (Overtime, Incentives KPI, Arrears, Incremental Arrears, etc.): same `payroll_entry` table, `entry_type = 'allowance'`.
6. **Late deduction:** Convert ICS late count → absent-equivalent. `floor(late_count / 3) = late_absent_days`. Added into absent total. No separate Late deduction column to avoid double-counting (or stored as informational only).
7. **EOBI:** Flat Rs. 130 per employee, hardcoded for now.
8. **Income Tax:** Manual entry per period via `payroll_entry` (TBD — automate later).
9. **Joiners/leavers:** Effective working days prorated from `employee.join_date` and termination date. Slip generated if employee was active for any day in period.
10. **Trigger:** Manual "Run Payroll" button. HR reviews draft slips, can edit, then "Finalize & Publish".
11. **Active-only:** Slips are generated ONLY for employees with `is_active = true`. Inactive (terminated/resigned/archived) employees are skipped entirely — even if their `last_working_date` falls inside the period. HR re-activates the row temporarily if a back-dated slip is genuinely needed.

## Data model

### `auto_payroll_period`
- `id`, `name`, `start_date`, `end_date`, `working_days`, `status` (`draft`/`processing`/`processed`/`published`/`closed`), `created_at`, `created_by`, `processed_at`, `published_at`

### `payroll_entry`
- `id`, `period_id` (FK), `employee_id` (FK), `entry_type` (`allowance` | `deduction`), `entry_subtype` (e.g. `foodpanda`, `kpi_incentive`, `income_tax`, `other_deduction`), `amount`, `source` (`manual` / `excel` / `loan_req:{req_id}`), `notes`, `created_at`, `created_by`

### `auto_payroll_slip`
- `id`, `period_id`, `employee_id`, `effective_working_days`, `paid_days`, `absent_days`, `late_count`, `late_absent_equivalent`
- All 16 earning columns (basic_salary, medical, …, other_allowance) — denormalized for reporting
- All 14 deduction columns (income_tax, loan, …, leaves)
- `tot_gross`, `tot_allowances`, `tot_deductions`, `tot_net`
- `status` (`draft`/`overridden`/`published`)
- `remarks`, `audit_log` (jsonb — array of {by, at, field, old, new})

## Flow

```
HR opens /payroll/automated
  → create period (May 2026, dates, working_days)
  → (optional) load variable entries (allowances + deductions) via UI or Excel
  → click "Run Payroll"
       For each active employee:
         a. Eligibility: joined ≤ period_end AND (no termination OR terminated ≥ period_start)
         b. effective_wd = prorated working days based on join/term dates
         c. attendance = fetchICSAttendance(emp, period) → paid_days, absent_days, late_count
         d. late_absent = floor(late_count / 3)
         e. unpaid_leaves = leave_requests where unpaid → add to absent_days
         f. total_absent = absent_days + late_absent + unpaid_leaves (capped at effective_wd)
         g. final_paid_days = effective_wd − total_absent
         h. gross_full = basic + sum(structure_allowances) + sum(variable_allowances_for_period)
         i. gross_actual = gross_full × (final_paid_days / effective_wd)
         j. deductions:
              - EOBI = 130
              - loan = sum of active loan installments
              - variable_deductions = sum of payroll_entry rows (entry_type='deduction')
              - income_tax = from payroll_entry (manual for now)
         k. net = gross_actual − total_deductions
         l. insert/update auto_payroll_slip
  → HR reviews slips on dashboard
       - inline edit any field → audit_log entry added
  → "Finalize & Publish" → status='published' → visible to employees
```

## API endpoints

```
POST   /api/auto-payroll/periods                  → create period
GET    /api/auto-payroll/periods                  → list periods
GET    /api/auto-payroll/periods/:id              → get one (with slips)
DELETE /api/auto-payroll/periods/:id              → delete (draft only)

POST   /api/auto-payroll/periods/:id/entries      → add entry (allowance/deduction)
POST   /api/auto-payroll/periods/:id/entries/upload → Excel upload
GET    /api/auto-payroll/periods/:id/entries      → list entries
DELETE /api/auto-payroll/entries/:id              → delete

POST   /api/auto-payroll/periods/:id/run          → run payroll
GET    /api/auto-payroll/periods/:id/slips        → list slips
PATCH  /api/auto-payroll/slips/:id                → edit slip (logs audit)
POST   /api/auto-payroll/periods/:id/publish      → publish
```

## Frontend page

Single route `/payroll/automated` with these tabs/sections:
1. **Periods** — list + create new period
2. **Selected period view:**
   - Header: period info + status badge + actions (Run / Publish / Delete)
   - **Entries** tab: variable allowances + deductions (table + bulk upload)
   - **Slips** tab: generated slips (table) + inline edit
   - **Audit** tab: read-only log of all overrides

## Open items / changes expected

- Income tax automation logic (FBR-compliant annualized method) — to be added later
- Late deduction display: store informationally in slip but don't double-count in totals
- Pandemic deduction & "Leaves" deduction subtypes — assumed manual via entries, user to confirm if different sources exist
- May extend `payroll_entry` to support recurring entries (e.g. fixed monthly deduction for an employee until X date)
