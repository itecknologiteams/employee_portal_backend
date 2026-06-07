# Annual Leaves — import + yearly allocation — design

**Date:** 2026-06-05
**Status:** Approved
**Module:** Leave Management

## Problem

Annual leave needs a clear yearly lifecycle: a new employee earns nothing in their first
year; at their 1-year anniversary they receive a prorated amount for the partial calendar year
they joined in; thereafter every January they get a fresh 14 days with the previous remaining
balance carried forward. HR also needs to bulk-import current annual balances from a sheet.

## Rules (confirmed)

- **Proration months** `N = max(0, 12 − joiningMonth)` (joining month excluded; 1-based month).
  August→4, September→3, November→1, December→0, January→11.
- **Prorated days** = `round((14 / 12) × N)`.
- **First year:** no annual leave until the 1-year service anniversary.
- **At the 1-year anniversary:** grant the prorated days (one time).
- **Each January thereafter:** carry the remaining annual into `carried_forward`, then reset
  `annual_leave` to 14.
- Allocation is **HR-triggered** (a button), idempotent, and safe to re-run / catch up late.

### Worked example — joined August 2025
| When | Action | annual_leave | carried_forward |
|------|--------|--------------|------------------|
| Aug 2025 – Aug 2026 | first year | 0 | — |
| Aug 2026 (1-yr) | proration `round(14/12×4)=5` | 5 | — |
| Jan 2027 | carry 5 → reset 14 | 14 | +5 |
| Jan 2028 | carry remaining → reset 14 | 14 | +remaining |

## Data model — `leave_balance` (migration)
| Column | Type | Purpose |
|--------|------|---------|
| `annual_proration_granted_at` | DATE | When the one-time anniversary proration was granted (NULL = not yet). |
| `annual_last_allocated_year` | INTEGER | Last calendar year the January full-14 allocation ran (idempotency). |

## Pure logic (`src/utils/annualLeave.js`, unit-tested)
- `annualProrationMonths(joinDate)` → `N`.
- `proratedAnnualDays(joinDate)` → `round((14/12) × N)`.
- `decideAnnualAllocation({ joinDate, prorationGrantedAt, lastAllocatedYear, today })` →
  `{ action: 'proration' | 'january_reset' | 'none', proratedDays?, year? }`:
  - `prorationGrantedAt` falsy: if `today ≥ joinDate + 1yr` → `proration` (with `proratedDays`, `year`); else `none`.
  - else: if `year(today) > lastAllocatedYear` → `january_reset` (with `year`); else `none`.

This guarantees idempotency: re-running on the same day produces `none` after the action is recorded.

## Backend

### Repository (`leave.repository.js`)
- `updateAnnualLeaveByEmployeeCode(code, annualDays)` — set annual balance from the import sheet
  (mirrors `updateCarriedForwardByEmployeeCode`; also initializes existing staff as
  `annual_proration_granted_at = CURRENT_DATE`, `annual_last_allocated_year = <current year>`
  so the import doubles as the existing-employee initialization → no retroactive proration).
- `getActiveEmployeesForAnnualAllocation()` — employees with join_date + current balance row
  fields (`annual_leave`, `carried_forward`, `annual_proration_granted_at`, `annual_last_allocated_year`).
- `applyAnnualProration(employeeId, proratedDays, today, year)` — set annual + stamp tracking.
- `applyAnnualJanuaryReset(employeeId, year)` — `carried_forward += annual_leave`, `annual_leave = 14`,
  set `annual_last_allocated_year = year`.

### Service (`leave.service.js`)
- `importAnnualLeavesOnly(hrEmployeeId, importRows)` — HR-only; per row `{ employeeCode, annual }`
  → `updateAnnualLeaveByEmployeeCode`; returns imported/failed summary (mirrors `importCarriedForwardOnly`).
- `runAnnualAllocation(hrEmployeeId, { today? })` — HR-only; for each active employee compute
  `decideAnnualAllocation` and apply; return a per-employee summary (prorated N days / reset / skipped)
  plus counts. `today` defaults to the server date (passed in for testability).

### Routes / Controller
- `POST /leave/hr/import-annual-leaves` → `importAnnualLeaves`
- `POST /leave/hr/run-annual-allocation` → `runAnnualAllocation`

## Frontend (`LeaveQuotaHR.jsx`)
- **Import Annual Leaves** button + CSV parse (`emp_code`, `annual_leaves`) → `leaveAPI.importAnnualLeaves`.
- **Run Annual Allocation** button → `leaveAPI.runAnnualAllocation` → toast with summary; placed beside
  the existing Carried-Forward import / Allocate-All / Rollover actions.

## Testing
- Unit: `annualProrationMonths` per joining month (Aug→4, Sep→3, Nov→1, Dec→0, Jan→11).
- Unit: `proratedAnnualDays` rounding (`14/12×4≈4.67→5`, `×3=3.5→4`, `×0=0`).
- Unit: `decideAnnualAllocation` state machine — first-year `none`; anniversary `proration`;
  next-year `january_reset`; same-day re-run `none` (idempotent).

## Out of scope
- Automatic scheduling (HR-triggered chosen). Carry-forward caps. The existing rolling
  `calculateProratedAnnualLeave` (left as-is; this new allocation is the authoritative yearly cycle).
