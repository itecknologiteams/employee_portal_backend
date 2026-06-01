# DB-Driven, SuperAdmin-Editable Sales Tax Rate — Design

**Date:** 2026-06-01
**Author:** ali.asif (with Claude Code)
**Status:** Approved design, pending implementation plan
**Builds on:** `2026-06-01-it-equipment-sales-tax-design.md` (the existing `item_tax_amount` feature)
**Repos:** `Emp_Portal_BackEnd` and `Emp_Portal_FrontEnd`

## Problem

The 18% sales tax rate is currently a hardcoded constant in the backend plus four hardcoded
`0.18` literals in the frontend. Changing it requires editing five places across two repos and
redeploying. The business needs to change the rate without a deploy, keep a record of past
rates, and have only SuperAdmin able to change it.

## Decisions (locked)

- **Storage:** an **append-only history table** (`sales_tax_rate`). A new rate is a new row;
  past rows are never edited or deleted.
- **Active rate:** the newest row (`ORDER BY id DESC LIMIT 1`).
- **Application:** **going forward only** — `refreshRequisitionItemTaxes` applies the current
  rate at save time; existing stored `item_tax_amount` values are never recomputed/backfilled.
- **Effect timing:** a new entry is active immediately (no scheduled effective dates).
- **Who can change it:** SuperAdmin only.
- **Where:** a "Sales Tax" section in the existing Administration page, **visible only to
  SuperAdmin** (current rate + history list + add-new-rate). Non-SuperAdmins do not see it.
- **Frontend display of tax:** requisition tables display the stored per-item
  `item_tax_amount` (no rate literals on the frontend at all). This is required by
  "going forward only" — historical requisitions must show the tax saved at their time.

## Design

### 1. Data model

```sql
CREATE TABLE IF NOT EXISTS sales_tax_rate (
  id           SERIAL PRIMARY KEY,
  rate_percent NUMERIC(5,2) NOT NULL,                 -- e.g. 18.00
  created_by   INTEGER REFERENCES employees(employee_id),
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- seed initial rate if table is empty
INSERT INTO sales_tax_rate (rate_percent)
SELECT 18.00 WHERE NOT EXISTS (SELECT 1 FROM sales_tax_rate);
```

- Rate stored as a **percent** (human-friendly for the admin UI); backend converts to a
  fraction (`rate_percent / 100`).
- Migration file: `database/migrations/add_sales_tax_rate_table_pg.sql`.

### 2. Backend

- Repository (`requisition.repository.js`):
  - `getCurrentSalesTaxRate()` → returns the latest `rate_percent` as a **fraction**
    (e.g. `0.18`); falls back to `0.18` if the table is empty/missing.
  - `getSalesTaxRateHistory()` → all rows newest-first, joined to the changer's name.
  - `addSalesTaxRate(ratePercent, employeeId)` → inserts a new row.
- Utils (`requisition.utils.js`):
  - `computeItemTaxAmountPkr(item, rate = REQUISITION_SALES_TAX_RATE)` — gains a **rate
    parameter**; the existing `0.18` constant stays as the default/fallback (and for unit
    tests).
  - `computeItGrandTotalWithTaxPkr(items, rate = REQUISITION_SALES_TAX_RATE)` — same.
- Service (`requisition.service.js`):
  - `refreshRequisitionItemTaxes(reqId)` fetches `getCurrentSalesTaxRate()` **once** and passes
    it to `computeItemTaxAmountPkr` for each item. No other write-path changes (the six wiring
    points from the prior feature already call this function).
  - `getSalesTaxSettings(actorEmployeeId)` → `{ ratePercent, history }` (SuperAdmin only).
  - `addSalesTaxRateSetting(ratePercent, actorEmployeeId)` → validates SuperAdmin + a valid
    percent (0–100, ≤2 decimals), inserts, returns the new current settings.
- Controller + routes (`requisition.controller.js`, `requisition.routes.js`):
  - `GET /requisition/sales-tax` → `getSalesTaxSettings` (SuperAdmin only).
  - `POST /requisition/sales-tax` → `addSalesTaxRateSetting` (SuperAdmin only).
  - SuperAdmin check reuses the existing pattern: `reqRepo.isSuperAdmin(eid)` (optionally a
    `can_edit_tax_rate` permission via `employeeHasPermission`).

### 3. Frontend

- **Administration page** (`Administration.jsx`): a new SuperAdmin-only "Sales Tax" section:
  - Shows the current rate.
  - Shows a history table: rate %, changed by, date.
  - An input + "Add new rate" button that `POST`s a new entry, then refreshes.
  - Entire section hidden for non-SuperAdmin users.
- **Requisition item tables** (`RequisitionPending.jsx` ×3 tables, `RequisitionHistory.jsx`):
  replace the hardcoded `Math.round(line * 0.18)` with **displaying the stored
  `item.item_tax_amount`**; taxed total = displayed line total + stored tax. The Tracking modal
  (`RequisitionViewModal.jsx`) already reads the stored value. No rate constant on the frontend.

### 4. Pre-existing quirk (unchanged)

The CEO and Procurement tables compute their est-cost on an approved-qty basis that differs
slightly from how the stored tax was derived, so in edge cases the displayed tax may not equal
exactly the current rate × that table's est-cost column. This is existing cost-basis behavior,
not introduced here.

## Testing

- Unit: `computeItemTaxAmountPkr(item, rate)` with several rates (0.18, 0.10, 0.0) and the
  default fallback.
- DB-backed: add a new rate → a newly-saved requisition uses the new rate; an existing
  requisition's stored `item_tax_amount` is unchanged (proves going-forward-only).
- Guard: non-SuperAdmin `POST /requisition/sales-tax` is rejected.
- Frontend production build passes; tables show stored tax with no rate literals.

## Out of scope

- Backfilling existing rows to a new rate (explicitly excluded by "going forward only"; a
  separate optional one-time script can populate currently-NULL existing IT items at the
  current rate if desired).
- Per-category rates and scheduled future effective dates.
- Editing/deleting past rate entries.
