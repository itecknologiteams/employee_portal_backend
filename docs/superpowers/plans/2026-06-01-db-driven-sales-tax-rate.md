# DB-Driven Sales Tax Rate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement task-by-task. Steps use checkbox (`- [ ]`).

**Goal:** Move the sales-tax rate into an append-only DB table, editable by SuperAdmin from the Administration page; new requisitions use the latest rate (going-forward only); frontend tables display the stored per-item tax (no rate literals).

**Architecture:** New `sales_tax_rate` history table. Backend reads the latest rate at item-tax compute time. SuperAdmin-guarded GET/POST endpoints. Administration page gets a SuperAdmin-only "Sales Tax" section. Requisition tables switch from hardcoded `0.18` to the stored `item_tax_amount`.

**Tech Stack:** Node/ESM, PostgreSQL, React (Vite), `node:test`.

**Spec:** `docs/superpowers/specs/2026-06-01-db-driven-sales-tax-rate-design.md`

---

## Task 1: Migration — `sales_tax_rate` table

**Files:** Create `database/migrations/add_sales_tax_rate_table_pg.sql`

- [ ] **Step 1:** Write:
```sql
CREATE TABLE IF NOT EXISTS sales_tax_rate (
  id           SERIAL PRIMARY KEY,
  rate_percent NUMERIC(5,2) NOT NULL,
  created_by   INTEGER REFERENCES employees(employee_id),
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO sales_tax_rate (rate_percent)
SELECT 18.00 WHERE NOT EXISTS (SELECT 1 FROM sales_tax_rate);
SELECT 'sales_tax_rate table ready.' AS message;
```
- [ ] **Step 2:** Apply: `node scripts/run-migration.js database/migrations/add_sales_tax_rate_table_pg.sql` → expect success line.
- [ ] **Step 3:** Verify: query `SELECT * FROM sales_tax_rate;` → one row, rate_percent 18.00.

## Task 2: Repository functions

**Files:** Modify `src/repositories/requisition.repository.js`

- [ ] **Step 1:** Add:
```javascript
/** Latest sales tax rate as a fraction (e.g. 0.18). Falls back to 0.18. */
export async function getCurrentSalesTaxRate() {
  try {
    const r = await executeQuery('SELECT rate_percent FROM sales_tax_rate ORDER BY id DESC LIMIT 1')
    const pct = r && r[0] ? Number(r[0].rate_percent) : null
    return (pct != null && !Number.isNaN(pct)) ? pct / 100 : 0.18
  } catch (_) {
    return 0.18
  }
}

/** Full rate history, newest first, with changer name. */
export async function getSalesTaxRateHistory() {
  return executeQuery(
    `SELECT s.id, s.rate_percent, s.created_at, s.created_by,
            e.first_name, e.last_name
       FROM sales_tax_rate s
       LEFT JOIN employees e ON e.employee_id = s.created_by
      ORDER BY s.id DESC`
  )
}

/** Insert a new rate row (append-only). */
export async function addSalesTaxRate(ratePercent, employeeId) {
  return executeQuery(
    'INSERT INTO sales_tax_rate (rate_percent, created_by) VALUES ($1, $2)',
    [ratePercent, employeeId ?? null]
  )
}
```
- [ ] **Step 2:** `node --check src/repositories/requisition.repository.js` → no output.

## Task 3: Utils — accept a rate parameter

**Files:** Modify `src/utils/requisition.utils.js`, `tests/requisition-tax.test.js`

- [ ] **Step 1:** Change `computeItemTaxAmountPkr(it)` signature to `computeItemTaxAmountPkr(it, rate = REQUISITION_SALES_TAX_RATE)` and use `rate` instead of the constant in its body. Change `computeItGrandTotalWithTaxPkr(items)` to `computeItGrandTotalWithTaxPkr(items, rate = REQUISITION_SALES_TAX_RATE)` and pass `rate` into the internal `computeItemTaxAmountPkr(it, rate)` call.
- [ ] **Step 2:** Add tests:
```javascript
test('computeItemTaxAmountPkr: respects an explicit rate', () => {
  // 1000 * 2 * 0.10 = 200
  assert.equal(computeItemTaxAmountPkr({ item_est_cost: '1000', item_qty: 2 }, 0.10), 200)
})
test('computeItemTaxAmountPkr: defaults to 18% when rate omitted', () => {
  assert.equal(computeItemTaxAmountPkr({ item_est_cost: '1000', item_qty: 2 }), 360)
})
```
- [ ] **Step 3:** Run `npm test` → all pass (existing 8 + 2 new).

## Task 4: Service — apply DB rate + settings functions

**Files:** Modify `src/services/requisition.service.js`

