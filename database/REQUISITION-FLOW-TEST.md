# Requisition flows — test checklist

Use this checklist to verify each category flow end-to-end. Ensure DB migrations have been run (see README-REQUISITION-FLOW.md).

## Prerequisites

- Backend and frontend running; DB has `requisition_flow_stage`, `requisition_category_stage`, and categories seeded.
- Test users: one normal Employee, one HOD, one HR, one Committee, one Procurement, one Finance, one CEO, one Admin (or combined roles as per your `employee_type`/`designation`).

---

## 1. Stationary

| Step | Actor | Action | Expected |
|------|--------|--------|----------|
| 1 | Employee | Create requisition, category **Stationary** | Created; appears in HOD list (or skips to Admin if HOD for-info auto-advance) |
| 2 | HOD | Open req (or auto-advance) | If HOD For Info: req moves to Admin. If not, HOD sees it and can approve/info |
| 3 | Admin | Open Pending Admin, approve | Status → Completed; stage cleared |
| 4 | Employee (Creator) | Open Pending Acknowledgment, acknowledge | Status → Closed |

---

## 2. Vehicle Maintenance

Same as **Stationary**: Employee → HOD (For Info) → Admin (Execution) → Creator Acknowledgment.

---

## 3. Vehicle Repair / Other Repair & Maintenance

| Step | Actor | Action | Expected |
|------|--------|--------|----------|
| 1 | Employee | Create requisition, category **Vehicle Repair** or **Other Repair & Maintenance** | Created; first stage = HOD (Approval) |
| 2 | HOD | Approve with BOQ (quantity + price per item) | Moves to Committee |
| 3 | Committee | Approve with approved qty per item | Moves to Procurement (or CEO if total >100K; then CEO → Procurement) |
| 4 | Procurement | Acknowledge, add 3 quotations, hand over to Finance | Moves to Finance |
| 5 | Finance | Approve (select quotation 1/2/3) | Moves to Procurement for purchase |
| 6 | CEO | If applicable, approve | Forwarded to Procurement |
| 7 | Procurement | Mark Complete purchase | Completed – Pending HOD Acknowledgment (or Creator if creator is HOD) |
| 8 | HOD / Creator | Acknowledge receipt or Creator acknowledge | Closed |

---

## 4. Loan & Advance Salary

**Path A: Amount < 50K**

| Step | Actor | Action | Expected |
|------|--------|--------|----------|
| 1 | Employee | Create requisition, category **Loan & Advance Salary**, items total < 50K | Created; stage = HOD |
| 2 | HOD | Approve (no BOQ required) | Moves to HR |
| 3 | HR | Approve | Moves to Finance (amount <50K) |
| 4 | Finance | Approve (e.g. quotation index 1) | Completed – Creator can acknowledge |
| 5 | Creator | Acknowledge | Closed |

**Path B: Amount ≥ 50K**

| Step | Actor | Action | Expected |
|------|--------|--------|----------|
| 1–2 | Same | Create, HOD approve | Same |
| 3 | HR | Approve | Moves to CEO (amount ≥50K) |
| 4 | CEO | Approve | Moves to Finance |
| 5 | Finance | Approve | Completed – Creator can acknowledge |
| 6 | Creator | Acknowledge | Closed |

---

## 5. Specialized Projects

| Step | Actor | Action | Expected |
|------|--------|--------|----------|
| 1 | Employee | Create requisition, category **Specialized Projects** | Created; **first stage = Committee** (no HOD) |
| 2 | Committee | Approve with approved qty | Moves to Procurement |
| 3 | Procurement | Acknowledge, add 3 quotations, hand over to Finance | Moves to Finance |
| 4 | Finance | Approve (select quotation) | Forwarded to Procurement |
| 5 | CEO | Approve | Forwarded to Procurement |
| 6 | Procurement | Mark Complete purchase | Completed – Pending HOD/Creator Acknowledgment |
| 7 | Creator | Acknowledge | Closed |

---

## 6. IT Equipments / General Procurements Grocerry & Others / General Procurements Electric Appliances

Same as **Specialized Projects**: Employee → Committee → Procurement (Quotations) → Finance → CEO → Procurement (Execution) → Acknowledgment.

---

## 7. Devices / Accessories

| Step | Actor | Action | Expected |
|------|--------|--------|----------|
| 1 | Employee | Create requisition, category **Devices / Accessories** | Created; first stage = Committee |
| 2 | Committee | Approve with approved qty | Moves to **Finance** (not Procurement; no quotations in path) |
| 3 | Finance | Approve | Moves to CEO |
| 4 | CEO | Approve | Forwarded to **Procurement** (Execution only) |
| 5 | Procurement | Mark Complete purchase (no quotations step) | Completed – Pending Acknowledgment |
| 6 | Creator | Acknowledge | Closed |

---

## Quick API checks (optional)

- `GET /api/requisition/flow` – Returns categories and flow flags; confirm categories and stages.
- `GET /api/requisition/pending/hod/:employeeId` – HOD sees reqs at stage `hod` (and any HOD-ack list).
- `GET /api/requisition/pending/committee/:employeeId` – Committee sees reqs at stage `committee`.
- `GET /api/requisition/pending/procurement/:employeeId` – Procurement sees reqs at stage `procurement`.
- `GET /api/requisition/pending/finance/:employeeId` – Finance sees reqs at stage `finance`.
- `GET /api/requisition/pending/ceo/:employeeId` – CEO sees reqs at stage `ceo`.
- `GET /api/requisition/pending/admin/:employeeId` – Admin sees reqs at stage `admin`.
- `GET /api/requisition/pending/creator-acknowledge/:employeeId` – Creator sees reqs pending their acknowledgment.

---

## Common issues

1. **Requisition not found or not yet forwarded to Procurement** – Usually fixed by using `req_current_stage_key = 'procurement'` for Procurement ack (already in repo). Ensure flow sends req to `procurement` stage when expected.
2. **Devices showing CEO/Procurement in wrong order** – Ensure `requisition-flows-final-pg.sql` is run so Devices has Committee → Finance → CEO (procurement=skip), and after CEO the app sends to Procurement.
3. **Specialized Projects starting at HOD** – Ensure Specialized has committee=approval and hod/hr=skip so first stage is Committee.
4. **Vehicle Repair HOD as For Info** – Ensure `requisition-flows-final-pg.sql` sets Vehicle Repair / Other Repair to HOD = Approval (hod_approval=1, hod_for_info=0).
