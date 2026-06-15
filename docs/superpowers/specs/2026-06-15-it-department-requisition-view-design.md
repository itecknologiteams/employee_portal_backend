# IT Department-wide Requisition View (read-only) — Design

**Date:** 2026-06-15
**Status:** Approved (pending spec review)
**Scope:** Backend (`Emp_Portal_BackEnd`) + Frontend (`Emp_Portal_FrontEnd`)

## Problem

Today an employee's Requisition History shows only their own requisitions
(`req_emp_id = caller`). The IT department wants every IT member (employees **and** the
HOD) to be able to **view** each other's requisitions — strictly read-only, with **no**
acknowledgment or other action on colleagues' requisitions.

This applies to the **IT department only**.

## Identifying IT

- IT department is `department_id = 8` ("Information Technology"), set via a configurable
  env var **`IT_DEPARTMENT_ID`** (default may be 8). If unset/blank, the feature is off.
- **IT members** = employees with `department_id = IT_DEPARTMENT_ID`, UNION any employee who
  is HOD of that department (via `employee_hod_departments`). (The current IT HOD, emp 108,
  already has `department_id = 8`; the union is defensive for future HODs whose own dept differs.)

## UX — Requisition History page

- Add a toggle: **"My Requisitions"** (default) vs **"Department"**.
- The **Department** toggle is shown **only** when the caller is an IT member.
- **My** view: unchanged — own requisitions, with existing Revise/Acknowledge actions.
- **Department** view: lists **all** IT members' requisitions (full history: pending,
  approved, rejected, closed), **read-only**:
  - Adds a **Creator** column (employee name).
  - Renders **no** action buttons (no Revise; the view modal hides Acknowledge).
  - Search + pagination operate over the IT set.

## Backend

- `getHistory(employeeId, query)` accepts `query.scope` (`'my'` | `'department'`).
  - `'my'` (default): existing behavior. Response additionally includes
    `canViewDepartment: boolean` (true iff caller is an IT member) so the frontend knows
    whether to show the toggle.
  - `'department'`: authorize that the caller is an IT member; otherwise return
    `{ error: 'Not authorized for department view', status: 403 }`. Returns requisitions
    where `req_emp_id IN (IT member ids)`, each row tagged `employeeName` (creator) and
    `isOwn` (`req_emp_id === caller`).
- New repo helpers:
  - `getItDepartmentMemberIds()` → employee ids in IT (by dept) ∪ HOD(s) of IT.
  - `getTrackRecordsByMembers(memberIds, limit, offset, search)` + count — same shape/columns
    as `getTrackRecordsByEmployee`, joined to `employees` for creator name, excluding
    `is_hidden` rows, ordered by `req_created_at DESC`.
- Config: read `IT_DEPARTMENT_ID` from env. A small helper `getItDepartmentId()` returns the
  parsed integer or `null`.

## Enforcement (view-only)

- Department scope is enforced server-side (403 for non-IT callers).
- The Department view sends no action affordances.
- Even via direct API calls, the existing `revise` / `acknowledge` endpoints already check
  creator/permission, so a colleague cannot act on another's requisition.

## Out of scope

- No changes to approval/pending/committee/CEO flows, notifications, or other departments.
- No new sidebar page (reusing the History page per the chosen approach).

## Test plan

- IT member (emp 430), `scope=department`: sees requisitions of 108/430/494; rows carry
  `employeeName` + `isOwn`; non-own rows have no actions.
- IT member, `scope=my`: only own; response `canViewDepartment=true`.
- Non-IT member, `scope=my`: `canViewDepartment=false`.
- Non-IT member, `scope=department`: `403`.
- `IT_DEPARTMENT_ID` unset → `canViewDepartment=false` for everyone (feature off).
