# Salary Slip UI: Showing Old (Imported) Slips

## Troubleshooting: "I still can't view old salary slips"

1. **Call the backend, not the frontend**  
   The page URL is the frontend (e.g. `http://192.168.21.31:5173/salary/old-slips/413`). The **API** must be called on the **backend** server (e.g. `http://192.168.21.31:3000/api/salary/old-slips/413`). In the frontend, ensure the request uses the backend base URL (from env, e.g. `VITE_API_URL` or `import.meta.env.VITE_API_URL`), not the current origin.

2. **Test the API directly**  
   In a new tab or Postman, open:  
   `http://<BACKEND_HOST>:<BACKEND_PORT>/api/salary/old-slips/413`  
   (Replace with your backend host and port, e.g. 3000.)  
   - If you get **`[]`** → the API works; employee 413 has **no old slips** in the DB (their `employee_code` may not have matched any imported row).  
   - If you get **slips** → the API works; the frontend should show them (check Network tab and that the UI uses the response).  
   - If you get **404 / CORS / network error** → the frontend is likely calling the wrong URL or the backend is not reachable.

3. **If the API returns `[]`**  
   Old slips are stored by portal `employee_id`. The import matched `employees.employee_code` to SQL Server `HR_Emp_ID`. So only employees whose `employee_code` matched an HR_Emp_ID in the import have old slips. Log in as a user whose `employee_code` was in the import, or run:  
   `SELECT employee_id, COUNT(*) FROM old_salary_slip GROUP BY employee_id ORDER BY COUNT(*) DESC LIMIT 20;`  
   to see which employee_ids have slips.

---

## Option A: "Old salary slips" tab (recommended)

Use the **dedicated endpoint** for the "Old salary slips" tab so it only shows imported slips.

**API:** `GET /api/salary/old-slips/:employeeId`

**Example:** `GET /api/salary/old-slips/413` (use the logged-in user’s `employeeId`).

**Response:** Array of old slips. Each item has:
- `id` (number) — use for detail: `GET /api/salary/old-slip/:id?employeeId=...`
- `slipId` (string) — e.g. `"o-456"` for use with generic `GET /api/salary/slip/:id` if needed
- `month`, `payMonth`, `grossSalary`, `allowances`, `deductions`, `netSalary`, `status`, `remarks`

**Detail (one old slip):** `GET /api/salary/old-slip/:id?employeeId=...`  
Example: `GET /api/salary/old-slip/456?employeeId=413`  
Returns one JSON object (employeeName, employeeCode, totNetSalary, totGrossSalary, totDeductions, totAllowances, salaryStatus, remarks, m_days, w_days, and all earnings/deductions fields in camelCase).

**UI:** On the "Old salary slips" tab, call list with the current user’s `employeeId`. When the user clicks a slip, call detail with that slip’s numeric `id`: `GET /api/salary/old-slip/456?employeeId=413`.

---

## Option B: Single list (payroll + old + legacy)

The combined list also includes old slips.

**API:** `GET /api/salary/slips/:employeeId`

**Response:** Array of all slips. Each item can be:

| Field        | Payroll      | Old (imported) | Legacy   |
|-------------|--------------|----------------|----------|
| `id`        | `"p-123"`    | **`"o-456"`**  | `"s-789"` |
| `source`    | `"payroll"`  | **`"old"`**    | `"legacy"` |
| `month`     | string       | string         | string   |
| `payMonth`  | date         | date           | date     |
| `grossSalary`, `allowances`, `deductions`, `netSalary`, `status`, `remarks` | ✓ | ✓ | ✓ |

**UI:**  
- Render **all** items. Do **not** filter out `source === 'old'`.  
- Optional: show a small label like “Legacy” or “Imported” for `source === 'old'` (and optionally for `source === 'legacy'`).  
- Use the same row/card click handler for every slip; pass the **same** `id` (e.g. `o-456`) to the detail/download logic.

## Get one slip (detail view)

**API:** `GET /api/salary/slip/:id?employeeId=...`

**Id:** Use the **exact** `id` from the list (e.g. `o-456`). Do not strip the `o-` prefix.

**Response for old slip (`id` = `o-456`):** Same shape as legacy slips, plus `source: 'old'`:

- `id`: `"o-456"`
- `month`, `payMonth`, `employeeName`, `employeeCode`, `email`
- `mDays`, `wDays`, `aDays`, `jlDays`
- Allowances: `grossSalary`, `basicSalary1`, `medicalAllowance2`, … `incrementalArrears31`
- Totals: `totGrossSalary`, `totAllowances`, `totDeductions`, `totNetSalary`
- `remarks`, `salaryStatus`, `source: 'old'`

**UI:**  
- Use the same detail screen for payroll, old, and legacy.  
- If you already have a detail view that shows allowances/deductions and totals (e.g. for `s-...` legacy slips), reuse it for `o-...`; the backend returns the same field names.

## Download

**API:** `GET /api/salary/download/:salarySlipId?employeeId=...`

**salarySlipId:** Same `id` from the list (e.g. `o-456`).

**UI:**  
- Use the same download button/link for every slip; pass the list `id` (e.g. `o-456`) as `salarySlipId`. No special case needed for old slips.

## Checklist for "Old salary slips" tab

- [ ] List: call `GET /slips/:employeeId` and render **all** items (including `source === 'old'`).
- [ ] Optional: show “Legacy” / “Imported” for `source === 'old'`.
- [ ] Detail: when user opens a slip, call `GET /slip/:id?employeeId=...` with the **same** `id` from the list (e.g. `o-456`).
- [ ] Detail: reuse the same detail layout for payroll, old, and legacy (field names match).
- [ ] Download: call `GET /download/:salarySlipId?employeeId=...` with the same `id` (e.g. `o-456`).
- [ ] Do **not** filter by `id.startsWith('p-')` only; support `o-` and `s-` as well.

**If no slips appear:** Use the authenticated user's portal `employeeId`. Old slips are linked by `employees.employee_id`; the import matched `employee_code` to HR_Emp_ID.
