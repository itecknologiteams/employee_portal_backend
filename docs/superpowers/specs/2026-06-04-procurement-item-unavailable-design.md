# Procurement "item unavailable" + Committee review — design

**Date:** 2026-06-04
**Status:** Approved (pending spec review)
**Module:** Requisition (Procurement)

## Problem

At the Procurement stage, some requisition items may be unavailable at the vendor.
Procurement needs to set such an item aside and continue processing the rest, while the
business decides whether the item is truly required. Today an item can only be edited by
the HOD/IT before approval; there is no way for Procurement to remove a single item from
processing without losing it, and no way to flag it for everyone to see.

## Goal

1. At the Procurement stage, Procurement can **Delete** an item (mark it *unavailable at vendor*) with a **mandatory reason**. The item is **not** removed from the database.
2. The flagged item is sent to the **Committee for review**. Procurement keeps processing the other (available) items in parallel — flagging is non-blocking.
3. The Committee decides:
   - **Required** → the item is re-included (kept in the order). Because the approved total goes **up**, a CEO re-check applies (see below).
   - **Not required** → the item is **dropped** (excluded from processing and all totals).
4. Excluded items are shown in **red everywhere** requisition details appear — every stage card and modal, history, and reports — so everyone knows the item is unavailable.
5. **Every action is recorded in an audit trail** with full detail, visible wherever requisition details are shown.

## Item state model

A per-item status drives behaviour:

```
active ──(Procurement: Delete + reason)──▶ pending_review ──(Committee: Not required)──▶ dropped
  ▲                                            │  │
  └──(Committee: Required)─────────────────────┘  └──(Procurement: Restore / undo)──▶ active
```

- **active** — normal item; counted in all totals; normal colour.
- **pending_review** — flagged unavailable by Procurement (with reason); **excluded from all totals**; shown **red** with label "Pending committee review"; appears in the Committee review queue.
- **dropped** — Committee decided "Not required"; **excluded**; shown **red** with label "Removed — not available at vendor: \<reason\>"; terminal.

"Excluded" = status in (`pending_review`, `dropped`). Excluded items are removed from
sales-tax, grand-total, and committee-approved line-total calculations, and rendered red.

## CEO re-check rule

When the Committee acts on a flagged item, recompute the approved total and compare to the
total **immediately before** the decision:

- **Not required** → total unchanged or lower → **skip CEO → Procurement**.
- **Required** → excluded item re-included → total goes **up** (`previous < new`) → **CEO approval required again**, then continue to Procurement.

This only re-routes through CEO when the total increases (re-including an item). Dropping
items never adds a CEO step. The absolute PKR 100,000 first-time rule is unchanged.

## Data model

### `requisition_items` — new columns (migration)
| Column | Type | Purpose |
|--------|------|---------|
| `item_review_status` | VARCHAR(20) DEFAULT 'active' | `active` \| `pending_review` \| `dropped` |
| `item_unavailable_reason` | VARCHAR(255) | Procurement's reason (required on flag) |
| `item_flagged_by` | INTEGER | employee who flagged |
| `item_flagged_at` | TIMESTAMP | when flagged |
| `item_reviewed_by` | INTEGER | committee member who decided |
| `item_reviewed_at` | TIMESTAMP | when decided |

Backfill existing rows to `active`. All reads use `SELECT *`, so the fields propagate to
existing item consumers automatically.

### `requisition_item_events` — new audit table
Full, append-only history of every action so "every small detail is noticed".

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PK | |
| `req_id` | INTEGER | requisition |
| `item_id` | INTEGER | item acted on |
| `event_type` | VARCHAR(32) | `flagged_unavailable` \| `restored` \| `committee_required` \| `committee_not_required` |
| `reason` | VARCHAR(255) | reason / decision note |
| `amount_before` | NUMERIC | approved total before the action |
| `amount_after` | NUMERIC | approved total after the action |
| `ceo_required` | BOOLEAN | whether this action re-triggered CEO |
| `actor_employee_id` | INTEGER | who performed it |
| `created_at` | TIMESTAMP DEFAULT now() | |

