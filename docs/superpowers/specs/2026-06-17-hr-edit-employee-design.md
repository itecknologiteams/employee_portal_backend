# HR edit/correct employee details

**Date:** 2026-06-17
**Status:** Approved
**Scope:** Backend (`Emp_Portal_BackEnd`) + Frontend (`Emp_Portal_FrontEnd`)

## Goal

Let HR correct an employee's details directly. An **"Edit details"** button on the HR Profile
Update Requests page (row + detail modal) opens a full edit form pre-filled with the employee's
current record; HR fixes any field and saves. Full record editable (personal + org fields).

## Backend (HR-authorized; the existing PUT /administration/employees/:id has no role check)

- Service `profile.service.js`:
  - `hrGetEmployeeForEdit(hrEmployeeId, employeeId)` — verify `isHrMember(hrEmployeeId)` (else 403),
    return `adminRepo.getEmployeeById(employeeId)[0]` (full record incl. department_id,
    designation_id, employee_type_id, station_id, city_id + personal fields, dates as YYYY-MM-DD).
  - `hrUpdateEmployee(hrEmployeeId, employeeId, fields)` — verify `isHrMember`, then delegate to
    `adminService.updateEmployee(employeeId, fields)` (validates, updates all fields, auto-logs a
    before→after diff to employee history).
- Controller `profile.controller.js`: `hrGetEmployee`, `hrUpdateEmployee`.
- Routes: `GET /profile/hr-employee/:employeeId?hrEmployeeId=`, `POST /profile/hr-update-employee`.

## Frontend

- `api.js`: `hrGetEmployee(employeeId, hrEmployeeId)`, `hrUpdateEmployee(payload)`.
- New `EditEmployeeModal.jsx` opened from the HR Profile Update Requests page: loads the employee
  (prefill) + dropdown options (departments/designations/employee types/stations/cities via the
  existing administrationAPI GETs), renders the full field set, Save → `hrUpdateEmployee` →
  toast + refresh.
- HRProfileRequests.jsx: "Edit details" button per row and in the detail modal.

## Auth & audit

- New endpoints require the caller to be an HR member (`isHrMember`). SuperAdmin keeps using
  Administration. Every save is logged to employee history (before→after) by `updateEmployee`.

## Out of scope

- Employees still submit update requests; this is an HR-side direct correction tool.
- No change to the SuperAdmin Administration employee management.
