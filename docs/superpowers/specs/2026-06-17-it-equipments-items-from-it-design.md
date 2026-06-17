# IT Equipments — items provided by IT, not the creator/HOD

**Date:** 2026-06-17
**Status:** Approved
**Scope:** Backend (`Emp_Portal_BackEnd`) + Frontend (`Emp_Portal_FrontEnd`)

## Goal

For the **IT Equipments** category:
- A **non-IT** creator submits only **Date + Description** (Material/Summary) — no items.
- The **HOD** only approves (no items, no BOQ).
- The existing **IT stage** (after HOD) provides all requisition-item details (product, size,
  brand, qty, unit price). This UI already exists.
- An **IT-department** creator may still add items at creation (optional).

## Existing flow (no DB change)

`requisition_category_stage` already routes IT Equipments: HOD → **IT** (`it` stage behavior
`approval`) → Committee → CEO → Procurement → Finance.

## Backend — `requisition.service.js`

- `createRequisition`: for IT Equipments, if the creator is **not** an IT-department member
  (`isItDepartmentMember`), ignore any submitted items (force `[]`). IT members may add items
  (IT membership grants add-items for IT Equipments even without the generic
  `requisition_can_add_items` permission).
- `approveHod`: treat IT Equipments like the no-BOQ-at-HOD categories — approve and forward to
  the next stage (`it`) **without** requiring items/BOQ. The existing
  *"Requisition has no items"* (400) block must not apply to IT Equipments.

## Frontend — `Requisition.jsx` (creation)

- Fetch the creator's profile to derive `isItCreator` (department = "Information Technology",
  or employee type IT).
- Show the items section only when: not Loan, not Stationary, `canAddItems`, **and not
  (IT Equipments && !isItCreator)**. Non-IT creators of IT Equipments see only Date +
  Material/Description; submit sends `items: []`. Drop the "add at least one item" validation
  for that case.

## Frontend — `RequisitionPending.jsx` (HOD stage)

- For IT Equipments at HOD: hide the "No Items / must add items" warning, the Add/Edit-item
  buttons, and the HOD BOQ block. Show a note "Items & pricing will be added by IT." Keep
  Approve/Reject.

## Out of scope

- IT stage UI (already built); committee/ceo/procurement/finance stages; DB/flow config.

## Edge

If an IT creator pre-adds items at creation, HOD still just approves → the IT stage pre-fills
those items for pricing/review.