- [ ] **Step 1:** In `refreshRequisitionItemTaxes`, fetch the rate once and pass it in:
```javascript
async function refreshRequisitionItemTaxes(reqId) {
  const id = parseInt(reqId, 10)
  if (Number.isNaN(id)) return
  try {
    const rows = await reqRepo.getRequisitionById(id)
    const category = rows?.[0]?.req_category ?? null
    const items = await reqRepo.getRequisitionItems(id)
    const isIt = isItEquipmentCategory(category)
    const rate = isIt ? await reqRepo.getCurrentSalesTaxRate() : null
    for (const it of items) {
      const tax = isIt ? computeItemTaxAmountPkr(it, rate) : null
      await reqRepo.updateItemTaxAmount(it.item_id, tax)
    }
  } catch (_) { /* pre-migration tolerant */ }
}
```
- [ ] **Step 2:** Add settings service functions (near the end of the file, before the toggleHidden helper or after getById):
```javascript
/** SuperAdmin: read current sales tax rate (percent) + history. */
export async function getSalesTaxSettings(employeeCode) {
  const eid = await resolveEmployeeIdFromCode(employeeCode)
  if (eid == null) return { error: 'Valid employee is required', status: 400 }
  if (!(await reqRepo.isSuperAdmin(eid))) return { error: 'Only SuperAdmin can view tax settings', status: 403 }
  const history = await reqRepo.getSalesTaxRateHistory()
  const currentPercent = history.length ? Number(history[0].rate_percent) : 18
  return { ratePercent: currentPercent, history }
}

/** SuperAdmin: add a new sales tax rate (percent). */
export async function addSalesTaxRateSetting(employeeCode, ratePercent) {
  const eid = await resolveEmployeeIdFromCode(employeeCode)
  if (eid == null) return { error: 'Valid employee is required', status: 400 }
  if (!(await reqRepo.isSuperAdmin(eid))) return { error: 'Only SuperAdmin can change the tax rate', status: 403 }
  const pct = Number(ratePercent)
  if (Number.isNaN(pct) || pct < 0 || pct > 100) return { error: 'Rate must be a percent between 0 and 100', status: 400 }
  if (!/^\d+(\.\d{1,2})?$/.test(String(ratePercent).trim())) return { error: 'Rate may have at most 2 decimals', status: 400 }
  await reqRepo.addSalesTaxRate(pct, eid)
  const history = await reqRepo.getSalesTaxRateHistory()
  return { ratePercent: pct, history }
}
```
- [ ] **Step 2b:** Confirm a code→id resolver exists. The file imports `getEmployeeIdByCode` from `../repositories/auth.repository.js`. Add a small local helper if not already present:
```javascript
async function resolveEmployeeIdFromCode(code) {
  if (code == null || String(code).trim() === '') return null
  const direct = parseInt(code, 10)
  // employeeCode is a code, not the numeric id — resolve via auth repo
  const id = await getEmployeeIdByCode(String(code).trim()).catch(() => null)
  return id ?? (Number.isNaN(direct) ? null : direct)
}
```
(If an equivalent resolver already exists in the file, reuse it instead.)
- [ ] **Step 3:** `node --check src/services/requisition.service.js` → no output. Run `npm test` → pass.

## Task 5: Controller + routes

**Files:** Modify `src/controllers/requisition.controller.js`, `src/routes/requisition.routes.js`

- [ ] **Step 1:** Controller — add:
```javascript
export async function getSalesTax(req, res) {
  try {
    const result = await requisitionService.getSalesTaxSettings(req.params.employeeCode)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(result)
  } catch (e) {
    console.error('Get sales tax error:', e)
    res.status(500).json({ error: 'Failed to fetch sales tax settings' })
  }
}

export async function addSalesTax(req, res) {
  try {
    const { employeeCode, ratePercent } = req.body
    const result = await requisitionService.addSalesTaxRateSetting(employeeCode, ratePercent)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(result)
  } catch (e) {
    console.error('Add sales tax error:', e)
    res.status(500).json({ error: 'Failed to add sales tax rate' })
  }
}
```
- [ ] **Step 2:** Routes — add **with the other literal routes, before `/:reqId`** (e.g. after line 15):
```javascript
router.get('/sales-tax/:employeeCode', requisitionController.getSalesTax)
router.post('/sales-tax', requisitionController.addSalesTax)
```
- [ ] **Step 3:** `node --check` both files → no output.

## Task 6: Backend DB-backed verification

**Files:** none

- [ ] **Step 1:** Add a new rate (10%) as a SuperAdmin via a node script importing the service `addSalesTaxRateSetting('<superadmin-code>', 10)`; expect `ratePercent: 10` and history length ≥ 2.
- [ ] **Step 2:** Run `refreshRequisitionItemTaxes`-equivalent (repo + util loop using `getCurrentSalesTaxRate`) on a test IT requisition → confirm tax now uses 10% (e.g. 185000 → 18500).
- [ ] **Step 3:** Confirm a different existing requisition's stored `item_tax_amount` is unchanged until re-saved (going-forward-only).
- [ ] **Step 4:** Re-add 18% so the live default is restored.

## Task 7: Frontend — API methods

**Files:** Modify `Emp_Portal_FrontEnd/src/services/api.js`

