# IT Equipment Sales Tax Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 18% sales tax to IT Equipment requisition items — stored in a DB column, recomputed on every price/qty change, and displayed in the requisition modals.

**Architecture:** A new `item_tax_amount` column on `requisition_items` holds the tax. Pure helpers in `requisition.utils.js` compute the tax (18% × effective unit price × effective qty). A single service function `refreshRequisitionItemTaxes(reqId)` reloads a requisition's items, recomputes tax for IT Equipment requisitions (NULL for all other categories), and persists each value via a new repo function. Every item write path calls this function after mutating items. The modals read the per-item `item_tax_amount` (already returned by `SELECT *` endpoints) and compute taxed line totals and a grand-total-incl-tax client-side.

**Tech Stack:** Node.js (ESM), PostgreSQL (`pg`), React (Vite) frontend. Tests via Node's built-in `node:test` runner (no new dependency).

**Spec:** `docs/superpowers/specs/2026-06-01-it-equipment-sales-tax-design.md`

**Note on scope refinement vs. spec:** The spec listed `taxed_total` / `grand_total_with_tax` as API fields. Because the modal already computes line totals and the grand total client-side ([RequisitionViewModal.jsx:131-175](src/components/RequisitionViewModal.jsx#L131-L175)), the plan instead exposes only the per-item `item_tax_amount` (via existing `SELECT *` queries) and computes taxed totals in the frontend. Same result, smaller backend surface.

---

## File Structure

**Backend (`Emp_Portal_BackEnd`):**
- Create: `database/migrations/add_item_tax_amount_to_requisition_pg.sql` — DB column.
- Modify: `src/utils/requisition.utils.js` — pure tax helpers.
- Create: `tests/requisition-tax.test.js` — unit tests for the helpers.
- Modify: `package.json` — add `test` script.
- Modify: `src/repositories/requisition.repository.js` — `updateItemTaxAmount`, include column in explicit SELECT.
- Modify: `src/services/requisition.service.js` — `refreshRequisitionItemTaxes` + wire into 6 write paths.

**Frontend (`Emp_Portal_FrontEnd`):**
- Modify: `src/components/RequisitionViewModal.jsx` — Tax + Taxed total columns, grand-total-incl-tax row (IT Equipments only).

---

## Task 1: DB migration — add `item_tax_amount`

**Files:**
- Create: `database/migrations/add_item_tax_amount_to_requisition_pg.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Add per-item sales tax amount (PKR) for IT Equipment requisition items.
-- NULL for non-IT-Equipment items and IT items with no priced cost yet.
ALTER TABLE requisition_items
  ADD COLUMN IF NOT EXISTS item_tax_amount NUMERIC(14,2);

COMMENT ON COLUMN requisition_items.item_tax_amount IS
  'Sales tax (PKR) = round(effective unit price x effective qty x 0.18). Populated for IT Equipments category only; NULL otherwise.';

SELECT 'item_tax_amount column added to requisition_items.' AS message;
```

- [ ] **Step 2: Apply the migration to the database**

Run (PowerShell, using the project's DB connection — adjust env var name if different):
```powershell
psql $env:DATABASE_URL -f database/migrations/add_item_tax_amount_to_requisition_pg.sql
```
Expected: `item_tax_amount column added to requisition_items.`

If `psql` is unavailable, run the SQL via the same path used for other migrations in `database/migrations/`.

- [ ] **Step 3: Verify the column exists**

Run:
```powershell
psql $env:DATABASE_URL -c "\d requisition_items"
```
Expected: output lists `item_tax_amount | numeric(14,2)`.

- [ ] **Step 4: Commit** (user will commit; if committing: `git add database/migrations/add_item_tax_amount_to_requisition_pg.sql`)

---

## Task 2: Pure tax helpers + unit tests (TDD)

**Files:**
- Modify: `src/utils/requisition.utils.js`
- Create: `tests/requisition-tax.test.js`
- Modify: `package.json`

- [ ] **Step 1: Add the `test` script to package.json**

In `package.json` `scripts`, add:
```json
    "test": "node --test"
```

- [ ] **Step 2: Write the failing tests**

Create `tests/requisition-tax.test.js`:
```javascript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  REQUISITION_SALES_TAX_RATE,
  isItEquipmentCategory,
  computeItemTaxAmountPkr,
  computeItGrandTotalWithTaxPkr
} from '../src/utils/requisition.utils.js'

test('tax rate is 18%', () => {
  assert.equal(REQUISITION_SALES_TAX_RATE, 0.18)
})

test('isItEquipmentCategory matches case/space-insensitively', () => {
  assert.equal(isItEquipmentCategory('IT Equipments'), true)
  assert.equal(isItEquipmentCategory('  it equipments '), true)
  assert.equal(isItEquipmentCategory('Stationary'), false)
  assert.equal(isItEquipmentCategory(null), false)
  assert.equal(isItEquipmentCategory(''), false)
})

test('computeItemTaxAmountPkr: 18% of unit price x qty, rounded', () => {
  // 1000 * 2 * 0.18 = 360
  assert.equal(computeItemTaxAmountPkr({ item_est_cost: '1000', item_qty: 2 }), 360)
})

test('computeItemTaxAmountPkr: HOD revised cost overrides est_cost', () => {
  // hod cost 500 used instead of est 1000 -> 500 * 2 * 0.18 = 180
  assert.equal(computeItemTaxAmountPkr({ item_est_cost: '1000', hod_item_est_cost: '500', item_qty: 2 }), 180)
})

test('computeItemTaxAmountPkr: committee_approved_qty overrides item_qty', () => {
  // qty 3 used instead of 2 -> 1000 * 3 * 0.18 = 540
  assert.equal(computeItemTaxAmountPkr({ item_est_cost: '1000', item_qty: 2, committee_approved_qty: 3 }), 540)
})

test('computeItemTaxAmountPkr: null when no priced cost', () => {
  assert.equal(computeItemTaxAmountPkr({ item_est_cost: '', item_qty: 2 }), null)
  assert.equal(computeItemTaxAmountPkr({ item_qty: 2 }), null)
})

test('computeItemTaxAmountPkr: rounds to nearest whole PKR', () => {
  // 999 * 1 * 0.18 = 179.82 -> 180
  assert.equal(computeItemTaxAmountPkr({ item_est_cost: '999', item_qty: 1 }), 180)
})

test('computeItGrandTotalWithTaxPkr: sums line totals + tax', () => {
  const items = [
    { item_est_cost: '1000', item_qty: 2 }, // line 2000 + tax 360 = 2360
    { item_est_cost: '500', item_qty: 1 }   // line 500 + tax 90 = 590
  ]
  assert.equal(computeItGrandTotalWithTaxPkr(items), 2950)
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `REQUISITION_SALES_TAX_RATE`, `isItEquipmentCategory`, etc. are not exported.

- [ ] **Step 4: Implement the helpers**

In `src/utils/requisition.utils.js`, the file already imports `getEffectiveUnitPricePkrFromItem` from `./requisitionAmountParse.js`. Add after the existing `REQUISITION_CEO_MIN_AMOUNT_PKR` export:

```javascript
/** Sales tax rate applied to IT Equipment requisition items (Pakistan GST on goods). */
export const REQUISITION_SALES_TAX_RATE = 0.18

/** True when the category is the IT Equipments category (case/space-insensitive). */
export function isItEquipmentCategory(category) {
  if (category == null || category === '') return false
  return String(category).trim().toLowerCase() === 'it equipments'
}

/** Effective quantity for an item: committee-approved qty when present, else item qty. */
function effectiveQtyForItem(it) {
  const c = it.committee_approved_qty ?? it.committeeApprovedQty
  if (c != null && !Number.isNaN(Number(c))) return Number(c)
  const q = it.item_qty ?? it.itemQty
  return (q != null && !Number.isNaN(Number(q))) ? Number(q) : 0
}

/**
 * Sales tax (PKR) for a single item = round(effectiveUnitPrice x effectiveQty x rate).
 * Returns null when the effective unit price is null (no priced cost yet).
 */
export function computeItemTaxAmountPkr(it) {
  const unit = getEffectiveUnitPricePkrFromItem(it)
  if (unit == null || Number.isNaN(unit) || unit < 0) return null
  const qty = effectiveQtyForItem(it)
  return Math.round(unit * qty * REQUISITION_SALES_TAX_RATE)
}

/** Grand total including tax (PKR) across items: sum of (lineTotal + itemTax). */
export function computeItGrandTotalWithTaxPkr(items) {
  if (!items || !items.length) return 0
  let total = 0
  for (const it of items) {
    const unit = getEffectiveUnitPricePkrFromItem(it)
    if (unit == null || Number.isNaN(unit) || unit < 0) continue
    const qty = effectiveQtyForItem(it)
    const tax = computeItemTaxAmountPkr(it) ?? 0
    total += unit * qty + tax
  }
  return Math.round(total)
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all tests in `tests/requisition-tax.test.js` green.

- [ ] **Step 6: Commit** (user commits; staged: `src/utils/requisition.utils.js tests/requisition-tax.test.js package.json`)

---

## Task 3: Repository — persist & select the column

**Files:**
- Modify: `src/repositories/requisition.repository.js`

- [ ] **Step 1: Add `updateItemTaxAmount`**

After `updateItemCommitteeApprovedQty` (around `src/repositories/requisition.repository.js:825-830`), add:
```javascript
/** Set the per-item sales tax amount (PKR). Pass null to clear it. */
export async function updateItemTaxAmount(itemId, taxAmount) {
  return executeQuery(
    'UPDATE requisition_items SET item_tax_amount = $1 WHERE item_id = $2',
    [taxAmount, itemId]
  )
}
```

- [ ] **Step 2: Include the column in the explicit SELECT used for lists**

In `getRequisitionItemsByReqIds` (`src/repositories/requisition.repository.js:11-16`), add `item_tax_amount` to the column list:
```javascript
export async function getRequisitionItemsByReqIds(reqIds) {
  if (!reqIds.length) return []
  return executeQuery(
    'SELECT item_id, req_id, item_desc, item_size, item_brand, item_qty, item_est_cost, item_remarks, item_tax_amount FROM requisition_items WHERE req_id = ANY($1)',
    [reqIds]
  )
}
```
(Note: `getRequisitionItems` and `getItemsByReqIds` already use `SELECT *`, so they return the new column automatically.)

- [ ] **Step 3: Verify the server still starts (no syntax errors)**

Run: `node --check src/repositories/requisition.repository.js`
Expected: no output (valid syntax).

- [ ] **Step 4: Commit** (user commits)

---

## Task 4: Service — `refreshRequisitionItemTaxes` + wire into all write paths

**Files:**
- Modify: `src/services/requisition.service.js`

The file already imports from `./utils/requisition.utils.js` (e.g. `computeCommitteeApprovedLineTotalPKR`) and uses `reqRepo` for repository calls.

- [ ] **Step 1: Import the new helpers**

In the existing import from `'../utils/requisition.utils.js'` in `src/services/requisition.service.js` (around line 16), add `isItEquipmentCategory` and `computeItemTaxAmountPkr` to the imported names.

- [ ] **Step 2: Add the central refresh function**

Add near the other module-level helper functions (e.g. after `isCategoryNoDate`, around `src/services/requisition.service.js:355`):
```javascript
/**
 * Recompute and persist item_tax_amount for every item of a requisition.
 * IT Equipments category: tax = computeItemTaxAmountPkr(item) per item.
 * Any other category: explicitly clear tax to NULL (never carry stale tax).
 * Safe to call after any item mutation; no-op-safe if the column is missing.
 */
async function refreshRequisitionItemTaxes(reqId) {
  const id = parseInt(reqId, 10)
  if (Number.isNaN(id)) return
  try {
    const rows = await reqRepo.getRequisitionById(id)
    const category = rows?.[0]?.req_category ?? null
    const items = await reqRepo.getRequisitionItems(id)
    const isIt = isItEquipmentCategory(category)
    for (const it of items) {
      const tax = isIt ? computeItemTaxAmountPkr(it) : null
      await reqRepo.updateItemTaxAmount(it.item_id, tax)
    }
  } catch (_) {
    /* column may not exist yet (pre-migration); ignore */
  }
}
```

- [ ] **Step 3: Call refresh after item creation**

In `createRequisition`, after `await reqRepo.insertRequisitionItemsBatch(reqId, normalizedItems)` (`src/services/requisition.service.js:453`), add:
```javascript
    await refreshRequisitionItemTaxes(reqId)
```

- [ ] **Step 4: Call refresh after HOD BOQ revise**

In the HOD approval path, after the BOQ update loop closes (`src/services/requisition.service.js:969`, right after the `}` that ends `if (boqItems.length > 0) { for (...) { ... } }`), add:
```javascript
    await refreshRequisitionItemTaxes(requisitionId)
```

- [ ] **Step 5: Call refresh after HOD edit items**

In `editItems`, after the `for` loop that calls `reqRepo.updateRequisitionItem(...)` completes (`src/services/requisition.service.js:1864`, before `return { message: 'Items updated' }`), add:
```javascript
  await refreshRequisitionItemTaxes(reqIdNum)
```

- [ ] **Step 6: Call refresh after HOD add item**

In `addItemByHod`, after `await reqRepo.insertRequisitionItem(reqIdNum, item)` (`src/services/requisition.service.js:1923`, before `return { message: 'Item added' }`), add:
```javascript
  await refreshRequisitionItemTaxes(reqIdNum)
```

- [ ] **Step 7: Call refresh after IT replaces items**

In `approveIt`, after the call to `reqRepo.replaceRequisitionItems(...)` that persists IT's edited items (search for `replaceRequisitionItems` within `approveIt`), add immediately after it:
```javascript
    await refreshRequisitionItemTaxes(reqId)
```

- [ ] **Step 8: Call refresh after Committee revises approved qty**

In `approveCommittee` (`src/services/requisition.service.js:1378`), after the committee-approved-qty updates are applied and before/after `await reqRepo.approveCommittee(reqId, eid)` (`src/services/requisition.service.js:1431`), add:
```javascript
  await refreshRequisitionItemTaxes(reqId)
```
Place it after the qty updates so the recompute sees the new `committee_approved_qty`.

- [ ] **Step 9: Verify syntax**

Run: `node --check src/services/requisition.service.js`
Expected: no output (valid syntax).

- [ ] **Step 10: Commit** (user commits)

---

## Task 5: Manual backend verification (no DB test harness)

**Files:** none (verification only)

- [ ] **Step 1: Create an IT Equipments requisition with priced items**

Via the app or API, create an `IT Equipments` requisition with an item: unit cost `1000`, qty `2`.

- [ ] **Step 2: Verify tax persisted**

Run:
```powershell
psql $env:DATABASE_URL -c "SELECT item_desc, item_qty, item_est_cost, item_tax_amount FROM requisition_items ORDER BY item_id DESC LIMIT 3;"
```
Expected: the new item shows `item_tax_amount = 360.00` (1000 × 2 × 0.18).

- [ ] **Step 3: Verify a non-IT requisition stores NULL**

Create a `Stationary` requisition with a priced item; confirm its `item_tax_amount` is `NULL`.

- [ ] **Step 4: Verify recompute after Committee qty revise**

Take an IT Equipments requisition to the Committee stage, revise an item's approved qty, and confirm `item_tax_amount` updates to `unit × new qty × 0.18`.

---

## Task 6: Frontend — Tax columns in the modal (IT Equipments only)

**Files (in `Emp_Portal_FrontEnd`):**
- Modify: `src/components/RequisitionViewModal.jsx`

Context: the modal maps over items and computes `line = round(unit × qty)` and a `modalGrandTotal` ([RequisitionViewModal.jsx:131-175](src/components/RequisitionViewModal.jsx#L131-L175)). The requisition's category is available on the requisition object (`req_category`). Items now include `item_tax_amount`.

- [ ] **Step 1: Determine IT-Equipment mode at the top of the items render**

Where the modal has access to the requisition object (the same scope that renders the items table), compute:
```jsx
const isItEquipment = String(requisition?.req_category ?? requisition?.category ?? '').trim().toLowerCase() === 'it equipments'
```
(Use whichever variable name holds the requisition in this component — match the existing `item.*` access pattern's parent object.)

- [ ] **Step 2: Add the tax accumulator alongside the existing totals**

Near `let modalGrandTotal = 0` (line ~131), add:
```jsx
let modalTaxTotal = 0
```
Inside the items `.map`, after computing `line`, add:
```jsx
const taxAmt = item.item_tax_amount != null && String(item.item_tax_amount).trim() !== ''
  ? Math.round(Number(item.item_tax_amount))
  : null
if (isItEquipment && taxAmt != null) modalTaxTotal += taxAmt
const taxedLine = (line != null ? line : 0) + (taxAmt != null ? taxAmt : 0)
```

- [ ] **Step 3: Add header cells (IT Equipments only)**

In the `<thead>` row that contains `<th>Line total (PKR)</th>` (line ~167), add — guarded by `isItEquipment` — two headers before or after the line-total header:
```jsx
{isItEquipment && <th>Tax (PKR)</th>}
{isItEquipment && <th>Taxed total (PKR)</th>}
```

- [ ] **Step 4: Add body cells (IT Equipments only)**

In the item `<tr>` (alongside the line-total cell), add:
```jsx
{isItEquipment && (
  <td className="requisition-pending-items-table-mono">{taxAmt != null ? taxAmt.toLocaleString() : '—'}</td>
)}
{isItEquipment && (
  <td className="requisition-pending-items-table-mono">{line != null ? taxedLine.toLocaleString() : '—'}</td>
)}
```

- [ ] **Step 5: Add the grand-total-incl-tax row (IT Equipments only)**

In the totals footer, after the existing grand-total row (line ~173-175), add:
```jsx
{isItEquipment && modalAnyLineTotal && (
  <tr className="requisition-items-grand-total">
    <td colSpan={modalColSpan}>Grand total incl. tax (PKR)</td>
    <td className="requisition-pending-items-table-mono">{(modalGrandTotal + modalTaxTotal).toLocaleString()}</td>
  </tr>
)}
```
If the added columns change the table width, update `modalColSpan` accordingly so the label spans correctly when `isItEquipment` is true.

- [ ] **Step 6: Verify the modal renders for both categories**

Run the frontend dev server (`npm run dev` in `Emp_Portal_FrontEnd`). Open an IT Equipments requisition: confirm Tax + Taxed total columns and the grand-total-incl-tax row appear with correct numbers. Open a non-IT requisition: confirm no tax columns/row appear and the layout is unchanged.

- [ ] **Step 7: Commit** (user commits, in the frontend repo)

---

## Self-Review notes

- **Spec coverage:** column (Task 1), constant + helpers (Task 2), all write paths incl. the IT-stage `replaceRequisitionItems` path discovered during exploration (Task 4), API exposure via `SELECT *` + explicit-list fix (Task 3), modal columns + grand-total-incl-tax (Task 6), tests + manual verification (Tasks 2, 5, 6). Non-IT → NULL handled centrally in `refreshRequisitionItemTaxes`.
- **Edge cases:** no-price item → `computeItemTaxAmountPkr` returns null → column NULL until priced; category change → every refresh clears non-IT to NULL; rounding via `Math.round`.
- **Type consistency:** `refreshRequisitionItemTaxes(reqId)`, `reqRepo.updateItemTaxAmount(itemId, tax)`, `computeItemTaxAmountPkr(item)`, `isItEquipmentCategory(category)`, `computeItGrandTotalWithTaxPkr(items)` used consistently across tasks.
