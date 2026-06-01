# Sales Tax on IT Equipment Requisition Items — Design

**Date:** 2026-06-01
**Author:** ali.asif (with Claude Code)
**Status:** Approved design, pending implementation plan
**Repos:** `Emp_Portal_BackEnd` (backend + DB) and `Emp_Portal_FrontEnd` (modals)

## Problem

Requisition items in the **IT Equipments** category should carry sales tax. Today each
requisition item stores a unit price (`item_est_cost`) and a quantity (`item_qty`); the line
total (`qty × unit price`) is computed on the fly and there is no tax applied or displayed.
Finance/employees need each IT Equipment item to show its tax amount and a taxed total.

## Decisions (locked)

- **Tax rate:** 18% (Pakistan GST on goods), stored as a fixed constant in code.
- **Tax base:** the *effective/latest* price — HOD-revised unit price when present, else the
  employee's `item_est_cost`, multiplied by the effective quantity
  (`committee_approved_qty` when present, else `item_qty`). This matches how line totals are
  already computed for the CEO-threshold rule.
- **Scope:** IT Equipments category only. Other categories are unaffected.
- **Persistence approach (Approach A):** store the tax in a real DB column and refresh it on
  every price/quantity write, so it always reflects the latest effective price and is
  queryable in SQL.
- **Delivery:** backend + frontend modals together.

## Approach (chosen: A — stored column, refreshed on every price/qty change)

Rejected alternatives:
- **B — compute on read, no column:** always correct but no physical/queryable column;
  contradicts the requirement for a DB column.
- **C — store once at creation:** simple but would not reflect HOD/Committee revisions,
  contradicting the "effective/latest price" decision.

## Design

### 1. Data model

Add one column to `requisition_items`:

```sql
ALTER TABLE requisition_items
  ADD COLUMN IF NOT EXISTS item_tax_amount NUMERIC(14,2);
```

- `NULL` for non-IT-Equipment items and for IT items that have no priced cost yet.
- For IT Equipment items with a price: `round(effectiveUnitPrice × effectiveQty × 0.18)`.
- Migration file: `database/migrations/add_item_tax_amount_to_requisition_pg.sql`.

### 2. Shared computation (single source of truth)

In `src/utils/requisition.utils.js`:

- `export const REQUISITION_SALES_TAX_RATE = 0.18`
- `export function isItEquipmentCategory(category)` → true when the category, trimmed and
  lowercased, equals `'it equipments'`.
- `export function computeItemTaxAmountPkr(item)` → returns
  `Math.round(effectiveUnitPrice × effectiveQty × REQUISITION_SALES_TAX_RATE)`, where
  `effectiveUnitPrice = getEffectiveUnitPricePkrFromItem(item)` and
  `effectiveQty = committee_approved_qty ?? item_qty`. Returns `null` when the effective unit
  price is `null` (no priced cost yet).
- `export function computeItGrandTotalWithTaxPkr(items)` → sum of
  `(lineTotal + itemTax)` across items, for the requisition-level taxed grand total.

The **taxed item total** = `lineTotal + item_tax_amount`.

### 3. Write paths that persist `item_tax_amount`

Recompute and persist `item_tax_amount` whenever an item's price or quantity changes, but
**only for the IT Equipments category**. For all other categories, explicitly write `NULL`
so a category never carries a stale tax value.

1. **Create requisition** — the item-insert path used by `createRequisition`.
2. **HOD edit / add item** — `editItems` (`src/services/requisition.service.js`) and
   `addItemByHod`.
3. **HOD BOQ revise** — the path that sets `hod_item_est_cost`.
4. **Committee revise** — the path that sets `committee_approved_qty`.

Implementation note: the category is per-requisition (`req_category`), so each write path must
read the requisition's category and pass it to the helper to decide whether to populate or
`NULL` the column.

### 4. API exposure

Wherever requisition item rows are returned to the modals (detail / track / pending
endpoints in `requisition.service.js` and `requisition.controller.js`), include:

- `item_tax_amount` (the stored column).
- a per-item `taxed_total` (`lineTotal + item_tax_amount`).
- a requisition-level `grand_total_with_tax` for IT Equipment requisitions.

### 5. Frontend (Emp_Portal_FrontEnd)

In `src/components/RequisitionViewModal.jsx` (and the equivalent item tables in
`Requisition.jsx`, `RequisitionPending.jsx`, `RequisitionHistory.jsx` as applicable):

- Add a **Tax (PKR)** column and a **Taxed total (PKR)** column, shown **only when the
  requisition's category is IT Equipments**.
- Add a **Grand total incl. tax** row alongside the existing grand-total row.
- Non-IT categories render exactly as today (no new columns).

The frontend reads the stored/returned values rather than recomputing tax, keeping display
consistent with the database and any reports.

## Edge cases

- **No price yet:** if `item_est_cost` is empty, tax is `NULL` until a price is entered; it
  populates once HOD/employee enters a cost (via the write paths above).
- **Category change:** not currently supported in the flow, but if an item is moved out of IT
  Equipments its tax must be set to `NULL`; covered by the "write NULL for non-IT" rule in
  every write path.
- **Rounding:** tax is rounded to the nearest whole PKR (consistent with existing line-total
  rounding via `Math.round`).

## Testing

- Unit tests for `computeItemTaxAmountPkr`: 18% math, `committee_approved_qty` overriding
  `item_qty`, HOD cost overriding `item_est_cost`, `null` when price absent, rounding.
- Integration: tax recomputes after an HOD price revise and after a Committee qty revise.
- Integration: a non-IT requisition stores `NULL` for `item_tax_amount` and the modal hides
  the tax columns.
- Frontend: IT Equipment modal shows Tax + Taxed total columns and the grand-total-incl-tax
  row; other categories unchanged.

## Out of scope

- Configurable/per-item tax rates (rate is a fixed 18% constant).
- Tax on non-IT-Equipment categories.
- Tax reporting/exports beyond exposing the column (column is queryable for future reports).