- [ ] **Step 1:** In `requisitionAPI`, add:
```javascript
  getSalesTax: (employeeCode) => apiCall(`/requisition/sales-tax/${employeeCode}`),
  addSalesTax: (employeeCode, ratePercent) => apiCall(`/requisition/sales-tax`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employeeCode, ratePercent })
  }),
```

## Task 8: Frontend — Administration "Sales Tax" section (SuperAdmin only)

**Files:** Modify `Emp_Portal_FrontEnd/src/pages/Administration.jsx`

- [ ] **Step 1:** From `useEmployee()` context, get `userType` and the employee code. Compute `const isSuperAdmin = userType === 'SuperAdmin'`.
- [ ] **Step 2:** Add state: `const [taxData, setTaxData] = useState(null)` and `const [newRate, setNewRate] = useState('')`.
- [ ] **Step 3:** Loader (called when `isSuperAdmin`):
```javascript
const loadSalesTax = async () => {
  try { setTaxData(await requisitionAPI.getSalesTax(empCode)) }
  catch { setTaxData(null) }
}
```
Call it in the same `useEffect`/init path that loads other admin data, guarded by `isSuperAdmin`.
- [ ] **Step 4:** Render a section, only when `isSuperAdmin`:
```jsx
{isSuperAdmin && (
  <section className="admin-section">
    <h3>Sales Tax</h3>
    <p>Current rate: <strong>{taxData?.ratePercent != null ? `${taxData.ratePercent}%` : '—'}</strong></p>
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' }}>
      <input type="number" step="0.01" min="0" max="100" value={newRate}
        onChange={(e) => setNewRate(e.target.value)} placeholder="New rate %" />
      <button type="button" className="btn btn-sm btn-primary" onClick={async () => {
        if (newRate === '' || Number.isNaN(Number(newRate))) return
        try { const d = await requisitionAPI.addSalesTax(empCode, Number(newRate)); setTaxData(d); setNewRate('') }
        catch (e) { alert(e.message || 'Failed to add rate') }
      }}>Add new rate</button>
    </div>
    <table className="admin-table">
      <thead><tr><th>Rate %</th><th>Changed by</th><th>Date</th></tr></thead>
      <tbody>
        {(taxData?.history || []).map(h => (
          <tr key={h.id}>
            <td>{Number(h.rate_percent)}%</td>
            <td>{[h.first_name, h.last_name].filter(Boolean).join(' ') || '—'}</td>
            <td>{h.created_at ? new Date(h.created_at).toLocaleString() : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </section>
)}
```
(Match existing class names/styles in Administration.jsx; the above uses generic ones.)
- [ ] **Step 5:** Build check happens in Task 10.

## Task 9: Frontend — tables display stored tax (remove rate literals)

**Files:** Modify `RequisitionPending.jsx`, `RequisitionHistory.jsx`

Replace the four `Math.round(<line> * 0.18)` computations with the stored value. Keep the `isItEquipment` gating, headers, and footers already added.

- [ ] **Step 1 (Pending, HOD/Committee table ~537):**
```javascript
const taxAmt = isItEquipment && item.item_tax_amount != null && String(item.item_tax_amount).trim() !== ''
  ? Math.round(Number(item.item_tax_amount)) : null
```
- [ ] **Step 2 (Pending, CEO table ~660):** same replacement (`item.item_tax_amount`).
- [ ] **Step 3 (Pending, Procurement table ~751):** same replacement.
- [ ] **Step 4 (History ~278):** same replacement.
- [ ] **Step 5:** In each, the footer tax subtotal already sums `taxAmt` into the per-table tax accumulator, so no footer change needed beyond what exists.

Note: taxed total stays `displayedLine + taxAmt`. For non-IT or NULL tax it shows `—` as before.

## Task 10: Verify

- [ ] **Step 1:** Backend `npm test` → all pass.
- [ ] **Step 2:** Frontend `npm run build` → success, 0 errors.
- [ ] **Step 3:** DB-backed: confirm `GET /requisition/sales-tax/<superadmin-code>` returns current rate + history; non-SuperAdmin code → 403.
- [ ] **Step 4:** Manual browser pass (user): Administration shows Sales Tax for SuperAdmin only; adding a rate updates current + history; a new IT requisition saved afterward shows the new tax; older ones unchanged.

## Self-Review notes
- Spec coverage: table (T1), repo (T2), rate-param util (T3), DB rate at compute + settings (T4), endpoints (T5), backend verify (T6), FE api (T7), Admin section SuperAdmin-only (T8), tables→stored tax (T9), verify (T10).
- Type consistency: `getCurrentSalesTaxRate()`, `getSalesTaxRateHistory()`, `addSalesTaxRate(pct, eid)`, `getSalesTaxSettings(code)`, `addSalesTaxRateSetting(code, pct)`, `computeItemTaxAmountPkr(it, rate)` used consistently.
- Going-forward-only: enforced because only `refreshRequisitionItemTaxes` (write paths) recomputes; POST does no backfill.