Created defensively (no-op if the table is missing, mirroring `requisition_comments`).

## Backend

### Repository (`requisition.repository.js`)
- `flagItemUnavailable(itemId, reqId, reason, employeeId)` → set `pending_review` + audit.
- `restoreItem(itemId, reqId, employeeId)` → set `active` + audit (only from `pending_review`).
- `reviewItem(itemId, decision, employeeId)` → set `active` (required) or `dropped` (not_required) + audit.
- `getItemsPendingReview()` → flagged items joined with requisition + creator + reason for the Committee queue.
- `getItemEventsByReqIds(reqIds)` → audit entries for display (Map by req_id), like `getRequisitionCommentsByReqIds`.
- Helper to compute the current approved total for a requisition (reuse `computeCommitteeApprovedLineTotalPKR` over non-excluded items).

### Service (`requisition.service.js`)
- `flagProcurementItemUnavailable({ itemId, reason, employeeId })` — guard: actor is Procurement, requisition is at/after procurement stage, reason non-empty; flag; notify Committee; audit.
- `restoreProcurementItem({ itemId, employeeId })` — guard Procurement; restore; audit.
- `reviewFlaggedItem({ itemId, decision, employeeId })` — guard Committee; compute before/after totals; if `required` and new > previous set requisition stage to `ceo` (else leave at procurement); refresh item taxes; notify Procurement + creator; audit.
- `getItemReviewQueue(employeeId)` — Committee-only list.
- Item lists returned to the frontend include `item_review_status` and `item_unavailable_reason` (already via `SELECT *`).

### Totals (`requisition.utils.js`)
Add an `isItemExcluded(item)` helper (`item_review_status` in pending_review/dropped) and skip
excluded items in `computeItemTaxAmountPkr` callers, `computeItGrandTotalWithTaxPkr`, and
`computeCommitteeApprovedLineTotalPKR`. `refreshRequisitionItemTaxes` skips excluded items.

### Routes
- `POST /requisition/item/:itemId/flag` → flag (body: `reason`).
- `POST /requisition/item/:itemId/restore` → restore.
- `GET  /requisition/pending/item-review/:employeeCode` → committee queue.
- `POST /requisition/item/:itemId/review` → committee decision (body: `decision`).

### Notifications
- On flag → notify Committee members (in-app + branded email): item, requisition ref, reason.
- On decision → notify Procurement + creator (in-app + email): item, decision, and CEO note if applicable.

## Frontend

### Procurement stage (`RequisitionPending.jsx`)
- Per **active** item: a **Delete** button → opens a small inline reason input (required) → calls flag endpoint.
- Per **pending_review** item: a **Restore** button → calls restore endpoint.
- Excluded items remain listed (read-only) in red.

### Committee
- New **"Items pending review"** panel (own queue from `getItemReviewQueue`): each row shows item details, requisition reference, and Procurement's reason, with **Required** / **Not required** buttons. On action, show whether CEO re-approval was triggered.

### Universal red rendering + audit display
- A shared helper marks excluded items red with the correct label across all item tables/cards/modals in `RequisitionPending.jsx`, `RequisitionReports.jsx`, and any requisition-detail/history view.
- Excluded items are dropped from any **frontend** total calculations.
- The audit trail (`requisition_item_events`) is shown in the requisition detail/history view as a chronological list (action, item, reason, who, when, amount before→after, CEO note), alongside existing stage comments.

## Testing
- **Unit (`requisition.utils.js`):** totals exclude `pending_review` and `dropped`; `active` counted.
- **Unit:** state transitions — flag→pending_review, restore→active, review required→active, review not_required→dropped.
- **Unit:** CEO re-check — "required" raising the total sets next stage to `ceo`; "not required" keeps procurement.
- **Integration:** repo writes correct columns and an audit row per action; role/stage guards reject invalid callers.

## Out of scope
- Changing the first-time CEO threshold logic (PKR 100,000) for new requisitions.
- Letting roles other than Procurement flag items, or flagging before the procurement stage.
