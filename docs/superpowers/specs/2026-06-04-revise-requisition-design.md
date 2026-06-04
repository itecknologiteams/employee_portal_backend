# Revise Requisition — design

**Date:** 2026-06-04
**Status:** Approved
**Module:** Requisition

## Problem

Procurement uploads quotations that have an expiry. Finance can take time to approve, and
the quotations expire before approval. The creator needs a way to re-issue the requisition
with a fresh reference so it can go through the flow again with new quotations.

## Decision

Add a **Revise** action on the creator's Requisition History. Revising creates a brand-new
requisition (a copy the creator may edit) with a revised reference, routed through the full
normal flow from HOD. The original is left untouched.

### Availability (Revise button shown / endpoint allows) — ALL must hold
1. The requisition belongs to the requesting creator.
2. The category **involves Procurement** (its flow has a non-skipped `procurement` stage).
3. The **required-by date has passed** (`req_required_by_date::date < CURRENT_DATE`).
4. The requisition is **not closed** (creator has not acknowledged / not fully closed) and **not rejected**.

### Behaviour
- Opens an edit-items form prefilled with the original's items; the creator may edit existing
  items and add new ones.
- On submit, a new requisition is created:
  - **Reference:** `{originalRef}-REV-{YYYYMMDD}-{NNN}` where `YYYYMMDD` is the revision date and
    `NNN` is the next revision number for that original (`001`, `002`, …), zero-padded to 3.
    Example: `REQ-20260518-00245-REV-20260604-001`.
  - Copies creator, location, category, business, required-by date (creator may change it via the form), urgent flag.
  - Items = the edited set submitted by the creator.
  - **Routed from the first stage (HOD)** exactly like a normal new requisition (full flow).
  - `req_revision_of` = original `req_id` (traceability link only).
- The **original requisition is unchanged** — no status change, no action.

## Data model
- `requisition` gains `req_revision_of INTEGER` (nullable; FK-style reference to the original `req_id`).
- The `req_reference_no` is inserted directly with the revised value; the existing DB trigger
  only auto-generates a reference when the column is blank, so the custom reference is preserved.

## Pure logic (unit-tested)
- `buildRevisionReference(originalRef, ymd, revNum)` → `` `${originalRef}-REV-${ymd}-${String(revNum).padStart(3,'0')}` ``.
- `canReviseRequisition({ isRejected, isClosed, requiredByDate, procurementInvolved, today })` →
  boolean (true only when procurementInvolved && requiredByDate passed && !isRejected && !isClosed).

## Backend
- **Repo:**
  - `getRequisitionForReviseById(reqId)` — original row + creator + category + required-by + status flags.
  - `countRevisionsOf(originalReqId)` — existing revisions, to compute the next `NNN`.
  - `createRevisionRequisition({...})` — insert the new requisition with the custom reference and `req_revision_of`.
  - `getProcurementInvolvedCategoryNames()` — category names whose flow includes a non-skipped procurement stage.
- **Service `reviseRequisition({ reqId, employeeId|employeeCode, items, requiredByDate })`:**
  - Resolve creator; load original; enforce: creator owns it, category procurement-involved,
    required-by passed, not rejected, not closed.
  - Compute reference via `buildRevisionReference` + next number; create revision + items;
    route from first stage (reuse existing routing → HOD).
- **History flag:** creator-history rows get a computed `can_revise` boolean.
- **Route:** `POST /requisition/:reqId/revise` (creator-only).

## Frontend (`RequisitionHistory.jsx`)
- A **Revise** button on rows where `can_revise` is true.
- Clicking opens a prefilled edit-items modal (edit existing + add new; optional new required-by date).
- Submit → `requisitionAPI.reviseRequisition(reqId, { items, requiredByDate, approvedByEmployeeCode })`
  → toast + refresh; the revision appears as a new history entry with the `-REV-` reference and flows normally.

## Testing
- Unit: `buildRevisionReference` formats correctly (padding, date, appended to original).
- Unit: `canReviseRequisition` truth table (each condition gates correctly).
- Integration: revise creates a new requisition with the right reference, `req_revision_of` set,
  items copied/edited, routed to HOD; original unchanged; guard rejects when conditions fail.

## Out of scope
- Cancelling/closing or otherwise changing the original requisition.
- Copying prior approvals (full restart from HOD, since items can change).
- Re-revising rules beyond incrementing `NNN` (a revision may itself be revised; `NNN` counts revisions of the immediate original reference).
