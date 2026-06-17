# HR Profile Update Requests — official email + highlight changes

**Date:** 2026-06-17
**Status:** Approved
**Scope:** Backend (`Emp_Portal_BackEnd`) + Frontend (`Emp_Portal_FrontEnd`)

## Goals

1. **Official email**: show each requester's official company email (from CRM
   `ERP_Tracking.dbo.USERS`, via `getCrmEmailMapByEmployeeCodes`) in the HR Profile Update
   Requests list + modal, instead of the personal email stored on `employees`.
2. **Highlight changes**: in the modal, show which fields the employee actually changed —
   each changed field highlighted with **old → new** value, plus an "N field(s) changed"
   summary; a "N changed" badge on each list card. (Profile edit submits the whole profile,
   so changes are found by diffing `requested_data` against the employee's current values.)

## Backend

- Repo `getAllPendingProfileChangeRequests`: extend the query to also select the employee's
  current profile columns (phone, address, bio, position, dates, cnic_*, father_name, gender,
  marital_status, religion, grade, emergency_contact_number, employee_extension,
  personal_cell_number, join_date, profile_picture) and the department name.
- Service `getHrPendingProfileRequests`: for each row build `current_data` keyed exactly like
  `requested_data` (name → first+last, homeAddress → address, department → department_name,
  profileImage → profile_picture, etc. — the same mapping the approve-logic uses). Batch-fetch
  official emails via `getCrmEmailMapByEmployeeCodes(codes)` and attach `officialEmail` per row
  (null if CRM has none / is unreachable — fall back to stored email in UI).

## Frontend — `HRProfileRequests.jsx`

- List "Email" column: show `officialEmail || email`.
- Modal: header shows the official email. A `diffFields(requested, current)` helper normalizes
  per type (trim, dates as YYYY-MM-DD, null/'' = empty; image = changed only if a new image is
  submitted and differs). Each changed field is highlighted and shows old (struck/grey) → new
  (highlighted); unchanged fields render normally. Summary line: "N field(s) changed".
- List card: "N changed" badge computed from the same diff.

## Out of scope / notes

- No new DB column; official email is read-only from CRM (best-effort — CRM may be unreachable).
- `profileImage` can't be meaningfully diffed; marked changed only when a new image is submitted.
