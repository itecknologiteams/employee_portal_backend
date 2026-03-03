# Backend Performance Analysis & Recommendations

Summary of findings and applied/planned improvements. Frontend report: see `Emp_Portal_FrontEnd/PERFORMANCE-ANALYSIS.md`.

---

## 1. Repeated `getFlowStages()` (high impact – mitigated)

**Issue:** `getFlowStages()` was called many times per request (e.g. in getPendingHR, getPendingAdmin, getPendingCommittee, approveHR, etc.). Same for `getCategoryStageBehaviorMap()` inside `getNextStageKey` / `getFirstStageKey`.

**Fix applied:** Short in-memory cache (TTL) for `getFlowStages()` and `getCategoryStageBehaviorMap()` in the requisition repository so repeated calls in the same process reuse results.

---

## 2. N+1: requisition items insert (high impact – mitigated)

**Issue:** Creating a requisition inserted items one-by-one: `for (const it of validItems) { await reqRepo.insertRequisitionItem(reqId, it) }`.

**Fix applied:** New `insertRequisitionItemsBatch(reqId, items)` in repository; service now calls the batch insert once.

---

## 3. N+1: committee approved qty update

**Issue:** `for (const it of items) { await reqRepo.updateItemCommitteeApprovedQty(itemId, ...) }` in requisition service – one UPDATE per item.

**Recommendation:** Add a batch update in the repository (single query with `UNNEST` or multiple VALUES) and call it from the service.

---

## 4. No pagination / no limit on list endpoints

**Issue:**  
- `listDepartments()` and `listDesignations()` return full tables.  
- `listSlips(employeeId)` and `listOldSlipsOnly(employeeId)` return all slips for the employee.  
- `getLeaveRequests(employeeId)` and `getPendingHrLeaves()` return all matching rows.  
- `getAllFeedback` capped at 500 – consider lower default and pagination.

**Recommendation:** Add `limit`/`offset` (or page/size) and a total count where appropriate; enforce a max page size (e.g. 100).

---

## 5. SELECT * where not needed

**Issue:** Some queries use `SELECT *` (e.g. requisition_items, employee_salary_structure, salary_slip, old_salary_slip) when only a subset of columns is used.

**Recommendation:** Replace with explicit column lists to reduce data transfer and clarify contract.

---

## 6. No caching for lookup data

**Issue:** Flow stages and category behavior are now cached (see §1). Other lookups (e.g. `getDesignationAllowances()`, departments, designations) still hit the DB every time.

**Recommendation:** Add short TTL in-memory cache for rarely changing lookup tables, or use Redis if multiple instances.

---

## 7. Request logger and auth cost

**Issue:** Request logger may clone `req.body` and log full request/response on every request. Auth (login) does multiple DB calls per attempt.

**Recommendation:** Disable or sample request logging in production; avoid cloning large bodies. For login, consider a single batched query or cached role/permission data where possible.

---

## 8. Sync file operations at startup

**Issue:** `config/logger.js` uses `fs.existsSync` and `fs.mkdirSync` at load – blocks the event loop briefly.

**Recommendation:** Use async `fs.promises` in an init function or keep sync only for one-time startup if acceptable.
