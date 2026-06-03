# HOD leave routing to CEO — design

**Date:** 2026-06-03
**Status:** Approved

## Problem

When an HOD applies for their own leave, the system routes it to **HR** (`Pending HR`)
because an HOD cannot approve their own leave. The business rule should instead route
an HOD's own leave to the **CEO** for the substantive leave types.

## Decision

For an HOD applying for their **own** leave:

| Leave type (id)                                   | Routes to     |
|---------------------------------------------------|---------------|
| Casual (1), Sick (2)                              | `Pending HR`  |
| Annual (3), Marriage (4), Maternity (5), Paternal (6), Pilgrimage (7) | `Pending CEO` |

- **CEO approval is final** → `Approved` (deduct balance, sync ICS/CRM, notify applicant),
  mirroring how an HOD approving a normal employee's leave is already final.
- Senior executives (CEO/COO/Director) applying for their own leave continue to route to
  `Pending HR` — they cannot self-approve via the CEO queue.

## Current state (feature is ~80% built)

Already present: status `Pending CEO`, `leaveRepo.getPendingCeoLeaves()`,
`leaveService.getPendingCeo()`, controller `getPendingCeo`, route `/pending/ceo/:code`,
and the full frontend CEO queue (`LeaveApprovals.jsx`).

Missing (this work): creation routing, the `Pending CEO` approval branch, the CEO
creation notification, and a robustness fix in `getPendingCeoLeaves`.

## Changes (backend only)

### 1. Routing decision — split pure + async (`leave.service.js`)

- **Pure, exported, unit-testable:**
  `decideInitialLeaveStatus({ isSenior, isHod, leaveTypeId }) -> 'Pending' | 'Pending HR' | 'Pending CEO'`
  - `isSenior` → `'Pending HR'` (checked first, so a CEO never routes to themselves)
  - else `isHod` → Casual/Sick `'Pending HR'`, otherwise `'Pending CEO'`
  - else `'Pending'`
- **Async wrapper:** `resolveInitialLeaveStatus(employeeId, leaveTypeId)` resolves facts via
  `reqRepo.isSeniorExecutiveForLeave`, `reqRepo.getEmployeeDept` + `reqRepo.getHodByDepartment`
  (numeric compare), then calls the pure function.

Replaces the duplicated routing snippet in all three creation paths:
`createIcsLeaveRequest` (~1009), `createLeave` (~1133), `syncIcsLeaveToPortal` (~1774).

### 2. `updateLeaveStatus` — add `current === 'Pending CEO'` branch

Inserted before the final fallback. Mirrors the `Pending HR` block but gated by
`reqRepo.isCeoMember(eid)`. On Approve → `approveWithAnnualDeduction(leave, reqId, 'Pending CEO', 'Approved')`,
ICS/CRM sync, applicant notification ("approved by CEO"); non-CEO → 403.

### 3. Creation notification

When `initialStatus === 'Pending CEO'`, notify CEOs via
`notifRepo.getEmployeeIdsByRoleType('CEO')` with `type: 'leave_pending_ceo'`
(in-app; no hardcoded CEO email).

### 4. `getPendingCeoLeaves` robustness fix (`leave.repository.js`)

The `INNER JOIN employee_type et … = 'HOD'` filters every row, so a `Pending CEO` leave
from an HOD assigned via `employee_hod_departments` (not typed 'HOD') is hidden from the CEO.
Show all `status = 'Pending CEO'` rows regardless of the type join — the status already
encodes the routing decision.

## Testing

- Pure `decideInitialLeaveStatus`: HOD+Annual→`Pending CEO`; HOD+Casual/Sick→`Pending HR`;
  normal employee→`Pending`; senior exec→`Pending HR`; senior+HOD→`Pending HR`.
- State machine: `Pending CEO` + CEO approve → `Approved`; + non-CEO → 403.

## Out of scope

Frontend (already built), CEO approval email, changing Casual/Sick routing.
